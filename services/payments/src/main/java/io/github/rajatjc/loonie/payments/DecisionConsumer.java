package io.github.rajatjc.loonie.payments;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.SmartLifecycle;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.connection.stream.StreamReadOptions;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static java.nio.charset.StandardCharsets.UTF_8;

/**
 * Reads the fraud and compliance verdicts from Redis Streams with a consumer
 * group. A message is acknowledged only after its database transaction commits,
 * so a crash means it's delivered again; the service ignores repeats.
 *
 * <p>It can be paused from the ops console to show what happens when a
 * service stops consuming: verdicts queue up in Redis and transfers stay pending.
 */
@Component
class DecisionConsumer implements SmartLifecycle {
    static final String FRAUD = "fraud.decisions";
    static final String COMPLIANCE = "compliance.decisions";
    private static final String GROUP = "payments";

    private static final Logger log = LoggerFactory.getLogger(DecisionConsumer.class);

    private final StringRedisTemplate redis;
    private final TransferService service;
    private final ObjectMapper json;
    private final String consumerName;
    private volatile boolean running;
    private volatile boolean paused;
    private Thread thread;

    DecisionConsumer(StringRedisTemplate redis, TransferService service, ObjectMapper json,
                     @Value("${loonie.consumer-name}") String consumerName) {
        this.redis = redis;
        this.service = service;
        this.json = json;
        this.consumerName = consumerName;
    }

    boolean paused() {
        return paused;
    }

    void pause(boolean pause) {
        paused = pause;
        log.info("decision consumer {}", pause ? "paused" : "resumed");
    }

    @Override
    public void start() {
        running = true;
        thread = Thread.ofVirtual().name("decision-consumer").start(this::run);
    }

    @Override
    public void stop() {
        running = false;
        if (thread != null) {
            thread.interrupt();
        }
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    @SuppressWarnings("unchecked")
    private void run() {
        Consumer me = Consumer.from(GROUP, consumerName);
        while (running) {
            try {
                if (paused) {
                    Thread.sleep(500);
                    continue;
                }
                ensureGroups();
                // First anything delivered to us but never acknowledged (we crashed), then new messages.
                List<MapRecord<String, Object, Object>> batch = redis.opsForStream().read(me,
                        StreamReadOptions.empty().count(50),
                        StreamOffset.create(FRAUD, ReadOffset.from("0")), StreamOffset.create(COMPLIANCE, ReadOffset.from("0")));
                if (batch == null || batch.isEmpty()) {
                    batch = redis.opsForStream().read(me, StreamReadOptions.empty().count(50).block(Duration.ofSeconds(2)),
                            StreamOffset.create(FRAUD, ReadOffset.lastConsumed()), StreamOffset.create(COMPLIANCE, ReadOffset.lastConsumed()));
                }
                if (paused) {
                    continue; // paused mid-read: leave them unacknowledged, they're redelivered on resume
                }
                for (MapRecord<String, Object, Object> message : batch == null ? List.<MapRecord<String, Object, Object>>of() : batch) {
                    handle(message);
                    redis.opsForStream().acknowledge(message.getStream(), GROUP, message.getId());
                }
            } catch (InterruptedException e) {
                return;
            } catch (RuntimeException e) {
                if (!running) {
                    return;
                }
                log.warn("decision consumer error, retrying: {}", e.getMessage());
                groupsReady = false;
                sleep();
            }
        }
    }

    private void handle(MapRecord<String, Object, Object> message) {
        Map<String, Object> d;
        try {
            d = json.readValue(String.valueOf(message.getValue().get("data")), new TypeReference<>() {});
        } catch (Exception e) {
            log.warn("dropping unreadable message {} on {}", message.getId(), message.getStream());
            return;
        }
        UUID id = UUID.fromString(String.valueOf(d.get("transferId")));
        if (FRAUD.equals(message.getStream())) {
            @SuppressWarnings("unchecked")
            List<String> reasons = (List<String>) d.getOrDefault("reasons", List.of());
            service.onFraudDecision(id, String.valueOf(d.get("decision")), ((Number) d.get("score")).intValue(), reasons);
        } else {
            service.onComplianceDecision(id, String.valueOf(d.get("decision")),
                    (String) d.get("reason"), (String) d.get("reportId"));
        }
    }

    private volatile boolean groupsReady;

    private void ensureGroups() {
        if (groupsReady) {
            return;
        }
        for (String stream : List.of(FRAUD, COMPLIANCE)) {
            try {
                redis.execute((RedisCallback<Object>) c -> c.execute("XGROUP", b("CREATE"), b(stream), b(GROUP), b("0"), b("MKSTREAM")));
            } catch (RuntimeException e) {
                if (!groupExists(e)) {
                    throw e;
                }
            }
        }
        groupsReady = true;
    }

    /** Redis answers BUSYGROUP when the group already exists; Spring wraps it in other exceptions. */
    private static boolean groupExists(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (String.valueOf(t.getMessage()).contains("BUSYGROUP")) {
                return true;
            }
        }
        return false;
    }

    private static byte[] b(String s) {
        return s.getBytes(UTF_8);
    }

    private void sleep() {
        try {
            Thread.sleep(1000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}

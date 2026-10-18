package io.github.rajatjc.loonie.payments;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;

import static java.nio.charset.StandardCharsets.UTF_8;

/**
 * Transactional outbox. Services call {@link #add} inside the transaction that
 * changes the data, and {@link #relay} later copies the rows to Redis Streams.
 * If Redis is down the rows wait; nothing is lost. A row can be published twice
 * if the delete fails after the XADD, so consumers must be idempotent.
 */
@Component
class Outbox {
    static final String TRANSFERS = "transfers";
    static final String UPDATES = "transfer.updates";

    private static final Logger log = LoggerFactory.getLogger(Outbox.class);

    private record Row(long id, String stream, String type, String payload) {}

    private final JdbcTemplate db;
    private final ObjectMapper json;
    private final StringRedisTemplate redis;
    private final TransactionTemplate tx;
    private volatile boolean failing;

    Outbox(JdbcTemplate db, ObjectMapper json, StringRedisTemplate redis, TransactionTemplate tx) {
        this.db = db;
        this.json = json;
        this.redis = redis;
        this.tx = tx;
    }

    void add(String stream, String type, Object payload) {
        try {
            db.update("insert into outbox (stream, type, payload) values (?, ?, ?)",
                    stream, type, json.writeValueAsString(payload));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    @Scheduled(fixedDelay = 200)
    void relay() {
        try {
            tx.executeWithoutResult(status -> {
                // SKIP LOCKED lets several replicas relay without publishing the same row at once.
                List<Row> rows = db.query("select * from outbox order by id limit 100 for update skip locked",
                        (rs, i) -> new Row(rs.getLong("id"), rs.getString("stream"), rs.getString("type"), rs.getString("payload")));
                for (Row row : rows) {
                    publish(row);
                    db.update("delete from outbox where id = ?", row.id());
                }
            });
            if (failing) {
                log.info("outbox relay recovered");
                failing = false;
            }
        } catch (RuntimeException e) {
            if (!failing) {
                log.warn("outbox relay failing, events will wait in Postgres: {}", e.getMessage());
                failing = true;
            }
        }
    }

    long backlog() {
        Long n = db.queryForObject("select count(*) from outbox", Long.class);
        return n == null ? 0 : n;
    }

    private void publish(Row row) {
        redis.execute((RedisCallback<Object>) c -> c.execute("XADD", bytes(row.stream()), bytes("MAXLEN"), bytes("~"),
                bytes("10000"), bytes("*"), bytes("type"), bytes(row.type()), bytes("data"), bytes(row.payload())));
    }

    private static byte[] bytes(String s) {
        return s.getBytes(UTF_8);
    }
}

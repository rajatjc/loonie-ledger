package io.github.rajatjc.loonie.payments;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rajatjc.loonie.payments.Model.Account;
import io.github.rajatjc.loonie.payments.Model.Status;
import io.github.rajatjc.loonie.payments.Model.Transfer;
import io.github.rajatjc.loonie.payments.Model.TransferRequest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.data.redis.connection.stream.StreamRecords;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Predicate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * Runs payments against real Postgres and Redis, and plays the fraud and
 * compliance services by writing their verdicts to the decision streams.
 */
@SpringBootTest
@Testcontainers
class TransferFlowTest {
    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Container
    @ServiceConnection(name = "redis")
    static GenericContainer<?> redis = new GenericContainer<>("redis:7-alpine").withExposedPorts(6379);

    @Autowired TransferService service;
    @Autowired Transfers transfers;
    @Autowired Accounts accounts;
    @Autowired StringRedisTemplate redisTemplate;
    @Autowired ObjectMapper json;

    @Test
    void cleanTransferMovesMoneyOnceBothChecksPass() throws Exception {
        long mayaBefore = balance("maya-chq");
        long liamBefore = balance("liam-chq");
        Transfer t = service.request(new TransferRequest("maya-chq", "liam-chq", 2_500, "Coffee"));
        assertEquals(Status.PENDING, t.status());
        assertEquals(2_500, accounts.find("maya-chq").orElseThrow().heldCents(), "funds are held while checks run");

        verdict(DecisionConsumer.FRAUD, Map.of("transferId", t.id().toString(), "decision", "PASS", "score", 20,
                "reasons", List.of("New recipient")));
        Thread.sleep(500);
        assertEquals(Status.PENDING, transfers.find(t.id()).orElseThrow().status(), "one check isn't enough");

        verdict(DecisionConsumer.COMPLIANCE, Map.of("transferId", t.id().toString(), "decision", "CLEAR"));
        Transfer done = await(t.id(), x -> x.status() == Status.COMPLETED);
        assertEquals(20, done.fraud().score());
        assertEquals(mayaBefore - 2_500, balance("maya-chq"));
        assertEquals(liamBefore + 2_500, balance("liam-chq"));
        assertEquals(0, accounts.find("maya-chq").orElseThrow().heldCents());
    }

    @Test
    void flaggedTransferWaitsForReviewAndRejectionReleasesFunds() throws Exception {
        long before = balance("noah-chq");
        Transfer t = service.request(new TransferRequest("noah-chq", "aisha-chq", 1_200_000, "Car"));
        verdict(DecisionConsumer.FRAUD, Map.of("transferId", t.id().toString(), "decision", "PASS", "score", 30, "reasons", List.of()));
        verdict(DecisionConsumer.COMPLIANCE, Map.of("transferId", t.id().toString(), "decision", "REVIEW",
                "reason", "Large transaction: $12,000.00", "reportId", "LTR-1"));
        await(t.id(), x -> x.status() == Status.HELD);

        // A redelivered verdict must not change anything.
        verdict(DecisionConsumer.COMPLIANCE, Map.of("transferId", t.id().toString(), "decision", "CLEAR"));
        Thread.sleep(500);
        assertEquals("REVIEW", transfers.find(t.id()).orElseThrow().compliance().decision());

        Transfer rejected = service.reject(t.id(), "Customer called to cancel");
        assertEquals(Status.REJECTED, rejected.status());
        assertEquals(before, balance("noah-chq"));
        assertEquals(0, accounts.find("noah-chq").orElseThrow().heldCents());
        assertThrows(ApiException.class, () -> service.approve(t.id(), null), "can't approve twice");
    }

    @Test
    void refusesToOverdraw() {
        Account aisha = accounts.find("aisha-chq").orElseThrow();
        ApiException e = assertThrows(ApiException.class,
                () -> service.request(new TransferRequest("aisha-chq", "maya-chq", aisha.availableCents() + 1, "")));
        assertTrue(e.getMessage().contains("insufficient"));
    }

    private long balance(String account) {
        return accounts.find(account).orElseThrow().balanceCents();
    }

    private void verdict(String stream, Map<String, Object> data) throws Exception {
        redisTemplate.opsForStream().add(StreamRecords.string(Map.of("type", "Verdict", "data", json.writeValueAsString(data)))
                .withStreamKey(stream));
    }

    private Transfer await(UUID id, Predicate<Transfer> done) throws InterruptedException {
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (System.nanoTime() < deadline) {
            Transfer t = transfers.find(id).orElseThrow();
            if (done.test(t)) {
                return t;
            }
            Thread.sleep(100);
        }
        fail("transfer never reached the expected state: " + transfers.find(id).orElseThrow());
        return null;
    }
}

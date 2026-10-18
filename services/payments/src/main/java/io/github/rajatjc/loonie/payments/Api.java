package io.github.rajatjc.loonie.payments;

import io.github.rajatjc.loonie.payments.Model.Customer;
import io.github.rajatjc.loonie.payments.Model.ReviewRequest;
import io.github.rajatjc.loonie.payments.Model.Status;
import io.github.rajatjc.loonie.payments.Model.Transfer;
import io.github.rajatjc.loonie.payments.Model.TransferRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api")
class Api {
    private final Accounts accounts;
    private final Transfers transfers;
    private final TransferService service;
    private final DecisionConsumer consumer;
    private final Outbox outbox;
    private final String adminToken;

    Api(Accounts accounts, Transfers transfers, TransferService service, DecisionConsumer consumer, Outbox outbox,
        @Value("${loonie.admin-token}") String adminToken) {
        this.accounts = accounts;
        this.transfers = transfers;
        this.service = service;
        this.consumer = consumer;
        this.outbox = outbox;
        this.adminToken = adminToken;
    }

    @GetMapping("/customers")
    List<Customer> customers() {
        return accounts.customers();
    }

    @GetMapping("/customers/{id}/transfers")
    List<Transfer> customerTransfers(@PathVariable String id, @RequestParam(defaultValue = "50") int limit) {
        return transfers.forCustomer(id, clamp(limit));
    }

    /** All transfers, or only one status (the review queue uses status=HELD). */
    @GetMapping("/transfers")
    List<Transfer> list(@RequestParam(required = false) Status status, @RequestParam(defaultValue = "50") int limit) {
        return status == null ? transfers.recent(clamp(limit)) : transfers.withStatus(status, clamp(limit));
    }

    @GetMapping("/transfers/{id}")
    Transfer get(@PathVariable UUID id) {
        return transfers.find(id).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "no transfer " + id));
    }

    @PostMapping("/transfers")
    ResponseEntity<Transfer> create(@RequestBody TransferRequest req) {
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(service.request(req));
    }

    @PostMapping("/transfers/{id}/approve")
    Transfer approve(@PathVariable UUID id, @RequestBody(required = false) ReviewRequest req) {
        return service.approve(id, req == null ? null : req.note());
    }

    @PostMapping("/transfers/{id}/reject")
    Transfer reject(@PathVariable UUID id, @RequestBody(required = false) ReviewRequest req) {
        return service.reject(id, req == null ? null : req.note());
    }

    @GetMapping("/stats")
    Map<String, Object> stats() {
        Map<String, Object> out = new LinkedHashMap<>(transfers.stats());
        out.put("outboxBacklog", outbox.backlog());
        out.put("consumerPaused", consumer.paused());
        return out;
    }

    /** Pauses or resumes reading verdicts; used by the ops console. */
    @PostMapping("/admin/consumer/{action}")
    Map<String, Object> consumer(@PathVariable String action, @RequestHeader(value = "X-Admin-Token", required = false) String token) {
        if (!adminToken.equals(token)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "admin token required");
        }
        switch (action) {
            case "pause" -> consumer.pause(true);
            case "resume" -> consumer.pause(false);
            default -> throw new ApiException(HttpStatus.NOT_FOUND, "use pause or resume");
        }
        return Map.of("paused", consumer.paused());
    }

    private static int clamp(int limit) {
        return Math.max(1, Math.min(limit, 200));
    }

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Map<String, String>> apiError(ApiException e) {
        return ResponseEntity.status(e.status).body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<Map<String, String>> badRequest(IllegalArgumentException e) {
        return ResponseEntity.badRequest().body(Map.of("error", String.valueOf(e.getMessage())));
    }
}

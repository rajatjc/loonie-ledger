package io.github.rajatjc.loonie.payments;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** API and event shapes. Money is always in cents. */
public final class Model {
    public enum Status {
        /** Funds are held while fraud and compliance check the transfer. */
        PENDING,
        /** Moved: the sender was debited and the recipient credited. */
        COMPLETED,
        /** A check flagged it; funds stay held until a reviewer decides. */
        HELD,
        /** A reviewer declined it; the hold was released. */
        REJECTED
    }

    public record Account(String id, String customerId, String name, String currency,
                          long balanceCents, long heldCents) {
        public long availableCents() {
            return balanceCents - heldCents;
        }
    }

    public record Customer(String id, String name, String email, String city, List<Account> accounts) {}

    public record Party(String customerId, String name, String accountId, String accountName) {}

    public record Fraud(String decision, int score, List<String> reasons) {}

    public record Compliance(String decision, String reason, String reportId) {}

    public record Review(String note, Instant at) {}

    public record Transfer(UUID id, Party from, Party to, long amountCents, String currency, String memo,
                           Status status, Fraud fraud, Compliance compliance, Review review,
                           Instant createdAt, Instant updatedAt) {}

    public record TransferRequest(String fromAccountId, String toAccountId, long amountCents, String memo) {}

    public record ReviewRequest(String note) {}

    private Model() {}
}

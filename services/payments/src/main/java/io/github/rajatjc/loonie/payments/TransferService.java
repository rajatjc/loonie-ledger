package io.github.rajatjc.loonie.payments;

import io.github.rajatjc.loonie.payments.Model.Account;
import io.github.rajatjc.loonie.payments.Model.Status;
import io.github.rajatjc.loonie.payments.Model.Transfer;
import io.github.rajatjc.loonie.payments.Model.TransferRequest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The money rules. A transfer reserves the sender's funds, then waits for both
 * the fraud and the compliance decision. Only when both pass does money move;
 * if either flags it, the funds stay held until a reviewer decides.
 */
@Service
class TransferService {
    static final long MAX_TRANSFER_CENTS = 5_000_000; // $50,000 per transfer

    private final Accounts accounts;
    private final Transfers transfers;
    private final Outbox outbox;
    private final JdbcTemplate db;

    TransferService(Accounts accounts, Transfers transfers, Outbox outbox, JdbcTemplate db) {
        this.accounts = accounts;
        this.transfers = transfers;
        this.outbox = outbox;
        this.db = db;
    }

    @Transactional
    Transfer request(TransferRequest req) {
        String memo = req.memo() == null ? "" : req.memo().strip();
        if (req.amountCents() <= 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "amount must be positive");
        }
        if (req.amountCents() > MAX_TRANSFER_CENTS) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "transfers are limited to $50,000");
        }
        if (memo.length() > 140) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "memo must be at most 140 characters");
        }
        if (req.fromAccountId() == null || req.fromAccountId().equals(req.toAccountId())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "choose two different accounts");
        }
        Account from = accounts.lock(req.fromAccountId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "no account " + req.fromAccountId()));
        Account to = accounts.find(req.toAccountId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "no account " + req.toAccountId()));
        if (from.availableCents() < req.amountCents()) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "insufficient funds");
        }

        UUID id = UUID.randomUUID();
        accounts.hold(from.id(), req.amountCents());
        transfers.insert(id, from.id(), to.id(), req.amountCents(), memo);
        Transfer t = transfers.find(id).orElseThrow();
        outbox.add(Outbox.TRANSFERS, "TransferRequested", requested(t));
        outbox.add(Outbox.UPDATES, "TransferUpdated", t);
        return t;
    }

    @Transactional
    void onFraudDecision(UUID id, String decision, int score, List<String> reasons) {
        if (transfers.recordFraud(id, decision, score, reasons)) {
            settleIfDecided(id);
        }
    }

    @Transactional
    void onComplianceDecision(UUID id, String decision, String reason, String reportId) {
        if (transfers.recordCompliance(id, decision, reason, reportId)) {
            settleIfDecided(id);
        }
    }

    @Transactional
    Transfer approve(UUID id, String note) {
        Transfer t = heldForReview(id);
        complete(t);
        transfers.setReview(id, note == null || note.isBlank() ? "Approved" : note.strip());
        return publish(id);
    }

    @Transactional
    Transfer reject(UUID id, String note) {
        Transfer t = heldForReview(id);
        accounts.release(t.from().accountId(), t.amountCents());
        transfers.setStatus(id, Status.REJECTED);
        transfers.setReview(id, note == null || note.isBlank() ? "Rejected" : note.strip());
        return publish(id);
    }

    private Transfer heldForReview(UUID id) {
        Transfer t = transfers.lock(id).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "no transfer " + id));
        if (t.status() != Status.HELD) {
            throw new ApiException(HttpStatus.CONFLICT, "transfer is " + t.status() + ", not HELD");
        }
        return t;
    }

    private void settleIfDecided(UUID id) {
        Transfer t = transfers.lock(id).orElseThrow();
        if (t.status() == Status.PENDING && t.fraud() != null && t.compliance() != null) {
            boolean clean = "PASS".equals(t.fraud().decision()) && "CLEAR".equals(t.compliance().decision());
            if (clean) {
                complete(t);
            } else {
                transfers.setStatus(id, Status.HELD);
            }
        }
        publish(id); // the UI shows each check as it lands
    }

    /** Moves the money: debit the held funds, credit the recipient, and record both ledger legs. */
    private void complete(Transfer t) {
        // Lock both accounts in a fixed order so two opposite transfers can't deadlock.
        String a = t.from().accountId().compareTo(t.to().accountId()) < 0 ? t.from().accountId() : t.to().accountId();
        String b = a.equals(t.from().accountId()) ? t.to().accountId() : t.from().accountId();
        accounts.lock(a);
        accounts.lock(b);
        accounts.debitHeld(t.from().accountId(), t.amountCents());
        accounts.credit(t.to().accountId(), t.amountCents());
        db.update("insert into ledger_entries (transfer_id, account_id, amount_cents) values (?, ?, ?), (?, ?, ?)",
                t.id(), t.from().accountId(), -t.amountCents(), t.id(), t.to().accountId(), t.amountCents());
        transfers.setStatus(t.id(), Status.COMPLETED);
    }

    private Transfer publish(UUID id) {
        Transfer t = transfers.find(id).orElseThrow();
        outbox.add(Outbox.UPDATES, "TransferUpdated", t);
        return t;
    }

    /** The event fraud and compliance consume: just the facts they need. */
    private static Map<String, Object> requested(Transfer t) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("transferId", t.id().toString());
        e.put("fromAccountId", t.from().accountId());
        e.put("fromCustomerId", t.from().customerId());
        e.put("fromCustomerName", t.from().name());
        e.put("toAccountId", t.to().accountId());
        e.put("toCustomerId", t.to().customerId());
        e.put("toCustomerName", t.to().name());
        e.put("amountCents", t.amountCents());
        e.put("currency", t.currency());
        e.put("memo", t.memo());
        e.put("createdAt", t.createdAt().toString());
        e.put("publishedAt", Instant.now().toString());
        return e;
    }
}

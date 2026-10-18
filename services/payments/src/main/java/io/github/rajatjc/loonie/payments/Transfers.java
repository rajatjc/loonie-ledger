package io.github.rajatjc.loonie.payments;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.rajatjc.loonie.payments.Model.Compliance;
import io.github.rajatjc.loonie.payments.Model.Fraud;
import io.github.rajatjc.loonie.payments.Model.Party;
import io.github.rajatjc.loonie.payments.Model.Review;
import io.github.rajatjc.loonie.payments.Model.Status;
import io.github.rajatjc.loonie.payments.Model.Transfer;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Repository
class Transfers {
    private static final String SELECT = """
            select t.*, fa.customer_id as from_customer, fc.name as from_name, fa.name as from_account_name,
                   ta.customer_id as to_customer, tc.name as to_name, ta.name as to_account_name, fa.currency
            from transfers t
            join accounts fa on fa.id = t.from_account join customers fc on fc.id = fa.customer_id
            join accounts ta on ta.id = t.to_account join customers tc on tc.id = ta.customer_id
            """;

    private final JdbcTemplate db;
    private final ObjectMapper json;
    private final RowMapper<Transfer> mapper = this::map;

    Transfers(JdbcTemplate db, ObjectMapper json) {
        this.db = db;
        this.json = json;
    }

    void insert(UUID id, String from, String to, long amountCents, String memo) {
        db.update("insert into transfers (id, from_account, to_account, amount_cents, memo, status) values (?, ?, ?, ?, ?, ?)",
                id, from, to, amountCents, memo, Status.PENDING.name());
    }

    Optional<Transfer> find(UUID id) {
        return db.query(SELECT + " where t.id = ?", mapper, id).stream().findFirst();
    }

    /** Locks the transfer row so two decisions or reviews can't settle it twice. */
    Optional<Transfer> lock(UUID id) {
        db.query("select id from transfers where id = ? for update", (rs, i) -> rs.getObject(1), id);
        return find(id);
    }

    List<Transfer> forCustomer(String customerId, int limit) {
        return db.query(SELECT + " where fa.customer_id = ? or ta.customer_id = ? order by t.created_at desc limit ?",
                mapper, customerId, customerId, limit);
    }

    List<Transfer> withStatus(Status status, int limit) {
        return db.query(SELECT + " where t.status = ? order by t.created_at desc limit ?", mapper, status.name(), limit);
    }

    List<Transfer> recent(int limit) {
        return db.query(SELECT + " order by t.created_at desc limit ?", mapper, limit);
    }

    /** Returns false if a fraud decision was already recorded (redelivered event). */
    boolean recordFraud(UUID id, String decision, int score, List<String> reasons) {
        return db.update("""
                update transfers set fraud_decision = ?, fraud_score = ?, fraud_reasons = ?, updated_at = now()
                where id = ? and fraud_decision is null""", decision, score, write(reasons), id) == 1;
    }

    boolean recordCompliance(UUID id, String decision, String reason, String reportId) {
        return db.update("""
                update transfers set compliance_decision = ?, compliance_reason = ?, report_id = ?, updated_at = now()
                where id = ? and compliance_decision is null""", decision, reason, reportId, id) == 1;
    }

    void setStatus(UUID id, Status status) {
        db.update("update transfers set status = ?, updated_at = now() where id = ?", status.name(), id);
    }

    void setReview(UUID id, String note) {
        db.update("update transfers set review_note = ?, reviewed_at = now() where id = ?", note, id);
    }

    Map<String, Object> stats() {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Status s : Status.values()) {
            out.put(s.name().toLowerCase(), 0L);
        }
        db.query("select status, count(*) from transfers group by status",
                rs -> { out.put(rs.getString(1).toLowerCase(), rs.getLong(2)); });
        out.put("completedVolumeCents", db.queryForObject(
                "select coalesce(sum(amount_cents), 0) from transfers where status = 'COMPLETED'", Long.class));
        return out;
    }

    private Transfer map(ResultSet rs, int row) throws SQLException {
        String fraudDecision = rs.getString("fraud_decision");
        String complianceDecision = rs.getString("compliance_decision");
        Timestamp reviewedAt = rs.getTimestamp("reviewed_at");
        return new Transfer(
                rs.getObject("id", UUID.class),
                new Party(rs.getString("from_customer"), rs.getString("from_name"), rs.getString("from_account"), rs.getString("from_account_name")),
                new Party(rs.getString("to_customer"), rs.getString("to_name"), rs.getString("to_account"), rs.getString("to_account_name")),
                rs.getLong("amount_cents"),
                rs.getString("currency"),
                rs.getString("memo"),
                Status.valueOf(rs.getString("status")),
                fraudDecision == null ? null : new Fraud(fraudDecision, rs.getInt("fraud_score"), read(rs.getString("fraud_reasons"))),
                complianceDecision == null ? null : new Compliance(complianceDecision, rs.getString("compliance_reason"), rs.getString("report_id")),
                reviewedAt == null ? null : new Review(rs.getString("review_note"), reviewedAt.toInstant()),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }

    private String write(List<String> reasons) {
        try {
            return json.writeValueAsString(reasons);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private List<String> read(String reasons) {
        try {
            return reasons == null ? List.of() : json.readValue(reasons, new TypeReference<>() {});
        } catch (JsonProcessingException e) {
            return List.of(reasons);
        }
    }
}

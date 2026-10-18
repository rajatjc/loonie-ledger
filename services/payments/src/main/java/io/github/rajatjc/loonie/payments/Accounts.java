package io.github.rajatjc.loonie.payments;

import io.github.rajatjc.loonie.payments.Model.Account;
import io.github.rajatjc.loonie.payments.Model.Customer;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
class Accounts {
    private static final RowMapper<Account> ACCOUNT = (rs, i) -> new Account(rs.getString("id"),
            rs.getString("customer_id"), rs.getString("name"), rs.getString("currency"),
            rs.getLong("balance_cents"), rs.getLong("held_cents"));

    private final JdbcTemplate db;

    Accounts(JdbcTemplate db) {
        this.db = db;
    }

    List<Customer> customers() {
        List<Account> all = db.query("select * from accounts order by id", ACCOUNT);
        return db.query("select * from customers order by name", (rs, i) -> {
            String id = rs.getString("id");
            return new Customer(id, rs.getString("name"), rs.getString("email"), rs.getString("city"),
                    all.stream().filter(a -> a.customerId().equals(id)).toList());
        });
    }

    Optional<Account> find(String id) {
        return db.query("select * from accounts where id = ?", ACCOUNT, id).stream().findFirst();
    }

    /** Locks the row until the transaction ends, so concurrent transfers can't overdraw it. */
    Optional<Account> lock(String id) {
        return db.query("select * from accounts where id = ? for update", ACCOUNT, id).stream().findFirst();
    }

    void hold(String id, long cents) {
        db.update("update accounts set held_cents = held_cents + ? where id = ?", cents, id);
    }

    void release(String id, long cents) {
        db.update("update accounts set held_cents = held_cents - ? where id = ?", cents, id);
    }

    /** Settles a held amount: the money leaves the balance and the hold. */
    void debitHeld(String id, long cents) {
        db.update("update accounts set balance_cents = balance_cents - ?, held_cents = held_cents - ? where id = ?",
                cents, cents, id);
    }

    void credit(String id, long cents) {
        db.update("update accounts set balance_cents = balance_cents + ? where id = ?", cents, id);
    }
}

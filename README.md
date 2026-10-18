# Loonie Ledger

A demo Canadian neobank built from small services that only talk through Redis Streams.
Work in progress: pieces are being added one at a time.

## So far

- [`services/payments`](services/payments): Java 21 + Spring Boot. Accounts, transfers, a double-entry ledger, and a transactional outbox. Money moves only after both the fraud and the compliance checks pass.

Not a real bank.

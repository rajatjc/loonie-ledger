# Loonie Ledger

A demo Canadian neobank built from small services that only talk through Redis Streams.
Work in progress: pieces are being added one at a time.

## So far

- [`services/payments`](services/payments): Java 21 + Spring Boot. Accounts, transfers, a double-entry ledger, and a transactional outbox. Money moves only after both the fraud and the compliance checks pass.
- [`services/fraud`](services/fraud): Python + FastAPI. Scores every transfer with explainable rules and holds risky ones for review.
- [`services/compliance`](services/compliance): Node.js + TypeScript. $10,000 large-transaction reviews, 24-hour structuring checks, and a hash-chained audit log.

Not a real bank.

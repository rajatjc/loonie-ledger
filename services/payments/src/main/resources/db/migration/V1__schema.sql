create table customers (
    id    text primary key,
    name  text not null,
    email text not null,
    city  text not null
);

-- held_cents is money reserved by transfers that are still being checked.
create table accounts (
    id            text primary key,
    customer_id   text   not null references customers (id),
    name          text   not null,
    currency      text   not null default 'CAD',
    balance_cents bigint not null check (balance_cents >= 0),
    held_cents    bigint not null default 0 check (held_cents >= 0),
    check (held_cents <= balance_cents)
);

create table transfers (
    id                  uuid primary key,
    from_account        text   not null references accounts (id),
    to_account          text   not null references accounts (id),
    amount_cents        bigint not null check (amount_cents > 0),
    memo                text   not null default '',
    status              text   not null,
    fraud_decision      text,
    fraud_score         int,
    fraud_reasons       text,
    compliance_decision text,
    compliance_reason   text,
    report_id           text,
    review_note         text,
    reviewed_at         timestamptz,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);
create index transfers_from on transfers (from_account, created_at desc);
create index transfers_to on transfers (to_account, created_at desc);
create index transfers_status on transfers (status);

-- Double-entry: every completed transfer writes a debit and a matching credit.
create table ledger_entries (
    id           bigserial primary key,
    transfer_id  uuid   not null references transfers (id),
    account_id   text   not null references accounts (id),
    amount_cents bigint not null,
    created_at   timestamptz not null default now()
);

-- Transactional outbox: events are written in the same transaction as the
-- change they describe, then relayed to Redis, so none are lost.
create table outbox (
    id         bigserial primary key,
    stream     text not null,
    type       text not null,
    payload    text not null,
    created_at timestamptz not null default now()
);

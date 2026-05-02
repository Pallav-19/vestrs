# Database Design

**Engine:** PostgreSQL  
**ORM:** Prisma

---

## Entity Relationship Diagram

```
┌──────────────────────────────────────┐
│                users                 │
├──────────────────────────────────────┤
│ id              UUID        PK       │
│ name            VARCHAR(100)         │
│ email           VARCHAR(255) UNIQUE  │
│ phone           VARCHAR(20)          │
│ password_hash   TEXT                 │
│ nationality     CHAR(2)   ← ISO 3166 │
│ domicile        CHAR(2)   ← ISO 3166 │
│ onboarding_step ENUM                 │
│ created_at      TIMESTAMPTZ          │
│ updated_at      TIMESTAMPTZ          │
└──────┬───────────────────────────────┘
       │
       │ 1:N (all child tables)
       │
       ├──────────────────────────────────────────────────────────────┐
       │                          │                    │              │
┌──────▼──────────┐  ┌───────────▼───────┐  ┌────────▼──────┐  ┌───▼──────────┐
│   kyc_checks    │  │  accred_checks    │  │ bank_accounts │  │  audit_logs  │
├─────────────────┤  ├───────────────────┤  ├───────────────┤  ├──────────────┤
│ id      UUID PK │  │ id      UUID PK   │  │ id    UUID PK │  │ id   UUID PK │
│ user_id UUID FK │  │ user_id UUID FK   │  │ user_id FK    │  │ user_id FK   │
│ provider ENUM   │  │ provider ENUM     │  │ provider TEXT │  │ action ENUM  │
│ ref_id  TEXT    │  │ ref_id  TEXT      │  │ masked_number │  │ status ENUM  │
│ status  ENUM    │  │ status  ENUM      │  │ bank_name     │  │ metadata     │
│ attempt INT     │  │ attempt INT       │  │ account_type  │  │   JSONB      │
│ response JSONB  │  │ response  JSONB   │  │ balance DEC   │  │ ip_address   │
│ created_at TSTZ │  │ created_at TSTZ   │  │ status ENUM   │  │ created_at   │
│ updated_at TSTZ │  │ updated_at TSTZ   │  │ created_at    │  └──────────────┘
└─────────────────┘  └───────────────────┘  └───────┬───────┘
                                                     │
                                                     │ 1:N
                                            ┌────────▼──────────┐
                                            │    investments    │
                                            ├───────────────────┤
                                            │ id       UUID PK  │
                                            │ user_id  UUID FK  │
                                            │ bank_account_id FK│
                                            │ amount   DECIMAL  │
                                            │ currency CHAR(3)  │
                                            │ dest_account TEXT │
                                            │ tx_ref   TEXT UQ  │
                                            │ status   ENUM     │
                                            │ created_at TSTZ   │
                                            └───────────────────┘
```

---

## Table Definitions

### `users`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | UUID | PK, DEFAULT gen_random_uuid() | |
| name | VARCHAR(100) | NOT NULL | |
| email | VARCHAR(255) | NOT NULL, UNIQUE | Lowercased before insert |
| phone | VARCHAR(20) | NOT NULL | E.164 format |
| password_hash | TEXT | NOT NULL | bcrypt, cost=12 |
| nationality | CHAR(2) | NOT NULL | ISO 3166-1 alpha-2 |
| domicile | CHAR(2) | NOT NULL | ISO 3166-1 alpha-2 |
| onboarding_step | ENUM | NOT NULL, DEFAULT 'registered' | See state machine |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL | Auto-updated via trigger |

**`onboarding_step` enum values:**
```
registered → kyc_initiated → kyc_failed
                           → kyc_success → accred_initiated → accred_failed
                                                            → accred_success → bank_linked → complete
```

---

### `kyc_checks`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | FK → users.id, NOT NULL | |
| provider | ENUM | NOT NULL | `shufti_pro`, `jumio`, `plaid` |
| ref_id | TEXT | NOT NULL | External provider reference ID |
| status | ENUM | NOT NULL, DEFAULT 'pending' | `pending`, `success`, `failure` |
| attempt_number | INT | NOT NULL, DEFAULT 1 | Max 3 |
| response_payload | JSONB | | Raw mock provider response |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

**Indexes:** `user_id`, `(user_id, status)`, `ref_id`

---

### `accred_checks`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | FK → users.id, NOT NULL | |
| provider | ENUM | NOT NULL | `accred`, `veriff`, `shufti_pro` |
| ref_id | TEXT | NOT NULL | |
| status | ENUM | NOT NULL, DEFAULT 'pending' | `pending`, `success`, `failure` |
| attempt_number | INT | NOT NULL, DEFAULT 1 | Max 3 |
| response_payload | JSONB | | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

**Indexes:** `user_id`, `(user_id, status)`, `ref_id`

---

### `bank_accounts`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | FK → users.id, NOT NULL | |
| provider | VARCHAR(50) | NOT NULL | `plaid_mock` |
| provider_account_id | TEXT | NOT NULL | External reference |
| masked_number | VARCHAR(10) | NOT NULL | e.g. `****4242` |
| bank_name | VARCHAR(100) | NOT NULL | |
| account_type | ENUM | NOT NULL | `checking`, `savings` |
| balance | DECIMAL(18,2) | NOT NULL, DEFAULT 0 | Mock balance |
| currency | CHAR(3) | NOT NULL, DEFAULT 'USD' | ISO 4217 |
| status | ENUM | NOT NULL, DEFAULT 'active' | `active`, `unlinked` |
| linked_at | TIMESTAMPTZ | | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

**Indexes:** `user_id`, `(user_id, status)`

---

### `investments`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | FK → users.id, NOT NULL | |
| bank_account_id | UUID | FK → bank_accounts.id, NOT NULL | |
| amount | DECIMAL(18,2) | NOT NULL | Must be > 0 |
| currency | CHAR(3) | NOT NULL, DEFAULT 'USD' | |
| destination_account | TEXT | NOT NULL | Escrow/pooling reference |
| tx_ref | TEXT | NOT NULL, UNIQUE | Internal transaction ID |
| status | ENUM | NOT NULL, DEFAULT 'completed' | `pending`, `completed`, `failed` |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |

**Indexes:** `user_id`, `tx_ref`, `bank_account_id`

---

### `audit_logs`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | FK → users.id, NULLABLE | Null for pre-auth events |
| action | ENUM | NOT NULL | See action enum below |
| status | ENUM | NOT NULL | `success`, `failure`, `pending` |
| metadata | JSONB | | Flexible context (attempt #, ref_id, error) |
| ip_address | INET | | From request headers |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Immutable — no updated_at |

**`action` enum values:**
```
USER_REGISTERED
KYC_INITIATED
KYC_POLL_ATTEMPTED
KYC_COMPLETED
ACCRED_INITIATED
ACCRED_POLL_ATTEMPTED
ACCRED_COMPLETED
BANK_LINK_INITIATED
BANK_LINK_COMPLETED
INVESTMENT_INITIATED
INVESTMENT_COMPLETED
```

**Indexes:** `user_id`, `action`, `created_at DESC`

> `audit_logs` is append-only. No row is ever updated or deleted.

---

## Indexing Strategy

```sql
-- users
CREATE UNIQUE INDEX idx_users_email ON users(LOWER(email));

-- kyc_checks
CREATE INDEX idx_kyc_user_id ON kyc_checks(user_id);
CREATE INDEX idx_kyc_user_status ON kyc_checks(user_id, status);
CREATE INDEX idx_kyc_ref_id ON kyc_checks(ref_id);

-- accred_checks
CREATE INDEX idx_accred_user_id ON accred_checks(user_id);
CREATE INDEX idx_accred_user_status ON accred_checks(user_id, status);

-- bank_accounts
CREATE INDEX idx_bank_user_id ON bank_accounts(user_id);

-- investments
CREATE INDEX idx_inv_user_id ON investments(user_id);
CREATE UNIQUE INDEX idx_inv_tx_ref ON investments(tx_ref);

-- audit_logs
CREATE INDEX idx_audit_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action);
```

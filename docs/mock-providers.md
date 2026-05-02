# Mock Provider Layer

All external provider calls are routed through a dedicated mock layer that lives in `src/mock/`. Every mock implements a typed interface so the real implementation can be swapped in with zero changes to business logic.

---

## Providers Covered

| Provider | Simulates | Used By |
|---|---|---|
| `MockCKYCProvider` | Central KYC Registry (CERSAI / C-KYC) | `KycModule` |
| `MockIdentityProvider` | Shufti Pro / Jumio — document + liveness | `KycModule` |
| `MockAmlProvider` | ComplyAdvantage / Refinitiv World-Check | `KycModule` |
| `MockAccreditationProvider` | Veriff / Accred — SEC accreditation | `AccreditationModule` |
| `MockBankProvider` | Plaid — account linking + balance fetch | `BankModule` |

The `KycModule` calls all three KYC-related providers (CKYC lookup → Identity → AML) in sequence. All three must pass for KYC to succeed.

---

## Folder Structure

```
src/mock/
├── mock.module.ts                        ← exports all providers globally
│
├── controllers/
│   └── mock-webhook.controller.ts        ← simulates inbound provider callbacks
│
├── providers/
│   ├── interfaces/
│   │   ├── kyc-provider.interface.ts
│   │   ├── accreditation-provider.interface.ts
│   │   └── bank-provider.interface.ts
│   │
│   ├── mock-ckyc.provider.ts
│   ├── mock-identity.provider.ts
│   ├── mock-aml.provider.ts
│   ├── mock-accreditation.provider.ts
│   └── mock-bank.provider.ts
│
└── scenarios/
    └── scenario-store.service.ts         ← in-memory scenario override registry
```

---

## Provider Interfaces (Contracts)

These interfaces are what real providers would also implement. Business logic only depends on these, never on mock classes directly.

### `IKycSubProvider`
```typescript
interface KycSubProviderPayload {
  user_id: string;
  name: string;
  email: string;
  nationality: string;
  domicile: string;
}

interface KycSubProviderResponse {
  ref_id: string;
  status: 'success' | 'failure' | 'pending';
  provider: string;
  reason?: string;
}

interface IKycSubProvider {
  initiate(payload: KycSubProviderPayload): Promise<KycSubProviderResponse>;
  poll(ref_id: string): Promise<KycSubProviderResponse>;
}
```

### `IAccreditationProvider`
```typescript
interface AccreditationPayload {
  user_id: string;
  name: string;
  nationality: string;
}

interface AccreditationResponse {
  ref_id: string;
  status: 'success' | 'failure' | 'pending';
  provider: string;
  accreditation_type?: 'income' | 'net_worth' | 'professional';
  reason?: string;
}

interface IAccreditationProvider {
  initiate(payload: AccreditationPayload): Promise<AccreditationResponse>;
  poll(ref_id: string): Promise<AccreditationResponse>;
}
```

### `IBankProvider`
```typescript
interface BankLinkPayload {
  public_token: string;
  account_id: string;
}

interface BankLinkResponse {
  provider_account_id: string;
  masked_number: string;
  bank_name: string;
  account_type: 'checking' | 'savings';
  balance: number;
  currency: string;
}

interface IBankProvider {
  link(payload: BankLinkPayload): Promise<BankLinkResponse>;
  getBalance(provider_account_id: string): Promise<number>;
}
```

---

## Provider Behavior

### 1. `MockCKYCProvider` — Central KYC Registry

Simulates a lookup against a central KYC registry (like India's CERSAI CKYC or a generic cross-border KYC database). Returns immediately (no async) — the registry either has the user or it doesn't.

**Flow:**
1. Receives `{ name, email, nationality }`.
2. Checks `ScenarioStore` for a forced outcome.
3. Generates a deterministic result based on nationality + email hash.
4. Returns `success` (record found, user is pre-verified), `failure` (record found but flagged), or `not_found` (treated as `pending` — triggers full identity check).

**Behavior table:**

| Trigger | Status | Notes |
|---|---|---|
| Email ends in `@blocked.test` | `failure` | Simulates a flagged/sanctioned identity |
| Nationality = `KP` or `IR` | `failure` | Simulates sanctioned country |
| Default (70%) | `success` | Record found in CKYC registry |
| Default (30%) | `not_found` | Not in registry — flow continues to identity check |

**Response:**
```json
{
  "ref_id": "ckyc_abc123",
  "status": "success",
  "provider": "ckyc_registry",
  "ckyc_number": "CKYC-2024-XXXX",
  "reason": null
}
```

---

### 2. `MockIdentityProvider` — Document + Liveness

Simulates Shufti Pro / Jumio. Validates identity document and liveness check. Can be async (returns `pending`).

**Flow:**
1. Receives user payload.
2. Checks `ScenarioStore` for a forced outcome for this `user_id`.
3. Randomizes result using weighted probability.
4. If `pending` → BullMQ polls until resolved.

**Behavior table:**

| Scenario | Probability | Resolves In | Failure Reason |
|---|---|---|---|
| `success` | 60% | Immediate | — |
| `pending` → `success` | 20% | 2–4 poll cycles | — |
| `failure` (doc_expired) | 10% | Immediate | `document_expired` |
| `failure` (liveness_failed) | 5% | Immediate | `liveness_check_failed` |
| `pending` → `failure` | 5% | 3 poll cycles | `face_mismatch` |

**Poll resolution:** Each poll call advances an internal counter on the `ref_id`. Counter >= threshold → resolves.

---

### 3. `MockAmlProvider` — AML / Sanctions Screening

Simulates ComplyAdvantage / Refinitiv World-Check. Checks user against OFAC, UN, EU sanctions lists and PEP (Politically Exposed Persons) database.

**Flow:**
1. Always synchronous — real AML checks return immediately for most users.
2. Checks `ScenarioStore` first.
3. Returns `clear` (mapped to `success`), `hit` (mapped to `failure`), or `review` (mapped to `pending`).

**Behavior table:**

| Trigger | Status | Notes |
|---|---|---|
| Name contains `SANCTION` | `failure` | Simulates OFAC/UN hit |
| Email ends in `@pep.test` | `pending` | Simulates PEP review |
| Nationality = `KP`, `IR`, `CU` | `failure` | High-risk jurisdiction |
| Default | `success` (95%) / `pending` (5%) | |

---

### KYC Composite Flow

All three sub-providers are called in order within `KycService`. The composite result is:

```
CKYC        Identity      AML         Final KYC Status
──────────────────────────────────────────────────────
success   + success   + success   → success
not_found + success   + success   → success (CKYC skipped)
failure   + *         + *         → failure (short-circuit)
*         + failure   + *         → failure (short-circuit)
*         + *         + failure   → failure (short-circuit)
*         + pending   + *         → pending (wait for identity)
```

Short-circuit: if CKYC returns `failure`, identity and AML checks are skipped.

---

### 4. `MockAccreditationProvider` — Investor Accreditation

Simulates Veriff / Accred — verifies user qualifies as an accredited investor under SEC Reg D 506(b)/(c): $200K+ annual income, $1M+ net worth (excluding primary residence), or licensed professional.

**Behavior table:**

| Scenario | Probability | Resolves In | Notes |
|---|---|---|---|
| `success` (income) | 30% | Immediate | |
| `success` (net_worth) | 10% | Immediate | |
| `pending` → `success` | 40% | 4–8 poll cycles | Simulates 12–48h review |
| `failure` (not_qualified) | 15% | Immediate | |
| `pending` → `failure` | 5% | 5 poll cycles | |

Poll cycle delay is configurable via env var `ACCRED_POLL_DELAY_MS` (default: `30000`).

---

### 5. `MockBankProvider` — Plaid-like Bank Linking

Simulates Plaid's token exchange flow: frontend exchanges a public_token for account data.

**Behavior table:**

| Trigger | Status | Notes |
|---|---|---|
| `public_token = mock-fail-token` | failure | |
| `public_token = mock-zero-balance` | success | Returns balance = 0 |
| `public_token = mock-low-balance` | success | Returns balance = $500 |
| Any other token | success | Balance = random $10K–$100K |

**Returned account data:**
```json
{
  "provider_account_id": "mock_acc_a1b2c3",
  "masked_number": "****4242",
  "bank_name": "Mock Chase Bank",
  "account_type": "checking",
  "balance": 47350.00,
  "currency": "USD"
}
```

---

## Scenario Store

`ScenarioStoreService` is an in-memory singleton that lets you pin a specific outcome for a `user_id` + `provider` pair. Used for deterministic testing without changing probability weights.

### Override an outcome (dev/test only)

```
POST /mock/scenarios
```

Body:
```json
{
  "user_id": "uuid",
  "provider": "identity",
  "outcome": "failure",
  "reason": "document_expired"
}
```

`provider` values: `ckyc` | `identity` | `aml` | `accreditation` | `bank`
`outcome` values: `success` | `failure` | `pending`

This endpoint is **only registered when `NODE_ENV !== 'production'`**.

### Clear override

```
DELETE /mock/scenarios/:user_id/:provider
```

---

## Webhook Simulation

In production, providers POST to your webhook URL when async jobs complete (instead of you polling). The mock layer exposes a webhook endpoint to simulate this path.

### Simulate a provider callback

```
POST /mock/webhooks/kyc/:ref_id
POST /mock/webhooks/accreditation/:ref_id
```

Body:
```json
{
  "status": "success",
  "reason": null
}
```

**What it does:**
1. Looks up the `kyc_check` / `accred_check` by `ref_id`.
2. Updates the record status.
3. If `success` → advances `user.onboarding_step`.
4. Inserts audit log.
5. Cancels any pending BullMQ poll jobs for this `ref_id`.

This endpoint is also **only registered when `NODE_ENV !== 'production'`**.

---

## Mock Endpoints Summary

All mock endpoints are prefixed `/mock` and only active in `development` and `test` environments.

| Method | Path | Description |
|---|---|---|
| POST | `/mock/scenarios` | Pin a scenario for a user+provider |
| DELETE | `/mock/scenarios/:user_id/:provider` | Clear a pinned scenario |
| GET | `/mock/scenarios` | List all active scenarios |
| POST | `/mock/webhooks/kyc/:ref_id` | Simulate KYC provider webhook |
| POST | `/mock/webhooks/accreditation/:ref_id` | Simulate accreditation webhook |

---

## Adding a Real Provider

When integrating a real provider (e.g., actual Shufti Pro):

1. Create `src/providers/shufti-pro.provider.ts` implementing `IKycSubProvider`.
2. In `KycModule`, swap `MockIdentityProvider` for `ShuftiProProvider` via NestJS DI token:

```typescript
// kyc.module.ts
providers: [
  {
    provide: IDENTITY_PROVIDER_TOKEN,
    useClass: process.env.NODE_ENV === 'production'
      ? ShuftiProProvider
      : MockIdentityProvider,
  },
],
```

No changes to `KycService`.

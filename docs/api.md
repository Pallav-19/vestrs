# API Documentation

**Base URL:** `/api/v1`  
**Auth:** Bearer JWT in `Authorization` header  
**Content-Type:** `application/json`

---

## Standard Response Envelope

```json
{
  "success": true,
  "data": { ... },
  "message": "Human readable message"
}
```

**Error response:**
```json
{
  "success": false,
  "error": {
    "code": "KYC_ALREADY_PENDING",
    "message": "A KYC check is already in progress"
  },
  "statusCode": 409
}
```

---

## Auth

### POST `/auth/register`

Onboard a new user. Returns JWT tokens.

**Body:**
```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+14155552671",
  "password": "SecurePass123!",
  "nationality": "US",
  "domicile": "US"
}
```

**Validations:**
- `email` — valid email format, must be unique
- `phone` — E.164 format (`+` followed by 7–15 digits)
- `nationality` / `domicile` — ISO 3166-1 alpha-2 (2-letter country code)
- `password` — min 8 chars, at least one uppercase, one number, one special char

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "onboarding_step": "registered"
    },
    "tokens": {
      "access_token": "eyJ...",
      "refresh_token": "eyJ..."
    }
  }
}
```

**Errors:**
| Code | HTTP | Meaning |
|---|---|---|
| `EMAIL_TAKEN` | 409 | Email already registered |
| `VALIDATION_ERROR` | 422 | Invalid field values |

---

### POST `/auth/login`

**Body:**
```json
{
  "email": "jane@example.com",
  "password": "SecurePass123!"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "user": { "id": "uuid", "email": "...", "onboarding_step": "kyc_success" },
    "tokens": {
      "access_token": "eyJ...",
      "refresh_token": "eyJ..."
    }
  }
}
```

---

### POST `/auth/refresh`

Exchange a refresh token for a new access token.

**Body:**
```json
{ "refresh_token": "eyJ..." }
```

**Response `200`:**
```json
{
  "success": true,
  "data": { "access_token": "eyJ..." }
}
```

---

### GET `/auth/me`

Returns current user profile with onboarding step.

**Headers:** `Authorization: Bearer <access_token>`

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+14155552671",
    "nationality": "US",
    "domicile": "US",
    "onboarding_step": "kyc_success",
    "created_at": "2025-05-01T10:00:00Z"
  }
}
```

---

## KYC

> Required `onboarding_step` to initiate: `registered`

### POST `/kyc/initiate`

Triggers a KYC/AML/Liveliness check with the mock provider.

**Headers:** `Authorization: Bearer <access_token>`

**Body:** _(empty — user data pulled from JWT)_

**Response `202`:**
```json
{
  "success": true,
  "data": {
    "ref_id": "kyc_mock_abc123",
    "status": "pending",
    "attempt_number": 1,
    "message": "KYC check initiated. Poll /kyc/status for updates."
  }
}
```

**Errors:**
| Code | HTTP | Meaning |
|---|---|---|
| `STEP_NOT_ALLOWED` | 403 | User not at correct onboarding step |
| `KYC_ALREADY_PENDING` | 409 | Active pending check exists |
| `MAX_ATTEMPTS_REACHED` | 422 | 3 attempts exhausted |

---

### GET `/kyc/status`

Returns the latest KYC check status.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "status": "pending",
    "ref_id": "kyc_mock_abc123",
    "attempt_number": 1,
    "provider": "shufti_pro",
    "created_at": "2025-05-01T10:05:00Z",
    "updated_at": "2025-05-01T10:05:30Z"
  }
}
```

`status` is one of: `pending` | `success` | `failure`

---

### POST `/kyc/retry`

Initiate a new KYC attempt after a failure. Only allowed when current status is `failure` and attempt count < 3.

**Response `202`:** Same shape as `/kyc/initiate`.

**Errors:**
| Code | HTTP | Meaning |
|---|---|---|
| `KYC_NOT_FAILED` | 409 | Latest check is not in failure state |
| `MAX_ATTEMPTS_REACHED` | 422 | 3 attempts exhausted |

---

## Accreditation

> Required `onboarding_step`: `kyc_success`

### POST `/accreditation/initiate`

Triggers an investor accreditation check. May resolve asynchronously (simulating 12–48h).

**Response `202`:**
```json
{
  "success": true,
  "data": {
    "ref_id": "accred_mock_xyz789",
    "status": "pending",
    "attempt_number": 1,
    "message": "Accreditation check initiated. This may take up to 48 hours."
  }
}
```

---

### GET `/accreditation/status`

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "status": "success",
    "ref_id": "accred_mock_xyz789",
    "provider": "veriff",
    "attempt_number": 1,
    "created_at": "2025-05-01T11:00:00Z",
    "updated_at": "2025-05-01T14:30:00Z"
  }
}
```

---

### POST `/accreditation/retry`

Same semantics as `/kyc/retry`.

---

## Bank

> Required `onboarding_step`: `accred_success`

### POST `/bank/link`

Links a bank account via the mock Plaid-like provider.

**Body:**
```json
{
  "public_token": "mock-sandbox-token-abc",
  "account_id": "mock-account-001"
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "masked_number": "****4242",
    "bank_name": "Mock Chase Bank",
    "account_type": "checking",
    "balance": 50000.00,
    "currency": "USD",
    "status": "active"
  }
}
```

**Errors:**
| Code | HTTP | Meaning |
|---|---|---|
| `BANK_LINK_FAILED` | 422 | Mock provider rejected the token |

---

### GET `/bank/accounts`

Returns all linked bank accounts for the current user.

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "masked_number": "****4242",
      "bank_name": "Mock Chase Bank",
      "account_type": "checking",
      "balance": 49000.00,
      "currency": "USD",
      "status": "active",
      "linked_at": "2025-05-01T12:00:00Z"
    }
  ]
}
```

---

### DELETE `/bank/accounts/:id`

Unlinks a bank account.

**Response `200`:**
```json
{ "success": true, "message": "Bank account unlinked." }
```

---

## Investments

> Required `onboarding_step`: `complete`

### POST `/investments`

Creates an investment — funds move from the linked bank account to the escrow account atomically.

**Body:**
```json
{
  "bank_account_id": "uuid",
  "amount": 5000.00,
  "currency": "USD"
}
```

**Validations:**
- `amount` > 0
- `bank_account_id` must belong to the requesting user and be `active`
- `bank_account.balance` >= `amount`

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "tx_ref": "TXN-2025-abc123",
    "amount": 5000.00,
    "currency": "USD",
    "destination_account": "ESCROW-MOCK-001",
    "status": "completed",
    "created_at": "2025-05-01T15:00:00Z"
  }
}
```

**Errors:**
| Code | HTTP | Meaning |
|---|---|---|
| `INSUFFICIENT_BALANCE` | 422 | Bank balance < investment amount |
| `ACCOUNT_NOT_FOUND` | 404 | Bank account not found or not owned |
| `INVALID_AMOUNT` | 422 | Amount <= 0 |

---

### GET `/investments`

Returns paginated list of the user's investments.

**Query params:** `page=1&limit=20`

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "items": [ { ... } ],
    "total": 3,
    "page": 1,
    "limit": 20
  }
}
```

---

### GET `/investments/:id`

Returns a single investment by ID.

---

## Audit Logs

### GET `/audit/logs`

Returns the current user's audit log (paginated, newest first).

**Query params:** `page=1&limit=50&action=KYC_INITIATED`

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "action": "INVESTMENT_COMPLETED",
        "status": "success",
        "metadata": { "tx_ref": "TXN-2025-abc123", "amount": 5000 },
        "ip_address": "203.0.113.42",
        "created_at": "2025-05-01T15:00:01Z"
      }
    ],
    "total": 12,
    "page": 1,
    "limit": 50
  }
}
```

---

## Global Error Codes

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed JSON |
| 401 | `UNAUTHORIZED` | Missing or expired JWT |
| 403 | `STEP_NOT_ALLOWED` | Onboarding step gate failed |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `CONFLICT` | Duplicate or conflicting state |
| 422 | `VALIDATION_ERROR` | Field validation failed |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

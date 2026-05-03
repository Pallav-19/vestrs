# Frontend Brief — Investment Onboarding Platform

Hand this file to Claude in a new repo. It contains everything needed to build the frontend without access to the backend source code.

---

## What you're building

A multi-step onboarding flow for a cross-border investment platform. The user moves through a strict linear sequence — each step is gated by the backend and cannot be skipped. After onboarding is complete the user can make investments and view their history.

---

## Backend

- Base URL: `http://localhost:3000/api/v1`
- All responses: `{ success: true, data: {...} }` or `{ success: false, error: { code, message }, statusCode }`
- Auth: Bearer token in `Authorization` header
- Tokens returned on register/login as `data.tokens.access_token` and `data.tokens.refresh_token`

---

## Onboarding state machine

The backend enforces this exact progression via `user.onboardingStep`:

```
REGISTERED
  → KYC_INITIATED (async polling in progress)
  → KYC_FAILED    (can retry)
  → KYC_SUCCESS
      → ACCRED_INITIATED (async polling, may take 12-48h)
      → ACCRED_FAILED    (can retry)
      → ACCRED_SUCCESS
          → COMPLETE  (set immediately on bank link)
```

On every login/token refresh, read `GET /auth/me` → `data.onboardingStep` to determine which screen to show.

---

## API Reference

### Auth

#### Register
```
POST /auth/register
Body: {
  name: string,
  email: string,
  password: string,        // min 8 chars, 1 upper, 1 lower, 1 number, 1 special
  phone: string,           // E.164 format e.g. +14155550001
  nationality: string,     // ISO 3166-1 alpha-2, e.g. "US"
  domicile: string         // ISO 3166-1 alpha-2, e.g. "US"
}
Response 201: {
  user: { id, name, email, phone, nationality, domicile, onboardingStep, createdAt },
  tokens: { access_token, refresh_token }
}
Errors: 409 EMAIL_TAKEN
```

#### Login
```
POST /auth/login
Body: { email: string, password: string }
Response 200: { user: {...}, tokens: { access_token, refresh_token } }
Errors: 401 INVALID_CREDENTIALS
```

#### Refresh token
```
POST /auth/refresh
Body: { refresh_token: string }
Response 200: { access_token: string }
```

#### Get current user
```
GET /auth/me
Headers: Authorization: Bearer <access_token>
Response 200: { id, name, email, onboardingStep, ... }
```

---

### KYC

#### Initiate
```
POST /kyc/initiate
Headers: Authorization: Bearer <token>
Required step: KYC must not have been started (user.onboardingStep === "REGISTERED")
Response 202: {
  id: string,
  status: "success" | "failure" | "pending",
  attemptNumber: number,
  subResults: { ckyc, identity, aml },
  message?: string   // present when pending
}
Errors:
  403 STEP_NOT_ALLOWED     — wrong onboarding step
  409 KYC_ALREADY_PENDING  — already in progress
  422 MAX_ATTEMPTS_REACHED — 3 attempts used
```

#### Poll status
```
GET /kyc/status
Headers: Authorization: Bearer <token>
Response 200: {
  id, status, provider, attemptNumber, subResults, createdAt, updatedAt
}
Errors: 404 KYC_NOT_FOUND
```

#### Retry (only when KYC_FAILED)
```
POST /kyc/retry
Headers: Authorization: Bearer <token>
Required step: user.onboardingStep === "KYC_FAILED"
Response 202: same shape as initiate
Errors: 409 KYC_NOT_FAILED, 422 MAX_ATTEMPTS_REACHED
```

---

### Accreditation

#### Initiate
```
POST /accreditation/initiate
Headers: Authorization: Bearer <token>
Required step: user.onboardingStep === "KYC_SUCCESS"
Response 202: {
  id, status, attemptNumber, provider, detail, message?
}
Errors: 403, 409 ACCRED_ALREADY_PENDING, 422 MAX_ATTEMPTS_REACHED
```

#### Poll status
```
GET /accreditation/status
Headers: Authorization: Bearer <token>
Response 200: { id, status, provider, attemptNumber, detail, createdAt, updatedAt }
Errors: 404 ACCRED_NOT_FOUND
```

#### Retry (only when ACCRED_FAILED)
```
POST /accreditation/retry
Headers: Authorization: Bearer <token>
Required step: user.onboardingStep === "ACCRED_FAILED"
Response 202: same shape as initiate
```

---

### Bank

#### Link account
```
POST /bank/link
Headers: Authorization: Bearer <token>
Required step: user.onboardingStep === "ACCRED_SUCCESS"
Body: {
  publicToken: string,   // use any string for success; "mock-fail-token" forces failure
  accountId: string      // any string
}
Response 201: {
  id, bankName, maskedNumber, accountType, balance, currency, linkedAt
}
Errors: 403 STEP_NOT_ALLOWED, 422 BANK_LINK_FAILED
```

Special test tokens:
- `mock-fail-token` → 422 failure
- `mock-zero-balance` → links with $0 balance
- `mock-low-balance` → links with $500 balance
- anything else → random $10k–$100k balance

#### List accounts
```
GET /bank/accounts
Headers: Authorization: Bearer <token>
Response 200: [ { id, bankName, maskedNumber, accountType, balance, currency, linkedAt } ]
```

#### Unlink account
```
DELETE /bank/accounts/:id
Headers: Authorization: Bearer <token>
Response 204
Errors: 404 ACCOUNT_NOT_FOUND, 409 ACCOUNT_ALREADY_UNLINKED
```

---

### Investments

#### Create investment
```
POST /investments
Headers: Authorization: Bearer <token>
Required step: user.onboardingStep === "COMPLETE"
Body: {
  bankAccountId: string,       // must be an active linked account
  amount: number,              // min 10, max 2 decimal places
  destinationAccount: string   // e.g. "ESCROW-FUND-001"
}
Response 201: {
  id, txRef, amount, currency, destinationAccount, status, createdAt
}
Errors:
  403 STEP_NOT_ALLOWED
  404 ACCOUNT_NOT_FOUND
  422 INSUFFICIENT_FUNDS
```

#### List investments (paginated)
```
GET /investments?page=1&limit=20
Headers: Authorization: Bearer <token>
Response 200: {
  items: [ { id, txRef, amount, currency, destinationAccount, status, bankAccount, createdAt } ],
  pagination: { page, limit, total, pages }
}
```

#### Get single investment
```
GET /investments/:id
Headers: Authorization: Bearer <token>
Response 200: { id, txRef, amount, currency, destinationAccount, status, bankAccount, createdAt }
Errors: 404 INVESTMENT_NOT_FOUND
```

---

### Audit logs

```
GET /audit/logs?page=1&limit=20
Headers: Authorization: Bearer <token>
Response 200: {
  items: [ { id, action, status, metadata, ipAddress, createdAt } ],
  pagination: { page, limit, total, pages }
}
```

---

## UX flow — screen by screen

### 1. Auth screens
- **Register** — single form, all fields required. Password strength indicator. Phone field with country code picker. Country selectors for nationality + domicile (ISO alpha-2).
- **Login** — email + password. Remember me optional.
- On success → check `onboardingStep` → route to correct screen.

### 2. KYC screen (`onboardingStep === REGISTERED | KYC_INITIATED | KYC_FAILED`)

**States to handle:**

| Step | UI |
|------|----|
| `REGISTERED` | "Start identity verification" CTA |
| `KYC_INITIATED` | Spinner + "Verifying your identity…" + poll every 5s |
| `KYC_FAILED` | Error card with reason + "Retry" CTA (show attempt count X/3) |
| `KYC_SUCCESS` | Success banner → auto-advance to accreditation |

**Pending polling logic:** call `GET /kyc/status` every 5 seconds while `status === "pending"`. Stop when success/failure. Refresh user token after resolution to get updated `onboardingStep`.

### 3. Accreditation screen (`KYC_SUCCESS | ACCRED_INITIATED | ACCRED_FAILED`)

Same pattern as KYC but communicate the 12–48 hour window clearly.

| Step | UI |
|------|----|
| `KYC_SUCCESS` | "Start accreditation check" CTA with brief explanation of what accreditation is |
| `ACCRED_INITIATED` | "Under review — this may take up to 48 hours." Show a persistent status card the user can return to. Poll every 30s (not 5s — this is a long process). |
| `ACCRED_FAILED` | Failure reason + retry (X/3 attempts) |
| `ACCRED_SUCCESS` | Success → advance to bank linking |

### 4. Bank linking screen (`ACCRED_SUCCESS`)

- Simple form: public token field (or simulate a "Connect your bank" modal flow)
- Show a list of already-linked accounts if any
- On success: show masked account number, bank name, balance
- Allow unlinking from account list

### 5. Dashboard / Investment screen (`COMPLETE`)

Two tabs:
- **Make Investment** — pick linked account (dropdown showing balance), enter amount, enter destination (or pick from preset list), submit
- **History** — paginated investment list, each row: amount, destination, date, status badge

Show account balance on the make-investment form and update it after a successful investment.

### 6. Audit log screen (optional tab in dashboard)
Paginated table: action, status badge, timestamp, metadata summary.

---

## Error handling conventions

Every non-2xx response has this shape:
```json
{
  "success": false,
  "error": { "code": "MACHINE_READABLE_CODE", "message": "Human message" },
  "statusCode": 422
}
```

Map codes to user-facing messages:
| Code | User message |
|------|-------------|
| `EMAIL_TAKEN` | This email is already registered |
| `INVALID_CREDENTIALS` | Incorrect email or password |
| `STEP_NOT_ALLOWED` | Complete the previous step first |
| `KYC_ALREADY_PENDING` | Verification already in progress |
| `MAX_ATTEMPTS_REACHED` | Maximum attempts reached. Contact support |
| `INSUFFICIENT_FUNDS` | Insufficient balance in selected account |
| `BANK_LINK_FAILED` | Bank connection failed. Try a different token |

---

## Token management

- Store `access_token` and `refresh_token` in memory (or secure storage on native).
- Access token expires in 15 minutes. On 401, call `POST /auth/refresh` with the refresh token, update stored access token, retry the original request once.
- Refresh token valid for 7 days. On refresh failure → log out.

---

## Tech stack recommendation

### React (web)
- **Vite** + React 19 + TypeScript
- **TanStack Query** for data fetching, polling, and cache invalidation
- **React Hook Form** + **Zod** for form validation
- **Zustand** for auth state (token + user)
- **React Router v6** for routing with a `ProtectedRoute` that checks `onboardingStep`
- **Tailwind CSS** + **shadcn/ui** for components

### React Native (mobile)
- **Expo** (managed workflow) + TypeScript
- **TanStack Query** (works identically)
- **React Hook Form** + **Zod**
- **Zustand** + **expo-secure-store** for token persistence
- **React Navigation** (stack + bottom tabs)
- **NativeWind** for Tailwind-style styling

Both options share identical API layer and business logic — only the component/navigation layer differs.

---

## Claude prompt to bootstrap the project

Paste the following into Claude Code in your new empty repo:

```
I'm building a React [web / Native] frontend for an investment onboarding platform.
The complete API spec, screen-by-screen UX flow, error codes, and token management
strategy are in the attached file. The backend is already running at
http://localhost:3000/api/v1.

Please:
1. Scaffold the project with the recommended stack from the brief
2. Implement the auth layer (register, login, token refresh interceptor, secure storage)
3. Build the onboarding wizard: KYC → Accreditation → Bank Link, with correct
   polling logic and step-based routing
4. Build the dashboard: investment form + history list + audit log tab
5. Handle all error codes from the brief with appropriate user-facing messages
6. Ensure loading / success / failure states are explicit on every async action

Prioritise correctness of the state machine routing over visual polish.
```

---

## Key invariants the UI must respect

1. **Never allow the user to call a step endpoint they haven't reached** — always route based on `onboardingStep` from `/auth/me`, not local state.
2. **Pending KYC polls at 5s intervals; pending Accreditation polls at 30s** — accreditation is a long-running review, not a fast check.
3. **After any step completes, re-fetch `/auth/me`** to get the updated step before routing forward — don't rely on the initiate response alone.
4. **Refresh token on 401, retry once, then log out** — never silently fail an authenticated request.
5. **Investment amount must be ≥ $10** and the form should enforce this client-side before hitting the API.

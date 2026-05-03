# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # compile TypeScript → dist/
npm run start:dev      # hot-reload dev server (port 3000)
npm run start:prod     # run compiled dist/main.js
npm run lint           # ESLint with auto-fix
npm run test           # Jest unit tests (47 specs across 5 service suites)
npm run test:e2e       # E2E tests
npx prisma migrate dev --name <name>   # create + apply a migration
npx prisma generate                    # regenerate Prisma client after schema changes
```

Use `start:prod` (not `start:dev`) for smoke testing — hot-reload timing can cause stale code to serve requests during file-write.

## Architecture

NestJS monolith. `src/app.module.ts` is the root; all feature modules are imported there.

### Module layout

```
src/
  config/           ConfigService factory (registerAs 'app') — nested access: config.get('app.redis.host')
  prisma/           @Global PrismaModule — injected into every module
  common/
    enums/          Local string enums mirroring Prisma schema enums (source of truth for guards/services)
    guards/         JwtAuthGuard, JwtRefreshGuard, OnboardingStepGuard
    decorators/     @CurrentUser(), @StepRequired(step)
    filters/        HttpExceptionFilter — normalises all errors to {success, error:{code,message}, statusCode, path, timestamp}
  mock/             @Global MockModule — 5 mock providers + ScenarioStoreService + dev-only controllers
  modules/
    audit/          @Global AuditModule — never throws, fire-and-forget append
    auth/           JWT (access 15m) + refresh (7d) with bcrypt cost=12
    kyc/            Composite CKYC→(Identity+AML) flow with BullMQ polling
    accreditation/  Single provider with BullMQ polling
    bank/           Synchronous bank link via MockBankProvider
    investments/    ACID transaction: balance check + deduct + create record
```

### Onboarding state machine

Each endpoint is gated by `@StepRequired(step) @UseGuards(OnboardingStepGuard)` which does an **exact match** on `user.onboardingStep`:

```
REGISTERED → KYC_INITIATED|KYC_FAILED|KYC_SUCCESS → ACCRED_INITIATED|ACCRED_FAILED|ACCRED_SUCCESS → COMPLETE
```

`BANK_LINKED` is in the schema but not used — bank link sets step directly to `COMPLETE`.

### BullMQ queues

- `kyc-poll` — processor: `KycProcessor`, MAX_POLLS=10, polls identity+aml concurrently
- `accred-poll` — processor: `AccreditationProcessor`, MAX_POLLS=15

Both use manual re-enqueue (not BullMQ retry) for full control. Check `check.status !== 'PENDING'` before polling to handle webhook-resolved races.

### Third-party provider control (dev only)

Force deterministic outcomes via `POST /api/v1/dev/scenarios`:
```json
{ "userId": "...", "provider": "ckyc|identity|aml|accreditation|bank", "outcome": "success|failure|pending" }
```
ScenarioStoreService is an in-memory Map — clears on restart.
Webhook simulation: `POST /api/v1/dev/webhooks/kyc/:refId` and `/accreditation/:refId`.

Special bank tokens: `mock-fail-token` → 422, `mock-zero-balance` → $0, `mock-low-balance` → $500.

### Response envelope

All endpoints: `{ success: true, data: ... }` or `{ success: false, error: { code, message }, statusCode, path, timestamp }`.

Error codes are always machine-readable strings (e.g. `STEP_NOT_ALLOWED`, `INSUFFICIENT_FUNDS`, `MAX_ATTEMPTS_REACHED`).

### Auth flow

Tokens returned as `data.tokens.access_token` / `data.tokens.refresh_token`. JwtStrategy loads the full `User` from DB on every request — `@CurrentUser()` returns the Prisma `User` object.

## Key invariants

- `AuditService.log()` never throws — wrap DB failures in try/catch and log to console.
- Investment creation uses `prisma.$transaction` — balance deduct + investment record are atomic.
- KYC composite: CKYC failure short-circuits (Identity+AML never called). Any sub-check failure/pending propagates.
- `OnboardingStepGuard` is **exact match** — a user at `COMPLETE` cannot re-initiate KYC.

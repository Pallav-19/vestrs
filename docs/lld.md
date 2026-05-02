# Low-Level Design (LLD)

---

## Module Breakdown

### `AuthModule`

**Responsibilities:** Registration, login, token issuance, token refresh, `GET /me`.

**Key pieces:**
- `AuthService` — hashes passwords via bcrypt (cost=12), signs JWTs (access: 15m, refresh: 7d).
- `JwtStrategy` — validates access tokens, attaches user to request.
- `JwtRefreshStrategy` — validates refresh tokens, used only on `/auth/refresh`.
- `RegisterDto` — validates email uniqueness at DB level (unique constraint + service-level check for clean error).

**Token storage:** Access token is short-lived (15m). Refresh token is stored as-is; clients must store it securely (httpOnly cookie recommended in production).

---

### `KycModule`

**Responsibilities:** Initiate KYC (composite: CKYC + Identity + AML), poll status, handle retries, queue background resolution.

**Key pieces:**

`KycService.initiate(userId)`:
1. Assert `user.onboarding_step === 'registered'` (guard does this, service re-checks for safety).
2. Assert no active `pending` kyc_check for this user.
3. Assert `attempt_number < 3`.
4. Call providers in sequence:
   - `MockCKYCProvider.initiate()` → if `failure`, short-circuit immediately.
   - `MockIdentityProvider.initiate()` → capture `ref_id` for polling.
   - `MockAmlProvider.initiate()` → if `failure`, short-circuit.
5. Compute composite status: `failure` if any sub-provider failed, `pending` if any is pending, else `success`.
6. Insert `kyc_check` record with composite status + sub-provider results in `response_payload`.
7. If composite `pending` → enqueue `kyc-poll` job in BullMQ.
8. If composite `success` → update `user.onboarding_step = 'kyc_success'` immediately.
9. Insert audit log.

`KycProcessor` (BullMQ `@Processor('kyc-poll')`):
1. Poll only the sub-providers that returned `pending` (identity, aml).
2. If all resolved to `success` → update `kyc_check.status`, update `user.onboarding_step = 'kyc_success'`, insert audit log.
3. If any resolved to `failure` → update `kyc_check.status`, update `user.onboarding_step = 'kyc_failed'`, insert audit log.
4. If still `pending` → re-add job with exponential backoff (30s → 60s → 120s → 300s).

For full mock provider behavior see [mock-providers.md](./mock-providers.md).

---

### `AccreditationModule`

Same structure as `KycModule`. Key differences:
- Required step: `kyc_success`.
- Success step: `accred_success`.
- Mock provider simulates longer pending window (multiple poll cycles before resolution).
- Queue name: `accred-poll`.

---

### `BankModule`

**Responsibilities:** Link bank account, list accounts, unlink.

`BankService.link(userId, dto)`:
1. Assert `user.onboarding_step === 'accred_success'`.
2. Call `MockBankProvider.link(public_token, account_id)`.
3. Provider returns `{ masked_number, bank_name, account_type, balance }` or throws.
4. Insert `bank_account` record.
5. Update `user.onboarding_step = 'bank_linked'` (→ `complete` here; there's no separate "complete" event — bank linking IS the last gate step before investment).
6. Insert audit log.

`MockBankProvider`:
- `link(token, account_id)` — returns mock account data. Returns failure for token `mock-fail-token`.
- Generates a realistic mock balance between $10,000–$100,000.

---

### `InvestmentsModule`

**Responsibilities:** Create investment, list, get by ID.

`InvestmentsService.create(userId, dto)`:
1. Assert `user.onboarding_step === 'complete'`.
2. Fetch `bank_account` — assert it belongs to user and is `active`.
3. Assert `bank_account.balance >= dto.amount`.
4. Run Prisma `$transaction`:
   - Insert `investment` with `status: 'completed'`.
   - Decrement `bank_account.balance` by `dto.amount`.
5. Insert audit log outside transaction (non-critical, best-effort).
6. Return investment record with generated `tx_ref`.

`tx_ref` format: `TXN-{YYYYMMDD}-{nanoid(8)}`

---

### `AuditModule`

**Responsibilities:** Append-only log of all significant actions.

`AuditService.log(dto)`:
```typescript
interface AuditLogDto {
  userId: string | null;
  action: AuditAction;
  status: 'success' | 'failure' | 'pending';
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}
```

- Called directly by services (not via interceptor) to allow precise control over what goes in `metadata`.
- Never throws — wrapped in try/catch so a logging failure never breaks the main flow.
- Exported from `AuditModule` as a globally available service.

---

## Cross-Cutting Concerns

### `OnboardingStepGuard`

```typescript
@Injectable()
export class OnboardingStepGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<OnboardingStep>('step_required', context.getHandler());
    const user = context.switchToHttp().getRequest().user;
    if (user.onboarding_step !== required) {
      throw new ForbiddenException({
        code: 'STEP_NOT_ALLOWED',
        message: `This action requires onboarding step: ${required}`,
        current_step: user.onboarding_step,
      });
    }
    return true;
  }
}
```

Used as `@UseGuards(JwtAuthGuard, OnboardingStepGuard)` with `@StepRequired(OnboardingStep.REGISTERED)`.

---

### `HttpExceptionFilter`

Global filter that normalizes all errors to the standard response envelope. Catches both NestJS `HttpException` and unexpected errors, returning `INTERNAL_ERROR` with no stack trace in production.

---

### Request Validation

All DTOs use `class-validator`. Global `ValidationPipe` with:
```typescript
new ValidationPipe({
  whitelist: true,        // strip unknown properties
  forbidNonWhitelisted: true,
  transform: true,        // auto-transform types (string → number)
})
```

---

## Mock Provider Layer

The mock layer lives entirely in `src/mock/` and is documented in full in [mock-providers.md](./mock-providers.md).

**Providers:**
- `MockCKYCProvider` — Central KYC Registry lookup (synchronous, deterministic by nationality/email)
- `MockIdentityProvider` — Shufti Pro / Jumio document + liveness (async, probability-weighted)
- `MockAmlProvider` — ComplyAdvantage / World-Check sanctions screening (mostly synchronous)
- `MockAccreditationProvider` — Veriff / Accred SEC accreditation (async, long-pending simulation)
- `MockBankProvider` — Plaid token exchange + balance fetch (synchronous, token-triggered)

**Dependency injection pattern** — each provider is registered under an injection token (e.g., `IDENTITY_PROVIDER_TOKEN`). Real providers are swapped in by changing `useClass` in the module — no changes to service logic.

**Scenario control** — `ScenarioStoreService` holds an in-memory `Map<userId:provider, outcome>`. All providers check this before randomizing. Override via `POST /mock/scenarios` (non-production only).

**Webhook simulation** — `MockWebhookController` exposes `POST /mock/webhooks/kyc/:ref_id` and `POST /mock/webhooks/accreditation/:ref_id` to simulate inbound provider callbacks without waiting for poll cycles (non-production only).

---

## BullMQ Queue Configuration

```typescript
BullModule.registerQueue({
  name: 'kyc-poll',
  defaultJobOptions: {
    attempts: 10,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
})
```

- Max 10 poll attempts per KYC check.
- Exponential backoff starting at 30 seconds.
- Failed jobs retained for inspection.
- Separate queues for `kyc-poll` and `accred-poll`.

---

## Environment-based Configuration

All config is validated at startup via Joi schema. App refuses to boot on missing required env vars.

```typescript
Joi.object({
  DATABASE_URL: Joi.string().required(),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
})
```

---

## Implementation Order

1. Prisma schema + initial migration
2. `AppModule` bootstrap — config, Prisma, global pipes/filters
3. `MockModule` — providers + scenario store + webhook controller (needed by KYC, Accred, Bank)
4. `AuditModule` — needed by all others
5. `AuthModule` — all other routes depend on JWT guard
6. `KycModule` + BullMQ worker (CKYC → Identity → AML composite)
7. `AccreditationModule` + BullMQ worker
8. `BankModule`
9. `InvestmentsModule`

# Investment Onboarding & Transaction Flow — Backend

A production-grade backend for a simplified cross-border investment platform. Users move through a strictly sequential onboarding funnel: registration → KYC → accreditation → bank linking → investment.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework | NestJS |
| Database | PostgreSQL |
| ORM | Prisma |
| Queue | BullMQ + Redis |
| Auth | JWT (access + refresh tokens) |
| Validation | class-validator + class-transformer |
| Config | @nestjs/config + Joi |

## Quick Start

```bash
# Install dependencies
npm install

# Copy env file and fill in values
cp .env.example .env

# Run DB migrations
npx prisma migrate dev

# Start Redis (required for queues)
docker run -d -p 6379:6379 redis:alpine

# Start dev server
npm run start:dev
```

## Documentation

| Document | Description |
|---|---|
| [Architecture](./docs/architecture.md) | System architecture, data flow diagrams, folder structure |
| [Database](./docs/database.md) | ERD, schema definitions, indexing strategy |
| [API](./docs/api.md) | All endpoints, request/response shapes, error codes |
| [LLD](./docs/lld.md) | Low-level design: modules, guards, queue processing, design decisions |
| [Mock Providers](./docs/mock-providers.md) | Mock layer: CKYC, Identity, AML, Accreditation, Bank — interfaces, behaviors, scenario control, webhook simulation |
| [Deployment Guide](./docs/deployment.md) | Production deployment steps, env setup, migrations, smoke checks |

## Environment Variables

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/investment_db
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_ACCESS_SECRET=<secret>
JWT_REFRESH_SECRET=<secret>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
PORT=3000
NODE_ENV=development
```

## Scripts

```bash
npm run start:dev       # Development with hot reload
npm run build           # Compile TypeScript
npm run start:prod      # Production
npm run lint            # ESLint
npm run test            # Unit tests
npm run test:e2e        # End-to-end tests
npx prisma studio       # Database GUI
npx prisma migrate dev  # Run pending migrations
```

## Architecture Decisions

**Why NestJS** — Modular DI container, built-in guards/interceptors/pipes, decorator-driven — matches production patterns for financial APIs without boilerplate sprawl.

**Why PostgreSQL** — ACID compliance is non-negotiable for investment transactions. Prisma gives type-safe queries and a clean migration story.

**Why BullMQ** — KYC and accreditation can return `pending` for up to 48 hours. BullMQ jobs with exponential backoff simulate the polling/webhook pattern used by real providers (Shufti Pro, Veriff).

**Why sequential step gating** — `onboarding_step` on the `users` table acts as a state machine. Every protected route is decorated with `@StepRequired(OnboardingStep.KYC_SUCCESS)` and enforced by `OnboardingStepGuard` — no business logic leaks into controllers.

## Trade-offs

| Decision | Trade-off |
|---|---|
| Mock providers as injectable NestJS services | Swap to real HTTP clients with zero business logic changes. Adds an extra abstraction layer for a mock-only system. |
| Single `onboarding_step` field vs separate status table | Simpler queries and guards. Loses fine-grained intermediate state history (covered by `audit_logs`). |
| BullMQ polling simulation | Accurately models real async provider flows. Adds Redis as a required infrastructure dependency. |
| Prisma `$transaction` for investments | Atomicity guaranteed. Prisma interactive transactions have slightly higher latency than raw SQL. |
| Audit via interceptor + decorator | Fully decoupled from business logic. Requires careful handling when a request fails mid-flight. |

## Assumptions

- One active KYC check and one active accreditation check per user at a time (retries create new records, old ones are superseded).
- Bank account balance is seeded by the mock provider at link time — this simulates Plaid's balance fetch.
- Investment destination is a fixed mock escrow account reference; real deal selection is out of scope.
- Accreditation follows SEC Reg D 506(b)/(c) definition of accredited investor but verification logic is fully mocked.
- Max 3 retry attempts for KYC and accreditation before a user is blocked and must contact support.

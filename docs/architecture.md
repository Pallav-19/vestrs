# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT (React)                             │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ HTTPS / REST
┌─────────────────────────────▼───────────────────────────────────────┐
│                       NestJS API Server                             │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │  Auth    │  │   KYC    │  │  Accred  │  │  Bank /           │  │
│  │  Module  │  │  Module  │  │  Module  │  │  Investment       │  │
│  └──────────┘  └────┬─────┘  └────┬─────┘  └────────┬──────────┘  │
│                     │              │                  │             │
│            ┌────────▼──────────────▼──────────────────▼──────────┐ │
│            │                  Mock Layer                          │ │
│            │  ┌────────────┐ ┌──────────┐ ┌──────┐ ┌─────────┐  │ │
│            │  │MockCKYC    │ │MockIdent │ │MockAML│ │MockAccr.│  │ │
│            │  │Provider    │ │Provider  │ │      │ │Provider │  │ │
│            │  └────────────┘ └──────────┘ └──────┘ └─────────┘  │ │
│            │                                        ┌──────────┐  │ │
│            │                                        │MockBank  │  │ │
│            │  ScenarioStore │ WebhookController     │Provider  │  │ │
│            └────────────────────────────────────────┴──────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Audit Module  (cross-cutting)             │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                       Common Layer                           │  │
│  │      Guards │ Interceptors │ Filters │ Pipes │ Decorators    │  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────────┬────────────────────────────┬────────────────────────────┘
           │                            │
    ┌──────▼──────┐              ┌──────▼──────┐
    │  PostgreSQL │              │    Redis    │
    │  (Prisma)   │              │  (BullMQ)   │
    └─────────────┘              └──────┬──────┘
                                        │
                               ┌────────▼────────┐
                               │  Queue Workers  │
                               │  KYC Processor  │
                               │  Accred. Proc.  │
                               └─────────────────┘
```

## Onboarding State Machine

Every user has an `onboarding_step` field that acts as a strict state machine. No step can be initiated out of order.

```
  [registered]
       │
       ▼
  KYC_INITIATED
       │
  ┌────┴────────────┐
  ▼                 ▼
KYC_SUCCESS    KYC_FAILED ──► (retry up to 3x) ──► [blocked]
  │
  ▼
ACCRED_INITIATED
  │
  ├────────────────┐
  ▼                ▼
ACCRED_SUCCESS  ACCRED_FAILED ──► (retry up to 3x) ──► [blocked]
  │
  ▼
BANK_LINKED
  │
  ▼
[complete]  ──► Investment allowed
```

## Data Flow Diagrams

### Registration

```
Client                    API                       DB              AuditLog
  │                        │                         │                  │
  │──POST /auth/register──►│                         │                  │
  │                        │  validate DTO           │                  │
  │                        │  hash password (bcrypt) │                  │
  │                        │─────────────────────────► INSERT user      │
  │                        │◄──────────────── user ──│                  │
  │                        │──────────────────────────────────────────► │
  │                        │                         │  INSERT log      │
  │◄── 201 { user, tokens }│                         │  USER_REGISTERED │
```

### KYC Flow (Composite + Async with BullMQ)

```
Client     API          MockCKYC    MockIdentity   MockAML    Redis       DB
  │         │               │            │            │          │          │
  │─POST /──►│               │            │            │          │          │
  │  kyc/   │  guard: JWT   │            │            │          │          │
  │  initiate│  step=registered           │            │          │          │
  │         │               │            │            │          │          │
  │         │──1. CKYC ────►│            │            │          │          │
  │         │  lookup       │            │            │          │          │
  │         │◄── success / not_found / failure        │          │          │
  │         │               │            │            │          │          │
  │         │  IF failure → short-circuit, INSERT kyc_check(failure)        │
  │         │               │            │            │          │          │
  │         │──2. Identity ──────────────►            │          │          │
  │         │  check        │            │            │          │          │
  │         │◄── { ref_id, pending/success/failure }  │          │          │
  │         │               │            │            │          │          │
  │         │──3. AML ───────────────────────────────►│          │          │
  │         │  screen       │            │            │          │          │
  │         │◄── { status } │            │            │          │          │
  │         │               │            │            │          │          │
  │         │──────────────────────────────────────────────────────────────►│
  │         │               │            │            │  INSERT kyc_check   │
  │         │               │            │            │  (composite result) │
  │         │               │            │            │          │          │
  │◄─202    │               │            │            │          │          │
  │  pending│  IF any sub = pending:     │            │          │          │
  │         │────────────────────────────────────────────────────►          │
  │         │               │            │  enqueue kyc-poll job │          │
  │         │               │            │            │          │          │
  │         ╔═══════════════════════════════════════════════════════════════╗
  │         ║              BULLMQ WORKER  (background)                      ║
  │         ║  poll pending sub-provider(s)                                 ║
  │         ║  → all resolved success → UPDATE kyc_check + user step        ║
  │         ║  → any failure → UPDATE kyc_check(failure) + user step        ║
  │         ║  → still pending → re-enqueue (exponential backoff)           ║
  │         ║  → INSERT audit_log                                           ║
  │         ╚═══════════════════════════════════════════════════════════════╝
  │         │               │            │            │          │          │
  │─GET /───►│               │            │            │          │          │
  │  status  │──────────────────────────────────────────────────────────────►
  │◄─{status}│               │            │            │   SELECT kyc_check │
```

### Investment Flow (Atomic Transaction)

```
Client              API                         DB
  │                  │                            │
  │─POST /invest────►│                            │
  │                  │  guard: JWT ✓              │
  │                  │  guard: step=complete ✓    │
  │                  │  validate amount > 0       │
  │                  │                            │
  │                  │────── BEGIN TRANSACTION ───►│
  │                  │  SELECT bank_account        │
  │                  │  CHECK balance >= amount    │
  │                  │  INSERT investment (pending)│
  │                  │  UPDATE bank.balance -= amt │
  │                  │  UPDATE investment (complete)
  │                  │  INSERT audit_log           │
  │                  │────── COMMIT ──────────────►│
  │                  │                            │
  │◄── 201 { tx_ref }│                            │
```

## Folder Structure

```
src/
├── modules/
│   ├── auth/
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── auth.module.ts
│   │   ├── strategies/
│   │   │   ├── jwt.strategy.ts
│   │   │   └── jwt-refresh.strategy.ts
│   │   └── dto/
│   │       ├── register.dto.ts
│   │       └── login.dto.ts
│   │
│   ├── kyc/
│   │   ├── kyc.controller.ts
│   │   ├── kyc.service.ts
│   │   ├── kyc.module.ts
│   │   ├── kyc.processor.ts       ← BullMQ worker
│   │   └── dto/
│   │
│   ├── accreditation/
│   │   ├── accreditation.controller.ts
│   │   ├── accreditation.service.ts
│   │   ├── accreditation.module.ts
│   │   ├── accreditation.processor.ts
│   │   └── dto/
│   │
│   ├── bank/
│   │   ├── bank.controller.ts
│   │   ├── bank.service.ts
│   │   ├── bank.module.ts
│   │   └── dto/
│   │
│   ├── investments/
│   │   ├── investments.controller.ts
│   │   ├── investments.service.ts
│   │   ├── investments.module.ts
│   │   └── dto/
│   │
│   └── audit/
│       ├── audit.service.ts
│       └── audit.module.ts
│
├── mock/                          ← entire mock external provider layer
│   ├── mock.module.ts
│   ├── controllers/
│   │   └── mock-webhook.controller.ts  ← simulate inbound provider callbacks
│   ├── providers/
│   │   ├── interfaces/
│   │   │   ├── kyc-provider.interface.ts
│   │   │   ├── accreditation-provider.interface.ts
│   │   │   └── bank-provider.interface.ts
│   │   ├── mock-ckyc.provider.ts       ← Central KYC Registry
│   │   ├── mock-identity.provider.ts   ← Shufti Pro / Jumio
│   │   ├── mock-aml.provider.ts        ← ComplyAdvantage / World-Check
│   │   ├── mock-accreditation.provider.ts
│   │   └── mock-bank.provider.ts       ← Plaid-like
│   └── scenarios/
│       └── scenario-store.service.ts   ← pin outcomes per user+provider
│
├── common/
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   └── onboarding-step.guard.ts
│   ├── interceptors/
│   │   └── audit-log.interceptor.ts
│   ├── filters/
│   │   └── http-exception.filter.ts
│   ├── pipes/
│   │   └── validation.pipe.ts
│   └── decorators/
│       ├── current-user.decorator.ts
│       └── step-required.decorator.ts
│
├── prisma/
│   └── schema.prisma
│
├── config/
│   └── configuration.ts
│
└── main.ts
```

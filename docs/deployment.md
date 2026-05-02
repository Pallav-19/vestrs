# Deployment Guide

This guide covers deploying the NestJS backend in a production-like environment.

## 1) Prerequisites

- Node.js 20+ and npm
- PostgreSQL 16+
- Redis 7+
- Linux VM/container host (recommended for production)

Optional for local infra bootstrapping:

- Docker + Docker Compose

## 2) Required Environment Variables

Create a `.env` file (or inject env vars through your platform):

```env
PORT=3000
NODE_ENV=production

DATABASE_URL=postgresql://investment:investment_pass@<db-host>:5432/investment_db

REDIS_HOST=<redis-host>
REDIS_PORT=6379

JWT_ACCESS_SECRET=<min-32-char-secret>
JWT_REFRESH_SECRET=<min-32-char-secret>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

ACCRED_POLL_DELAY_MS=30000
KYC_POLL_DELAY_MS=30000
```

Notes:

- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must be at least 32 characters.
- `DATABASE_URL` must point to a reachable PostgreSQL instance.
- Redis is required because KYC and accreditation polling use BullMQ.

## 3) Infrastructure Setup

### Option A: Start Postgres + Redis with Docker Compose (quickest)

From project root:

```bash
docker compose up -d postgres redis
```

This uses defaults from `docker-compose.yml`:

- Postgres: `localhost:5432`
- Redis: `localhost:6379`

### Option B: Managed services

Use managed PostgreSQL/Redis and update `.env` accordingly.

## 4) Build and Release Steps

From project root:

```bash
# Install exact dependency tree from lockfile
npm ci

# Generate Prisma client (safe to run every deploy)
npx prisma generate

# Apply pending migrations in production
npx prisma migrate deploy

# Compile TypeScript to dist/
npm run build
```

## 5) Start the Service

Use the compiled production entrypoint:

```bash
npm run start:prod
```

Use `start:prod` for smoke checks/deploy validation. `start:dev` is hot-reload mode and can serve stale code during file writes.

## 6) Suggested Runtime Process Management

Use a process manager like PM2 or your platform supervisor (systemd, ECS, Kubernetes, etc.) to:

- restart on crashes,
- keep logs centralized,
- handle zero-downtime restarts.

Example with PM2:

```bash
pm2 start dist/main.js --name investment-backend
pm2 save
```

## 7) Post-Deploy Smoke Checklist

- Service starts without config validation errors.
- Auth flow works:
  - `POST /api/v1/auth/register`
  - `POST /api/v1/auth/login`
- Queue-dependent flows run:
  - KYC initiate/poll
  - Accreditation initiate/poll
- DB writes succeed (users, checks, investments, audit logs).
- Redis connection is healthy (no BullMQ connection errors).

## 8) Common Deployment Pitfalls

- **App fails on boot**: check missing env vars or JWT secret length.
- **Jobs not progressing**: verify Redis host/port and network ACLs.
- **DB errors after deploy**: ensure `npx prisma migrate deploy` was executed.
- **Auth failures across instances**: all instances must share the same JWT secrets.

## 9) Rollback Basics

At minimum, keep previous build artifacts/container image available.

- Roll back app version first.
- If a migration caused issues, use a forward-fix migration (preferred) or restore DB backup according to your DB operations policy.


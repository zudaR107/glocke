# Contributing to Glocke

Glocke is a pnpm workspace with `backend/` and `frontend/` packages. Keep
changes focused and preserve durable ingestion and user-isolation guarantees.

## Setup

```sh
git submodule update --init
pnpm install
pnpm --filter @zudar107/schloss-server-kit build
pnpm --filter @zudar107/schloss-ui build
pnpm dev:backend
pnpm dev:frontend
```

The backend does not load `.env`. See README's direct-development section for
the required runtime variables, or use Docker Compose with generated secrets.

## Before a pull request

- Run `pnpm test`, `pnpm lint`, `pnpm build`, `pnpm --filter backend db:generate`, `docker compose config`, and `git diff --check`.
- Add or update behavioral tests before implementation changes.
- Never commit secrets or a populated `.env` file.
- Update the OpenAPI contract and README when routes or transport semantics change.
- Keep HMAC examples byte-exact and describe retries as idempotent/at-least-once attempts with terminal limits; do not claim exactly-once delivery.
- New producers need a stable event ID, a transactional outbox where their data store permits it, a dedicated directional credential, retry handling, and matching Glocke source configuration.
- Report security issues through GitHub's private vulnerability reporting flow.

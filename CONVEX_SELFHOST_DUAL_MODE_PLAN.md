# Convex Dual-Mode (Cloud + Self-Hosted) Implementation Plan

Status: Approved for execution  
Last updated: 2026-02-27  
Scope: Planning document only (no implementation in this file)

## 1. Objective

Introduce a production-grade dual-mode Convex workflow for Clawlets:

- Keep `cloud` as the default mode.
- Add first-class `selfhost` mode using Docker Compose.
- Support both modes without mixed-env ambiguity or legacy branches.
- Preserve one canonical implementation path for each concern.

## 2. Locked Product Decisions

1. Default mode remains `cloud`.
2. `selfhost` mode auto-starts Docker Compose.
3. Initial `selfhost` scope is local-only.
4. Database default for selfhost is Postgres (in the same Compose file).
5. Use `latest` tags for Convex images.
6. Self-host admin key:
   - Generate once on first setup.
   - Reuse on reruns.
   - Rotate only when explicitly requested (reset flag).
7. Auth stack remains `@convex-dev/better-auth` (no Convex Auth CLI flow migration).
8. CI must include a dockerized self-host smoke test.
9. Security default:
   - Store `CONVEX_SELF_HOSTED_ADMIN_KEY` only in a dedicated secure runtime file (`0600`).
   - Do not mirror admin key to `apps/web/.env.local` by default.
   - Optional mirror mode may exist behind explicit opt-in.

## 3. Non-Negotiable Invariants

These rules must be implemented as a single source of truth and enforced in quickstart validation.

### Cloud mode invariant

- Required:
  - `CONVEX_DEPLOYMENT`
- Forbidden:
  - `CONVEX_SELF_HOSTED_URL`
  - `CONVEX_SELF_HOSTED_ADMIN_KEY`

### Selfhost mode invariant

- Required:
  - `CONVEX_SELF_HOSTED_URL`
  - `CONVEX_SELF_HOSTED_ADMIN_KEY`
- Forbidden:
  - `CONVEX_DEPLOYMENT`

### Mixed-mode failure behavior

- Fail fast with actionable error text.
- Never continue with partially conflicting envs.

## 4. Canonical Execution Flow

## 4.1 Quickstart mode selection

- Introduce explicit `--convex-mode cloud|selfhost`.
- Default to `cloud` when omitted.

## 4.2 Cloud mode flow (backward-compatible)

- Keep current behavior unless required by invariant cleanup.

## 4.3 Selfhost mode flow

1. Start local Convex stack via Docker Compose (`up -d`).
2. Wait for healthy backend.
3. Read existing secure runtime admin key, or generate and persist if missing.
4. Configure Convex CLI context for self-host target.
5. Bootstrap Convex environment and required app/backend vars.
6. Write non-secret app env values to `apps/web/.env.local`.
7. Never log secrets.

## 5. Security Model for Credentials

## 5.1 Secret storage

- Canonical storage for self-host admin credentials is a secure runtime file (`0600`).
- This file is the only default source of truth for `CONVEX_SELF_HOSTED_ADMIN_KEY`.

## 5.2 `.env.local` policy

- Allowed: non-secret runtime config (`VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`, `SITE_URL`, etc.).
- Disallowed by default: admin key persistence.

## 5.3 Rotation policy

- Key remains stable across reruns.
- Rotation/reset only via explicit user intent (flag).

## 6. Implementation Workstreams

## A. Mode contract + validation

Primary files:

- `packages/cli/src/commands/quickstart/types.ts`
- `packages/cli/src/commands/quickstart/shared.ts`
- `packages/cli/src/commands/quickstart/index.ts`

Deliverables:

- Add mode enum/types.
- Add validation helpers for required/forbidden env vars per mode.
- Ensure all quickstart paths call the same validation entrypoint.

## B. Selfhost infra assets (canonical)

New assets:

- `infra/convex-selfhost/docker-compose.yml`
- `infra/convex-selfhost/.env.example`
- `infra/convex-selfhost/README.md`

Deliverables:

- Compose services: `backend`, `dashboard`, `postgres`.
- Local ports/origins documented and aligned with Convex docs:
  - API `3210`
  - Site/actions `3211`
  - Dashboard `6791`
- Healthcheck and startup docs.
- Postgres-first defaults.

## C. Quickstart branching + secure key lifecycle

Primary files:

- `packages/cli/src/commands/quickstart/index.ts`
- `packages/cli/src/commands/quickstart/convex.ts`
- `packages/cli/src/commands/quickstart/shared.ts`
- `packages/cli/src/commands/quickstart/ui.ts` (only if needed for env handoff)

Deliverables:

- Implement mode-aware branching.
- Add compose auto-start logic for `selfhost`.
- Add runtime-file admin key create/read/reuse/reset logic.
- Remove cloud-only assumptions from shared bootstrapping path.

## D. App env and error message normalization

Primary files:

- `apps/web/.env.local.example`
- `apps/web/README.md`
- `apps/web/src/server/env.ts`
- `apps/web/src/server/better-auth.ts`

Deliverables:

- Document both modes and exclusivity.
- Keep runtime checks mode-safe and non-cloud-specific where appropriate.
- Preserve behavior for `@convex-dev/better-auth`.

## E. Documentation updates (single canonical docs path)

Primary docs:

- `apps/docs/content/docs/quickstart.mdx`
- `apps/docs/content/docs/operations/quickstart.mdx`
- `apps/docs/content/docs/dashboard/convex-setup.mdx`
- `apps/docs/content/docs/dashboard/local-dev.mdx`
- `apps/docs/content/docs/dashboard/troubleshooting.mdx`

Deliverables:

- Add mode selection step early in onboarding.
- Add local self-hosted path with Docker Compose.
- Add mixed-env conflict troubleshooting.
- Remove stale cloud-only instructions where invalid.

## F. Tests + CI smoke

Primary files:

- `packages/cli/tests/quickstart.command.integration.test.ts`
- `.github/workflows/ci.yml`

Deliverables:

- Tests for both modes.
- Tests for invariant failures and secret handling.
- Dockerized self-host smoke in CI:
  - `docker compose up -d`
  - run selfhost quickstart non-interactive
  - verify expected artifacts/env
  - always teardown (`docker compose down -v`)

## 7. Suggested CLI/API Surface Additions

These names are recommendations; implementation may adjust naming but not behavior.

- `--convex-mode cloud|selfhost` (default `cloud`)
- `--convex-selfhost-up` (default true when mode=selfhost)
- `--convex-selfhost-reset-admin-key` (default false)
- `--convex-selfhost-mirror-admin-key-to-env` (default false; explicit opt-in only)

## 8. Out of Scope (This Iteration)

- Remote self-host deployment automation.
- Multi-node distributed Convex topology.
- Non-Postgres default DB path in selfhost quickstart.
- Production hardening automation beyond documented guidance.

## 9. Acceptance Criteria (Definition of Done)

1. `clawlets quickstart` default cloud flow remains backward compatible.
2. `clawlets quickstart --convex-mode selfhost` succeeds end-to-end on local machine with auto Compose startup.
3. Self-host admin key is stable across reruns and stored securely in runtime file by default.
4. Admin key is not persisted to `apps/web/.env.local` unless explicit opt-in flag is used.
5. Docs provide a clear, canonical dual-mode workflow.
6. CI includes and passes dockerized self-host smoke coverage.

## 10. Execution Checklist

- [ ] Add mode contract/types and invariant checks.
- [ ] Add canonical selfhost infra directory and compose assets.
- [ ] Add secure runtime key lifecycle (create/read/reuse/reset).
- [ ] Implement selfhost quickstart branch with compose auto-start.
- [ ] Normalize app env docs and runtime messages for dual-mode support.
- [ ] Update docs pages listed in Section 6E.
- [ ] Add/expand integration tests for dual-mode and invariant failures.
- [ ] Add CI self-host smoke test and cleanup.

## 11. Key Internal References

Current quickstart implementation:

- `packages/cli/src/commands/quickstart/index.ts`
- `packages/cli/src/commands/quickstart/convex.ts`
- `packages/cli/src/commands/quickstart/shared.ts`
- `packages/cli/tests/quickstart.command.integration.test.ts`

Current web/env integration:

- `apps/web/package.json`
- `apps/web/.env.local.example`
- `apps/web/src/server/env.ts`
- `apps/web/src/server/better-auth.ts`
- `apps/web/convex/auth.ts`

Current docs entrypoints:

- `apps/docs/content/docs/quickstart.mdx`
- `apps/docs/content/docs/operations/quickstart.mdx`
- `apps/docs/content/docs/dashboard/convex-setup.mdx`
- `apps/docs/content/docs/dashboard/local-dev.mdx`
- `apps/docs/content/docs/dashboard/troubleshooting.mdx`

Current CI workflow:

- `.github/workflows/ci.yml`

## 12. External Sources

- Convex self-hosted README:  
  https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md
- Convex official docker-compose example:  
  https://github.com/get-convex/convex-backend/blob/main/self-hosted/docker/docker-compose.yml
- Hosting on own infra (origins/routing):  
  https://github.com/get-convex/convex-backend/blob/main/self-hosted/advanced/hosting_on_own_infra.md
- Postgres/MySQL guidance:  
  https://github.com/get-convex/convex-backend/blob/main/self-hosted/advanced/postgres_or_mysql.md
- Upgrading self-hosted guidance:  
  https://github.com/get-convex/convex-backend/blob/main/self-hosted/advanced/upgrading.md
- Background article (dated 2025-02-13):  
  https://stack.convex.dev/self-hosted-develop-and-deploy


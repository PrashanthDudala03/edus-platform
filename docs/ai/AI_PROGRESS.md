# EduOS AI Platform — Progress

One task per session. Update the status here and rewrite `AI_CURRENT_TASK.md` when a task is finished.
Status: `todo`, `doing`, `done`, `blocked`.

## Phase 0 — Discovery
| ID | Task | Status |
|---|---|---|
| AI-000 | Repository discovery, architecture, security rules, decisions, repo map | done (2026-10-01) |

## Phase 1 — Skeleton and safety (no model required)
| ID | Task | Depends on | Status |
|---|---|---|---|
| AI-001 | `ai-service` skeleton: .NET 9 project using `EduOS.ServiceAuth`; `/api/ai/health` and `/api/ai/status`; compose profile `ai`; gateway route; `ai` entry in `PermissionAccess`; permission keys in the catalogue; authorization tests | — | done (2026-10-01) |
| AI-002 | `ai-db` (pgvector image, profile `ai`) and first `ai` schema migration: `school_settings`, `usage_events`, `audit`; startup migration runner | AI-001 | done, static only (2026-10-01) |
| AI-003 | Provider contracts (`IModelProvider`, `IEmbeddingProvider`), capabilities and data boundary, guard wrappers (limits, timeout, usage, error mapping), fake providers, config-driven selection; unit tests | AI-001 | done (2026-10-01) |
| AI-004 | AI Gateway pipeline and the first endpoint (`POST /api/ai/assistant/ask`, fake provider): feature state, bounded request, provider call, safe result | AI-002, AI-003 | done (2026-10-01) |
| AI-004B | Gateway protection: per-user and per-school rate limit, provider circuit breaker (in memory, injectable clock). Needs no database | AI-004 | done (2026-10-01) |
| AI-005 | **Gated by "Runtime validation owed".** Usage metering, the database-backed school switch and the per-school quota check in the pipeline; a school usage summary endpoint | AI-004, runtime gate | done (2026-10-01) |
| AI-005B | Super Admin API to enable a school and set budget and tier; platform usage summary. Includes a one-time grant of `ai.platform.manage` to the existing SuperAdmin template (new installs get it from the catalogue), and an explicit, audited way for the platform to write `ai.school_settings` and read cross-school aggregates (D24) | AI-004 | todo |

## Phase 2 — RAG
| ID | Task | Depends on | Status |
|---|---|---|---|
| AI-006 | Knowledge-base ingestion: upload with audience, text extraction, chunking, embedding, jobs table and worker | AI-005 | todo |
| AI-007 | Retrieval: `IVectorStore` contract and its pgvector implementation, required school and audience arguments, row-level security, citations; cross-school isolation tests. Creates the first vector column; the dimension is fixed there from the configured embedding model (D23) | AI-006 | todo |
| AI-008 | RAG answer endpoint: context budget, "no source found" behaviour, answer cache, embedding cache | AI-007 | todo |

## Phase 3 — Tools and routing
| ID | Task | Depends on | Status |
|---|---|---|---|
| AI-009 | Tool definitions and tool calls added to the model contract; read-only tool registry over existing EduOS endpoints with user-token passthrough; direct (no-model) answers for mapped intents | AI-004 | todo |
| AI-010 | Model routing ladder, per-tier budgets, conversation summary compression | AI-008, AI-009 | todo |

## Phase 4 — Product and operations
| ID | Task | Depends on | Status |
|---|---|---|---|
| AI-011 | Frontend assistant panel: lazy-loaded, permission-gated, hidden when AI is unavailable | AI-008 | todo |
| AI-012 | Super Admin AI page (schools, budgets, usage) and school knowledge-base page | AI-005, AI-006 | todo |
| AI-013 | Evaluation framework: golden sets, isolation and injection suites in CI | AI-008 | todo |
| AI-014 | OpenAI-compatible HTTP provider adapter (first real provider) and local model runtime containers (embeddings and chat) under profile `ai`; latency and quality benchmark; confirm default models | AI-003 | todo |
| AI-015 | Billing hook: plan → default AI quota and tier (read-only against billing) | AI-005, product decision Q2 | todo |
| AI-016 | Hosted/GPU provider adapter, dedicated egress network, cost table, per-school opt-in | AI-010, policy decision Q3 | todo |

## Runtime validation
**Passed on 2026-10-01** against `pgvector/pgvector:pg16` (PostgreSQL 16.15, pgvector 0.8.6), in an isolated compose project with throwaway credentials. It is repeatable: `AiDatabaseSecurityTests` and `AiUsageStoreIntegrationTests` (17 tests) run whenever `AI_TEST_DB_OWNER` and `AI_TEST_DB_RUNTIME` are set, and are skipped otherwise. Recipe in `AI_REPO_MAP.md`.

Proven: database initialises; pgvector usable; both migrations apply through the service's own bootstrap, twice, and are recorded; `ai_app` logs in only with its password, is not superuser, has no `BYPASSRLS`, owns nothing; row-level security enabled and forced on every school table; no school set means no rows and no inserts; each school reads and writes only its own rows, in both directions; the school of a transaction ends with it; a reused pooled connection carries no school (with the pool's own reset switched off); `ai_app` cannot update or delete usage or audit, write settings, read `schema_migrations`, create objects, change policies, switch role or turn row security off; simultaneous reservations cannot overspend.

Rerun these tests whenever a migration or `AiDatabase` changes, and before any release.

Still not run: building `services/Dockerfile.ai` and starting the `ai-service` container (it depends on auth-service, so it needs the full stack).

## Log
- 2026-10-01 — AI-000 done. Branch `feature/ai-platform-v1` created from `09f5a5e` (billing foundation). Documents only; nothing committed, nothing started.
- 2026-10-01 — AI-001 done. `services/ai-service` (health, status), profile `ai`, gateway route, `ai` route permissions, four `ai.*` catalogue keys with no school role holding them. Unit tests: ai-service 20, shared auth 59, auth-service 63, all passing; gateway builds; compose validated statically. Not run: containers, image build, Playwright (the session forbade starting anything). The boundary is tested in process instead of by a Playwright spec (D19). Uncommitted.
- 2026-10-01 — AI-002 done, verified statically only. Compose service `ai-db` (pgvector image, volume `ai_db_data`, profile `ai`); migration `20261003_01_ai_core.sql`; restricted account `ai_app`; forced row-level security; `AiDatabase.InSchool`; background migration runner. ai-service tests 43 passing (schema, grants, compose and runner checked from files; no PostgreSQL was started). See "Runtime validation owed". Committed with AI-001 as `6da8a9f` (local, not pushed).
- 2026-10-01 — AI-003 done. Vendor-neutral contracts in `services/ai-service/Providers/`, guard wrappers, deterministic fake chat and embedding providers, selection through `Ai:Providers` with start-up validation. ai-service tests 78 passing; no network, model or database used. Moved out of this task: the HTTP adapter (to AI-014), `IVectorStore` (to AI-007), tool calls (to AI-009); see D27. Uncommitted.
- 2026-10-01 — AI-004 done. `AiGateway` and `POST /api/ai/assistant/ask` on the fake provider; status now reports through the same check. ai-service tests 114 passing, in process only. Not built here, by instruction: the school switch read from `ai.school_settings` (moved to AI-005 behind the runtime gate), rate limit and circuit breaker (AI-004B). Uncommitted.
- 2026-10-01 — AI-004B done. `AiRateLimiter` (per user and per school, one-minute windows) and `AiCircuitBreaker` (per provider) in the gateway, both in memory and driven by `TimeProvider`. ai-service tests 130 passing, in process only. Single-instance protection only: see D31. Uncommitted.
- 2026-10-01 — Runtime database gate passed (see "Runtime validation"). AI-005 done: migration `20261004_01_ai_quota.sql`, `IAiUsageStore` with the PostgreSQL implementation, school switch, reservation-based quota and metering in the gateway, `GET /api/ai/usage`. ai-service tests: 145 pass without a database (17 skipped), 162 pass with the real AI database. Uncommitted. Left behind on this machine: Docker volume `eduos-ai-validation_ai_db_data` (test data only; safe to delete).

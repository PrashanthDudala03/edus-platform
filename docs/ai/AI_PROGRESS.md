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
| AI-003 | Provider interfaces (`IModelProvider`, `IEmbeddingProvider`, `IVectorStore`), fake provider, OpenAI-compatible HTTP adapter, config-driven registry; unit tests | AI-001 | todo |
| AI-004 | AI Gateway pipeline: permission and school switch, rate limit, quota check, timeout, circuit breaker, safe failure response | AI-002, AI-003 | todo |
| AI-005 | Usage metering and per-school quota; Super Admin API to enable a school and set budget and tier; usage summary endpoints. Includes a one-time grant of `ai.platform.manage` to the existing SuperAdmin template (new installs get it from the catalogue), and an explicit, audited way for the platform to write `ai.school_settings` and read cross-school aggregates (D24) | AI-004 | todo |

## Phase 2 — RAG
| ID | Task | Depends on | Status |
|---|---|---|---|
| AI-006 | Knowledge-base ingestion: upload with audience, text extraction, chunking, embedding, jobs table and worker | AI-005 | todo |
| AI-007 | Retrieval: pgvector store, required school and audience arguments, row-level security, citations; cross-school isolation tests. Creates the first vector column; the dimension is fixed there from the configured embedding model (D23) | AI-006 | todo |
| AI-008 | RAG answer endpoint: context budget, "no source found" behaviour, answer cache, embedding cache | AI-007 | todo |

## Phase 3 — Tools and routing
| ID | Task | Depends on | Status |
|---|---|---|---|
| AI-009 | Read-only tool registry over existing EduOS endpoints with user-token passthrough; direct (no-model) answers for mapped intents | AI-004 | todo |
| AI-010 | Model routing ladder, per-tier budgets, conversation summary compression | AI-008, AI-009 | todo |

## Phase 4 — Product and operations
| ID | Task | Depends on | Status |
|---|---|---|---|
| AI-011 | Frontend assistant panel: lazy-loaded, permission-gated, hidden when AI is unavailable | AI-008 | todo |
| AI-012 | Super Admin AI page (schools, budgets, usage) and school knowledge-base page | AI-005, AI-006 | todo |
| AI-013 | Evaluation framework: golden sets, isolation and injection suites in CI | AI-008 | todo |
| AI-014 | Local model runtime containers (embeddings and chat) under profile `ai`; latency and quality benchmark; confirm default models | AI-003 | todo |
| AI-015 | Billing hook: plan → default AI quota and tier (read-only against billing) | AI-005, product decision Q2 | todo |
| AI-016 | Hosted/GPU provider adapter, dedicated egress network, cost table, per-school opt-in | AI-010, policy decision Q3 | todo |

## Runtime validation owed
Nothing below has been run; sessions so far were not allowed to start containers. Do these the first time the `ai` profile may be started, before any task that stores school data:
1. `Dockerfile.ai` builds and `ai-service` starts healthy with and without `ai-db`.
2. The migration applies cleanly as the owner on `pgvector/pgvector:pg16`, twice in a row, and `ai_app` can log in afterwards.
3. Row-level security as `ai_app`: with no school set, zero rows are returned and inserts are rejected; with school A set, only rows of school A are returned and an insert for school B is rejected; `ai_app` cannot update or delete usage or audit rows, write `school_settings`, or disable the policies.
4. The school setting does not survive the transaction on a pooled connection.

## Log
- 2026-10-01 — AI-000 done. Branch `feature/ai-platform-v1` created from `09f5a5e` (billing foundation). Documents only; nothing committed, nothing started.
- 2026-10-01 — AI-001 done. `services/ai-service` (health, status), profile `ai`, gateway route, `ai` route permissions, four `ai.*` catalogue keys with no school role holding them. Unit tests: ai-service 20, shared auth 59, auth-service 63, all passing; gateway builds; compose validated statically. Not run: containers, image build, Playwright (the session forbade starting anything). The boundary is tested in process instead of by a Playwright spec (D19). Uncommitted.
- 2026-10-01 — AI-002 done, verified statically only. Compose service `ai-db` (pgvector image, volume `ai_db_data`, profile `ai`); migration `20261003_01_ai_core.sql`; restricted account `ai_app`; forced row-level security; `AiDatabase.InSchool`; background migration runner. ai-service tests 43 passing (schema, grants, compose and runner checked from files; no PostgreSQL was started). See "Runtime validation owed". Uncommitted.

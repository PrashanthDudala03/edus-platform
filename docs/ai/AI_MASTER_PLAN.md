# EduOS AI Platform — Master Plan

Status: architecture approved for implementation planning (2026-10-01). No AI code exists yet.
Read order for a new session: `AI_CURRENT_TASK.md` → `AI_SECURITY_RULES.md` → `AI_REPO_MAP.md`. Open the others only when the task needs them.

## Goal
An optional AI layer for EduOS that starts on free/local models and grows to hundreds of schools without redesign: a school assistant that answers from EduOS data and school documents, with citations, strict tenant isolation, and per-school cost control.

## Non-goals (v1)
- No model fine-tuning or training on school data.
- No autonomous write actions. Tools are read-only until a later, separately approved milestone.
- No model access to SQL, the file system, or any database connection.
- No indexing of per-student private documents (see `AI_DECISIONS.md` D7).

## Principles
1. **The model never decides authorization.** Trusted backend code resolves tenant, role, permissions and ownership before any data reaches a model.
2. **AI is optional.** Core EduOS runs unchanged with the AI service absent, disabled, slow or failing.
3. **Cheapest path first.** Plain API answer → small local model → RAG → stronger model.
4. **Providers are replaceable.** Models, embeddings and vector storage sit behind interfaces; Hugging Face is one adapter, not a dependency.
5. **Everything is metered and attributable** to school, user, feature and model.

## Phases
| Phase | Outcome | Tasks |
|---|---|---|
| 0 Discovery | These documents | AI-000 (done) |
| 1 Skeleton and safety | Service, gateway route, permissions, provider interfaces, metering, quotas. Runs with a fake provider; no model needed | AI-001 – AI-005 |
| 2 Knowledge and RAG | Tenant-aware ingestion, embeddings, retrieval, cited answers | AI-006 – AI-009 |
| 3 Models, tools and routing | First real (local) model provider, read-only EduOS tools, cost ladder, compression | AI-010 – AI-012 |
| 4 Product and operations | UI, admin controls, evaluation, billing hook, hosted providers | AI-013 – AI-017 (and deferred AI-005B) |

Detail and status: `AI_PROGRESS.md`.

## Validation of this plan (2026-10-01)
| # | Requirement | How the design meets it |
|---|---|---|
| 1 | Cannot bypass tenant/RBAC | School id comes only from the verified token. Tools call existing EduOS APIs with the user's own token. Retrieval filters by school in SQL plus row-level security. Rules S1–S6. |
| 2 | Runs on free/local models | Default providers are a deterministic fake (dev/CI) and local OpenAI-compatible runtimes (TEI, llama.cpp/TGI). |
| 3 | No Hugging Face lock-in | Wire contract is OpenAI-compatible HTTP behind `IModelProvider` / `IEmbeddingProvider`. D3. |
| 4 | Future GPU/hosted providers | New adapter plus config; router chooses per feature and tier. D3, D10. |
| 5 | Hundreds of schools | Stateless service replicas, separate AI database, school-keyed indexes, queue-based ingestion, per-school quotas. D5, D12. |
| 6 | Token/cost per school | `ai.usage_events` records every call. D9. |
| 7 | Optional and feature-flagged | Compose profile, existing IAM permission switches (global, per school, per role), per-school AI settings. D8. |
| 8 | AI can fail safely | Separate container and database; no core service calls it; UI hides on failure. D2, D5. |
| 9 | No conflict with billing | Own schema and database; billing tables untouched; entitlement hook is a later read-only integration. D11. |
| 10 | Low future agent tokens | These documents plus one small task per session in `AI_CURRENT_TASK.md`. |

Not validated here: runtime behaviour, model quality and CPU latency. Those are measured in AI-010 and AI-015.

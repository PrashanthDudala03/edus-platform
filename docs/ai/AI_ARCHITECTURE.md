# EduOS AI Platform — Architecture

Proposed design. Nothing here is built yet. Reasons for each choice are in `AI_DECISIONS.md`.

## Components
```
browser ──> nginx ──> api-gateway (YARP) ──/api/v1/ai/*──> ai-service (.NET 9, trusted)
                                                            │  ├─ AI Gateway pipeline
                                                            │  ├─ Router / tool registry / RAG
                                                            │  └─ ingestion worker
                                                            ├──> ai-db (PostgreSQL + pgvector, schema `ai`)
                                                            ├──> model runtime(s): OpenAI-compatible HTTP
                                                            │     local: TEI (embeddings), llama.cpp or TGI (chat)
                                                            │     later: GPU host or hosted provider
                                                            └──> EduOS APIs via api-gateway, with the user's own token (tools)
```
- **ai-service** is the only new trusted component. It reuses `EduOS.ServiceAuth` (JWT validation, session check, `TenantScopeMiddleware`, `TenantContext`).
- **Model runtimes** are untrusted, stateless and replaceable. They receive only text that ai-service has already authorized.
- **ai-db** is a separate PostgreSQL instance owned by ai-service. The core database is not touched.
- No core service calls ai-service. Removing the `ai` compose profile removes the feature.

## AI Gateway pipeline (every request, in this order)
1. Authenticate and resolve `TenantContext` (shared middleware).
2. Permission check (`ai.*` keys) and per-school setting (`ai.school_settings.enabled`).
3. Rate limit (per user and per school) and quota check (monthly token budget).
4. Input limits (length, attachments) and injection screening.
5. Route (cost ladder below).
6. Execute: tool calls and/or retrieval, then at most one generation call.
7. Output checks (citations present, links/markup stripped).
8. Meter (`ai.usage_events`) and audit (`ai.audit`), including failures.
9. Respond. On any provider error or timeout: a clear "assistant unavailable" result, never a core EduOS error.

## Interfaces (to be defined in AI-003)
- `IModelProvider`: chat completion with optional tool schema; returns text, tool calls, token counts.
- `IEmbeddingProvider`: batch embed; reports model id and dimension.
- `IVectorStore`: upsert, delete by document, search(schoolId, audience, vector, k). School id is a required argument, not a filter option.
- Adapters: `Fake` (deterministic, default in dev and CI), `OpenAICompatibleHttp` (covers TEI, TGI, llama.cpp, vLLM, Ollama and most hosted APIs). Selection is configuration per feature and tier.

## Cost ladder (router)
| Tier | Used when | Model cost |
|---|---|---|
| L0 Direct | Intent maps to one EduOS tool; answer is rendered from a template | none |
| L1 Small model | Intent or tool selection, short rewrite of a tool result | local small model |
| L2 RAG | Question needs school documents | embeddings + local small model |
| L3 Strong model | Multi-step or long synthesis, only if the school's plan/quota allows | GPU/hosted |

Token controls: top-k ≤ 4 chunks of ≤ ~350 tokens, hard context budget per tier, conversation kept as a rolling summary, tool results trimmed to requested fields, exact-match answer cache keyed by (school, access scope, normalized question, knowledge version), embedding cache keyed by content hash.

## Data model (schema `ai` in ai-db; created in AI-002 and later)
- `school_settings(school_id, enabled, monthly_token_budget, max_tier, updated_by, updated_at)`
- `usage_events(id, school_id, user_id, feature, provider, model, tier, input_tokens, output_tokens, retrieved_chunks, latency_ms, estimated_cost_minor, currency, success, error_code, cache_hit, usage_estimated, created_at)`
- `usage_reservations(id, school_id, user_id, tokens, created_at, expires_at)` — worst-case tokens of calls in progress; see D33.
- `audit(id, school_id, user_id, action, target_id, detail jsonb, created_at)` — metadata only; prompt text is not stored by default.
- `documents(id, school_id, title, audience text[], status, content_hash, version, uploaded_by, created_at)`
- `chunks(id, school_id, document_id, ordinal, text, token_count, embedding vector(n), embedding_model)` — index on `school_id`, HNSW on `embedding`; row-level security on `school_id`.
- `ingestion_jobs(id, school_id, document_id, status, attempts, error, locked_until)` — worker uses `FOR UPDATE SKIP LOCKED`.
- `response_cache(key, school_id, answer, citations, expires_at)`

## RAG flow
Upload (authorized admin) → type and size checks → text extraction → chunk → embed → store with `school_id` and `audience`.
Query → embed question → vector search with `school_id` from the token and `audience` matching the caller's data scope → build prompt with delimited excerpts → answer with citations (document title and chunk reference) → if nothing relevant is retrieved, say so instead of guessing.

## Tools (EduOS API calling)
- Registry of named, read-only tools, each mapped to one existing EduOS endpoint and one required permission.
- Only tools the caller's token already permits are offered to the model.
- Arguments are validated against a schema. School id and user id are never arguments.
- Calls go through api-gateway with the caller's bearer token, so existing RBAC, school scope and parent/student/teacher data scoping apply unchanged.

## Deployment
- Compose profile `ai`: `ai-service`, `ai-db`, optional `ai-embeddings`, `ai-llm`. Default stack is unchanged.
- ai-service joins `edus-network` (internal). Local runtimes need no internet once models are in a volume. A hosted provider needs a dedicated egress network for ai-service only, added when that adapter is added.
- Scale-out: ai-service replicas are stateless; rate-limit and quota counters live in ai-db (or Redis later); model runtimes scale independently.

## Evaluation
`ai/evals/` golden sets per feature (jsonl): retrieval recall@k, citation/groundedness checks, cross-school isolation (must return zero foreign chunks), prompt-injection suite. CI runs them against the fake provider; local-model runs are manual and recorded in `AI_PROGRESS.md`.

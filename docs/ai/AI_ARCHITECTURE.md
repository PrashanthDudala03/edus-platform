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
- Adapters: `fake` (deterministic, default in dev and CI) and `local` (AI-010: OpenAI-compatible HTTP to a runtime on loopback or the deployment's private network; llama.cpp server, Ollama and similar). Chat and embeddings are selected separately by configuration. No cloud provider and no fallback exist (D55–D57).

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
- `knowledge_documents(id, school_id, title, file_name, media_type, audience text[], status, failure, byte_count, char_count, chunk_count, text_sha256, uploaded_by, created_at, updated_at)` — see D37.
- `knowledge_chunks(id, school_id, document_id, ordinal, text, char_start, char_end, section, page, token_estimate)` — row-level security on `school_id`. See D37.
- `embedding_spaces(id, provider, model, dimension, active)` — shared, no school data; exactly one active (D41).
- `knowledge_embeddings(school_id, chunk_id, space_id, dimension, embedding vector, created_at)` — one vector per chunk and space, row-level security on `school_id` (D42). Documents also carry `embedding_space_id`, `embedded_tokens`, `embedded_at`.
- `ingestion_jobs(id, school_id, document_id, status, attempts, error, locked_until)` — worker uses `FOR UPDATE SKIP LOCKED`.
- `response_cache(key, school_id, answer, citations, expires_at)`

## RAG flow
Upload (authorized admin) → type and size checks → text extraction → normalise → chunk → store (`processing`) → embed the chunk texts in batches → store all vectors and mark `ready` in one transaction. A failure leaves the document `failed` with no vectors; it can be embedded again (D43).
Query (AI-008, done) → embed the question → exact cosine search of the school's vectors in the active space, with `school_id` from the token and `audience` from the caller's data scope → at most `TopK` chunks above the similarity threshold and within the context budget, each with document, title, source label, order, section, page and similarity (D46–D48).
Answer (AI-009, done) → authenticated school user with `ai.assistant.use` → feature state, open model circuit → rate limit → limits on question and output → retrieval as above (school switch included) → nothing relevant: `insufficient-knowledge`, no model call, nothing charged; retrieval failed: `retrieval-unavailable`, never an ungrounded answer → `RagContextBuilder`: constant instruction, reference material as its own message with numbered sources, the question last, whole chunks only, within the model input limit and the request budget → reserve the final input plus the output limit → circuit breaker → `IModelProvider` (guarded) → usage row with the number of chunks, reservation settled → answer plus the service's own source list (D50–D54). Single turn: no history or memory.

## Assistant routing (AI-013, done)
Question → rate limit → fixed rules (`AssistantRouter`): own words (greeting, about the assistant, about a person) | one live-data tool through the registry, worded by the service | the school's documents (RAG) → if nothing and the question is a general study request: the model with a general instruction, marked general → otherwise `insufficient-knowledge`. No model routes, no tool loops, no memory. See D64 and D65.

## Chat UI (AI-011, done)
`frontend/src/ai/`: "Ask EduOS AI" in the top bar → panel → `POST /api/v1/ai/assistant/ask` with `{ question }` through the shared API client (session token, refresh) → answer and backend-owned sources as plain text, or a fixed sentence for each reason. Single turn per request; the conversation is in memory only. No operational EduOS data is reachable: tools do not exist yet (AI-012). See D60.

## Tools (EduOS API calling)
- Built in AI-012 (`services/ai-service/Tools/`, D61 to D63): `student_count`, `attendance_summary`, `fee_summary`, `exam_schedule`. Deterministic execution only; the model does not call tools until AI-013.
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

# Current Task — AI-003: provider abstractions

Do only this task. Read `AI_SECURITY_RULES.md` first, and `AI_REPO_MAP.md` for paths. Do not re-scan the repository.

## Goal
Define how ai-service talks to models, embedding models and a vector store, with a fake implementation for development and CI and one HTTP adapter. Nothing calls them from an endpoint yet.

## Scope (all in `services/ai-service/`)
1. `IModelProvider`: one chat-completion call. Input: messages, optional tool schemas, max output tokens. Output: text, tool calls, input and output token counts, model id.
2. `IEmbeddingProvider`: batch embed. Reports model id and dimension.
3. `IVectorStore`: upsert, delete by document, search. School id is a required parameter of every method (rule S6). Interface only; the PostgreSQL implementation is AI-007.
4. `FakeModelProvider` and `FakeEmbeddingProvider`: deterministic, no network, token counts derived from input length. Default in every environment until a real provider is configured.
5. `OpenAICompatibleProvider` for chat and embeddings over HTTP (`/v1/chat/completions`, `/v1/embeddings`): base URL, model and optional API key from configuration; timeout; errors mapped to one provider-unavailable exception. No retries or routing yet.
6. Configuration section `Ai:Providers` selecting the chat and embedding provider by name; unknown names fail at start. Register through dependency injection in `AiService.Configure`.

## Out of scope
Endpoints, prompts, routing, metering, caching, RAG, vector storage, Hugging Face containers, any real network call.

## Tests
Unit tests only, with a stub `HttpMessageHandler`: request shape, response parsing, token counts, timeout and error mapping, API key never logged, fake determinism, configuration selection and failure on unknown provider. No test may open a socket.

## Acceptance
- Build and all ai-service tests pass; the existing 43 tests are unchanged.
- No new package unless it is already in the local NuGet cache; otherwise stop and report.
- `AI_PROGRESS.md` updated; this file rewritten for AI-004.

## Constraints for the session
Do not edit `.env`. Do not start containers, pull images, push or merge unless asked. The runtime checks listed in `AI_PROGRESS.md` under "Runtime validation owed" are still outstanding.

# Current Task — AI-010: real local model provider integration

Do only this task. Read `AI_SECURITY_RULES.md` first, and `AI_REPO_MAP.md` for paths. Do not re-scan the repository. AI-005B stays deferred. Do not start without an explicit brief: this task pulls images and model files and needs that authorised.

## Goal
The assistant and the embedder run against a real model that stays inside the deployment (`DataBoundary.Local`), behind the existing contracts. Nothing above `IModelProvider` and `IEmbeddingProvider` changes.

## Scope
1. An OpenAI-compatible HTTP adapter for chat and for embeddings in `Providers/`, selected through `Ai:Providers`, wrapped by the existing guards (timeout, limits, usage, safe failures). Address and any key come from the environment (S20); nothing is logged that carries text or an address with a key.
2. A local model runtime under compose profile `ai`, reachable by `ai-service` only, with no route out of the deployment.
3. Chat template: the request has a system message, a reference-material message and a question message (D51). If the model needs alternating roles, the adapter merges the last two in a fixed way that keeps them distinguishable; test it.
4. Embedding model change: a new embedding space is adopted only with `Ai:Knowledge:AdoptEmbeddingModel` (D44); documents are embedded again; `Ai:Retrieval:MinSimilarity` is calibrated for the new model (D48).
5. Real limits in the descriptors (input, output, dimension, batch) and `Ai:Assistant:MaxRequestTokens` set to fit the model's context window (D54).
6. Measurements on the target hardware: latency and answer quality on a small synthetic set; record the chosen default models (Q1).

## Out of scope
Hosted providers, tools, routing between models, conversation memory, frontend, Super Admin controls, approximate indexes, billing.

## Tests
Adapter tests against a local stub HTTP server (success, timeout, malformed response, error status, no secret in logs or errors). All existing tests keep passing with the fake providers as the default (296 without a database, 334 with). A manual end-to-end run with the real model on synthetic schools, recorded in `AI_PROGRESS.md`.

## Constraints for the session
Do not edit `.env`. Do not commit, push or merge unless asked. Never use the core database or the default compose project for tests. No school data leaves the deployment.

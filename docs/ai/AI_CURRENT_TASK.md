# Current Task — none started

AI-010 (real local model providers) is done and validated with real models; see `AI_PROGRESS.md` and D55–D59. It is uncommitted until the user asks for a checkpoint. AI-005B stays deferred. Do not start a new task without a brief.

## What a deployment needs to use the local models
`Ai:Providers:Chat=local`, `Ai:Providers:Embedding=local`, `Ai:Providers:TimeoutSeconds=120`, `Ai:Providers:LocalChat:Model`, `Ai:Providers:LocalEmbedding:Model` and `:Dimension` (384 for `bge-small-en-v1.5`), `Ai:Retrieval:MinSimilarity=0.65`, and one start with `Ai:Knowledge:AdoptEmbeddingModel=true`, after which every stored document is embedded again.

## Open follow-ups (candidates for the next brief)
1. Deployment: `ai-service` runs in a container on an internal network and cannot reach a runtime on the host's loopback. A runtime container under profile `ai` on that network (`AllowPrivateNetwork`) and the provider settings in compose are not wired yet.
2. Re-embedding is one document at a time; there is no bulk step for a school or a deployment, and vectors of a retired space are not removed.
3. The similarity threshold (0.65) and the chat model rest on one small synthetic sample; the evaluation set (AI-015) should confirm them, including questions the documents do not cover and longer documents.
4. English only so far. Documents in Indian languages need a multilingual embedding model and a re-check of the chat model.
5. Memory: the chat model takes about 1.1 GB; on the 7.3 GB development machine about 0.45 GB stayed available while it ran beside Docker Desktop.

## Constraints for the session
Do not edit `.env`. Do not commit, push or merge unless asked. Never use the core database or the default compose project for tests. Synthetic data only.

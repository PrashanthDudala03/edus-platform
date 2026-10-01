# Current Task — AI-012: Structured EduOS Tool Foundation (not started)

Do not start without a brief. Read `AI_SECURITY_RULES.md` first (S1 to S7 and S12 to S15 in particular), and `AI_REPO_MAP.md` for paths. AI-005B stays deferred.

## Where things stand
Backend complete through AI-010 (real local models, checkpoint `cb9b6b3`). AI-011, the chat UI, is done and uncommitted: it is a presentation layer only (D60). The assistant answers from uploaded knowledge and nothing else; the UI says so.

## Goal of AI-012
Let the assistant answer from live EduOS data through a small set of read-only tools, without the model ever deciding authorization and without any SQL or database access for the model.

## Outline (to be confirmed by the brief)
1. Tool definitions and tool calls in the provider contract (D27 moved them here).
2. A registry of read-only tools, each a call to an existing EduOS endpoint made with the user's own token, so the gateway and the owning service authorize it exactly as for the user.
3. Arguments validated by the service, never taken from the model as trusted; results bounded and treated as untrusted data in the prompt, like documents (D51).
4. Direct answers without a model for intents that map to one tool.
5. Metering, rate limits and the circuit breaker unchanged.

## Open follow-ups from earlier tasks
- Chat UI has not been exercised against the running stack with real models (needs the stack rebuilt with this frontend, `ai-service` started and a user granted `ai.assistant.use`).
- nginx's default 60-second proxy timeout is shorter than the 120-second provider timeout recommended for CPU inference; the largest answer measured took 40 seconds.
- Runtime container wiring, bulk re-embedding, removal of retired-space vectors and the evaluation set are still open (see `AI_PROGRESS.md`).

## Constraints for the session
Do not edit `.env`. Do not commit, push or merge unless asked. Never use the core database or the default compose project for tests. Synthetic data only.

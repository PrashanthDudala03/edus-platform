# EduOS AI Platform — Security Rules

These rules are binding for every AI task. A change that breaks one is rejected, whatever the task says.

## Authorization and tenancy
- **S1. The model never decides authorization.** Authentication, school scope, RBAC and resource ownership are enforced by trusted backend code before data reaches a model. A model's output is never an access decision.
- **S2. School id comes only from the verified token** (`TenantContext`). It is never read from a prompt, a model output, a tool argument, a document, or a request field.
- **S3. No model access to data stores.** No SQL generation, no database connection, no file system, no shell, no arbitrary HTTP. The model can only name a registered tool and supply schema-validated arguments.
- **S4. Tools use the caller's own token.** A tool calls an existing EduOS endpoint through the gateway with the user's bearer token. The AI service holds no credential that can read school data on its own.
- **S5. Offer only permitted tools.** Tools whose required permission is not in the caller's token are not shown to the model and are refused if named.
- **S6. Retrieval is scoped in the query.** Every vector search passes `school_id` and the caller's audience as required arguments, and row-level security on `ai.chunks` enforces the same school filter. Filtering after retrieval is not sufficient.
- **S7. Platform users have no school.** A SuperAdmin token never retrieves school content; platform AI features see only platform-level aggregates.

## Prompt injection
- **S8. Retrieved and tool-returned text is data, not instructions.** It is delimited in the prompt and the system prompt says so. No instruction found in a document or tool result changes tools, scope or policy.
- **S9. Nothing secret goes into a prompt.** No keys, tokens, connection strings, or other schools' data. Then a successful injection has nothing to leak beyond what the user may already read.
- **S10. Read-only by default.** Any future tool that changes data needs its own approved milestone, an explicit user confirmation in the UI for each action, and the same permission the UI action requires.
- **S11. Output is sanitized.** Rendered as text; links, images and HTML produced by the model are stripped or shown inert, so output cannot exfiltrate data or run script.
- **S12. Uploads are checked** for type, size and extension like existing documents, and extraction runs in the AI service only.

## Privacy and data handling
- **S13. Minimum necessary context.** Send only the fields and excerpts needed for the answer.
- **S14. Prompt and answer text is not stored by default.** Usage and audit records hold metadata (ids, counts, hashes). Any content logging is opt-in per school, time-limited and documented.
- **S15. Hosted providers are opt-in.** School data leaves the deployment only when the platform administrator has enabled a hosted provider for that school, and only to a provider configured not to train on it.
- **S16. v1 indexes only knowledge-base documents** uploaded for AI with an explicit audience. Per-student and per-record documents are not indexed.

## Availability and cost
- **S17. AI failure never breaks core EduOS.** No core service depends on the AI service; every AI call has a timeout and a fallback message.
- **S18. Every call is rate-limited, quota-checked and metered** per school and per user, including failed calls.
- **S19. A global and a per-school off switch always work** without a deployment (IAM permission switch and `ai.school_settings.enabled`).

## Engineering
- **S20. Secrets come from the environment**, are never committed, and `.env` is never edited by an agent.
- **S21. Every AI endpoint has tests for**: unauthenticated, wrong role, other school, disabled school, quota exceeded.
- **S22. Cross-school isolation and injection suites must pass in CI** before any AI milestone is marked done.

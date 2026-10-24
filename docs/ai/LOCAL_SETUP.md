# Local EduOS AI

The assistant runs through the existing authenticated `/api/v1/ai/*` gateway routes. It uses local Ollama models and a separate pgvector database; no paid cloud provider or API key is involved.

## Start or restart

Start the Ollama desktop application, then run from the project root:

```powershell
./scripts/start-ai.ps1
```

Use `-Build` after application source changes. The script loads the normal `.env` together with ignored `.local/ai.env` and `.local/compose.ai.yml`. It resolves Docker Desktop's private IPv4 host address for the model endpoints. The ordinary `.env` is unchanged.

Local credentials in `.local/ai.env` must be retained with the AI database volume. They are not printed by the startup script and must not be committed. The local Compose file contains provider configuration, not passwords.

Models installed for this machine:

- Chat: `qwen2.5:1.5b`
- Embeddings: `all-minilm`, 384 dimensions

The chat provider timeout is 120 seconds. Short questions may still take a while on this machine. General study answers are labeled as general knowledge. This small local model is intended for lightweight school assistance.

## Access

The user approved activation for all active schools and standard school roles. Migration `20261021_02_ai_assistant` grants assistant use once to Administrator, Principal, Teacher, Parent, and Student templates and their standard roles. Administrators additionally receive knowledge-management and usage access; Principals receive usage access. Later restarts preserve removed permissions.

The startup script inserts settings for active schools with a monthly allowance of 1,000,000 model tokens. Existing settings are preserved, including a school's disabled state or custom allowance. Run it again after adding schools. The quota is a local usage limit, not a monetary charge.

Existing users must sign in again after the permission migration. The floating button now follows actual permission checks instead of showing an inactive demo. Platform SuperAdmin has no school context and does not receive access to school chat.

## Answers and school data

- Greetings and assistant information use fixed responses.
- Student count, school attendance summaries, fee summaries, and exam schedules use existing read-only tools only when the caller has permission.
- General study questions use the local chat model.
- School policies require actual documents uploaded through the existing knowledge API; missing documents result in an insufficient-knowledge notice, not an invented policy.
- Personal student records are not available through the current assistant tools. Existing school-data permissions remain enforced.
- Chat messages stay in memory in the browser. Usage records contain metadata and counts rather than prompt or answer text.

## Checks

The existing AI test suite passed 499 tests, with 42 integration tests skipped because they require dedicated test databases/runtimes. All 12 frontend assistant tests passed. `scripts/verify-ai.mjs` tests the running demo workspace, including a temporary synthetic knowledge document which is deleted after verification. Set `EDUOS_DEMO_TEST_PASSWORD` before running it. Test chat requests use the configured local models.

Live verification passed 17 API checks, including a real local-model study answer, school tools, role restrictions, document retrieval and a grounded answer with sources. All application and AI containers were healthy after setup.

## Response reliability — 22 October 2026

Financial shorthand such as 'what is the amount collected?' routes directly to the permission-scoped fee tool rather than general model generation. Financial queries do not use document embeddings. The request has a 115-second total deadline; the gateway and nginx AI routes allow 135 seconds, and the browser allows 130 seconds. The panel displays a slower-response hint after eight seconds and provides Stop to cancel the request.

Checks: 510 AI tests passed (42 integration tests skipped), 12 frontend assistant tests passed, and 18 live checks passed. The exact collected-amount question returned live data in 215 ms. The actual knowledge base held zero documents and zero chunks before verification; the temporary verification document was removed afterward. No model or embedding-space change was made for this fix.

## School-data coverage — 22 October 2026

The assistant now has a compiled allowlist of 30 existing school modules plus staff directory and leave balances. These use bounded, read-only API calls with the caller's token, and fixed formatting; they do not call a model or embedding provider. Module permissions and API profile scopes remain authoritative. Directory results omit email/phone contacts. Record lookups omit notes, medical reasons and internal remarks. A first-page limit is reported with the relevant module path. Staff balances show at most ten staff profiles per call; a teacher without directory access uses only the existing own-profile balance endpoint.

The screenshot questions for staff details, leave types and leave adjustments (including the supplied 'life balance' typo) now route to live data. Staff attendance is kept separate from student attendance. Empty adjustment records are identified as no saved adjustments, rather than missing school knowledge. School policy questions continue to use uploaded documents.

Verification: 520 AI tests passed (42 integration tests skipped). scripts/verify-school-bot.mjs passed 13 read-only checks, including denied parent access to the staff directory. Authorized live answers took 44–237 ms on this run. Only the AI service was rebuilt/restarted for this change.

## Permission-scoped semantic routing - 22 October 2026

Common lookups use zero model tokens. Unmatched school questions can use the local Qwen2.5 1.5B model to select a permitted read-only tool and list/count operation. The model receives tool labels and the question, never database rows or credentials. Exact offered tool names are validated, count synonyms are normalized, and unknown selections fail closed. Document retrieval still uses all-minilm; switching the chat model does not require reindexing embeddings.

Selection costs are metered, limited to 32 output tokens and a 30-second deadline. Successful routing decisions are cached for five minutes by school, user, audience, permissions and question (maximum 256 entries). Answers are not cached: every request fetches fresh data through existing permission-scoped APIs. Date/status/person filters and multi-tool questions are not implemented by this selector and require clarification or the module page. This does not expose arbitrary SQL or scan the entire database.

Verification: 104 focused routing, cache and authorization tests passed. scripts/verify-ai-routing.mjs passed against the running local model: teacher count 117 ms / zero tokens, semantic teacher headcount 547 ms / 476 tokens, repeated semantic request 61 ms / zero tokens. Instructor names matched live records; parent access remained denied. Timings depend on model warm-up and hardware. Set EDUOS_DEMO_TEST_PASSWORD before running the script.

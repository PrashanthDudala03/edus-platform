# Current Task — AI-013: Safe Tool Routing & Assistant Integration (not started)

Do not start without a brief. Read `AI_SECURITY_RULES.md` first (S1 to S5, S8 to S11, S13, S14), D51 and D61 to D63, and `AI_REPO_MAP.md` for paths. AI-005B stays deferred.

## Where things stand
The assistant answers from uploaded knowledge (RAG, AI-009) with real local models (AI-010) and a chat panel (AI-011). AI-012 added four read-only tools behind `AiToolRegistry`, tested and run against the real stack, but nothing calls them from a request: there is no tool endpoint, and `AiGateway.Ask` does not know about tools.

## Goal of AI-013
Let a question such as "how many students do we have?" or "what was attendance today?" be answered from live EduOS data, by routing it to one registered tool and wording the result, without giving a model the power to act on its own.

## Points the brief must settle
1. Routing: how a question is matched to at most one tool (deterministic intent rules first; a model may only pick from `Offered(caller)` and supply schema-valid arguments, and its choice is validated by the registry like any other).
2. One tool call per question, no loops, no chaining; knowledge retrieval stays the fallback, and `insufficient-knowledge` stays the answer when neither applies.
3. The caller's bearer token must reach `AiGateway.Ask` (`ToolCaller.From(http, tenant)`); it is never logged, stored or put in a prompt.
4. Tool results go to the model as untrusted reference material in their own message (D51), or are worded directly without a model for simple totals.
5. The response shows where the figures came from (a "source" that names the tool's subject, such as "Attendance register"), never an identifier.
6. Rate limit, quota, metering and the circuit breaker apply as for any assistant request; tool calls are already audited.
7. The chat panel's statement that it cannot see attendance, fees or marks must change only for what is actually wired.

## Known limits to carry in
- "Today" in a tool is the UTC date; schools in India are five and a half hours ahead.
- Tool permissions follow the endpoints: `attendance_summary` needs `overview.view` (school leadership), not `attendance.view`.
- `fee_summary` reads the whole fee list of the caller's scope to total it; very large schools get `too-large`. A summary endpoint in school-service would be the proper fix.
- The live environment's AI service runs the image built before AI-012; it needs a rebuild to contain the tools.

## Constraints for the session
Do not edit `.env`. Do not commit, push or merge unless asked. Never use the core database or the default compose project for tests. Synthetic or demo data only.

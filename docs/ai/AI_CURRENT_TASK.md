# Current Task — none started

AI-013 (safe assistant routing) is done and committed, together with the demo-environment changes listed in `AI_PROGRESS.md`. AI-005B stays deferred. Do not start a new task without a brief.

## What the assistant does now
Greets and describes itself in fixed words; answers from the school's documents with sources; answers general study questions from the model, marked as general; gives live figures from four read-only tools (student count, attendance for a day, fee totals, exam dates) for callers whose token permits them; declines questions about individual people. See D64 and D65.

## Limits to keep in mind
- Routing is by keyword rules in English. A question phrased unusually goes to the documents and may end in `insufficient-knowledge`.
- One tool per question; no follow-up questions, no memory, no combining a tool with documents.
- The caller's own name, role and email come from `current_user_profile`. There is no tool for a student's marks or attendance, a class, or any other per-person data.
- "Today" is the UTC date. `attendance_summary` needs `overview.view`.
- General answers come from a small local model and are only as good as it is; they take 10 to 20 seconds on the development machine.

## Candidates for the next brief
A profile/"my data" tool over the suite endpoints that already scope by linked profile; tool results combined with documents; an evaluation set for routing; the deployment items still open in `AI_PROGRESS.md`.

## Constraints for the session
Do not edit `.env`. Do not commit, push or merge unless asked. Never use the core database or the default compose project for tests. Synthetic or demo data only.

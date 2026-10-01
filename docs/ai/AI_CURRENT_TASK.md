# Current Task — AI-005B: Super Admin controls for school AI

Do only this task. Read `AI_SECURITY_RULES.md` first, and `AI_REPO_MAP.md` for paths. Do not re-scan the repository.

## Goal
The platform administrator can switch AI on for a school, set its monthly token budget and highest tier, and see usage across schools. Schools still cannot change their own settings.

## The design question to settle first (D24)
`ai_app` can only read one school's settings and can never read across schools. The platform path must be explicit and must not loosen that. Recommended: a second restricted database account used only by platform endpoints, with its own entry point that requires `TenantContext.IsPlatform`, write access to `ai.school_settings` only, and read access to usage totals only. The alternative is a small set of `SECURITY DEFINER` functions. Choose one, record it in `AI_DECISIONS.md`, and extend `AiPersistenceTests` so the choice is enforced.

## Scope
1. Migration in `services/ai-service/Migrations/` for the chosen platform path. Additive; row-level security stays forced on every table.
2. `PUT /api/ai/admin/schools/{id}` (`enabled`, `monthlyTokenBudget`, `maxTier`) and `GET /api/ai/admin/schools` (settings and this month's totals per school). Permission `ai.platform.manage` (already mapped in `PermissionAccess`), platform users only. The school id in the path is the target; it is never taken from a school user.
3. Every change writes an `ai.audit` row (who, which school, old and new values).
4. Existing SuperAdmin roles do not hold `ai.platform.manage` yet (new installations get it from the catalogue). Granting it needs a one-time migration in **auth-service**, which touches the core database: ask before doing it, or leave it as a documented manual step.

## Out of scope
Billing-plan entitlements (AI-015), UI (AI-012), per-user limits, changes to quota rules, RAG, tools, real providers.

## Tests
In process: permission and platform checks, validation, audit row, a school user is refused. Real database (recipe in `AI_REPO_MAP.md`): the platform account cannot read prompts (there are none), cannot touch anything but settings and totals, and `ai_app` still cannot write settings or read across schools. All existing tests still pass (145 without a database, 162 with).

## Acceptance
- `AI_PROGRESS.md` updated; this file rewritten for the next task.

## Constraints for the session
Do not edit `.env`. Do not push or merge unless asked. Do not run migrations against the core database without explicit approval.

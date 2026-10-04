# Database migrations

## 20260930_01_role_model

**What it does.** SuperAdmin becomes a platform-only role in the reserved tenant `00000000-0000-0000-0000-00000000e005`. Each school's top role is renamed to `Administrator`, keeping its id, and every school gets the five school roles. Credentials are unchanged. Affected accounts get `token_version + 1` and sign in again.

**Applied by** auth-service on start (idempotent): `services/auth-service/Migrations/20260930_01_role_model.sql`. Recorded in `auth_db.schema_migrations`.

**Before deploying:** `node scripts/backup.mjs`, then `node scripts/restore.mjs backups/<folder>` to rehearse the restore.

**Rollback**
1. `node scripts/backup.mjs`
2. Check out the previous commit and rebuild: `docker compose up -d --build`
3. `docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f - < services/auth-service/Migrations/20260930_01_role_model.rollback.sql`

Run step 3 only after the old auth-service is running; the new one re-applies the forward migration on start. Full restore alternative: `node scripts/restore.mjs backups/<folder> --apply --confirm <POSTGRES_DB>`.

## Billing foundation (2026-10-02)

**What it does.** Adds the `billing` schema: `plans`, `offers`, `banners`, `subscriptions`, `school_prices`, `payments`, `webhook_events` and `settings`. Amounts are stored in minor units (paise for INR). Once only, it grants `subscription.view` and `subscription.purchase` to school Administrators and the `billing.*` permissions to the platform SuperAdmin; those accounts get `token_version + 1` and sign in again. No existing table or school data is changed, and a school without a subscription keeps working.

**Applied by** auth-service on start (idempotent): `services/auth-service/Migrations/20261002_01_billing.sql`. Recorded in `auth_db.schema_migrations`.

**Configuration.** Online payment is optional. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` in `.env` (test keys start with `rzp_test_`) and point the Razorpay webhook at `https://<host>/api/v1/billing/webhooks/razorpay` for `payment.captured`, `order.paid` and `payment.failed`. auth-service joins the `payments-egress` network so it can reach Razorpay; no other service has outbound access.

**Rollback.** Deploy the previous commit, then `DROP SCHEMA billing CASCADE;` and `DELETE FROM auth_db.schema_migrations WHERE id = '20261002_01_billing';`. The extra permissions are ignored by older code.

## AI core storage (2026-10-03)

**What it does.** In the separate AI database only (compose service `ai-db`, profile `ai`, volume `ai_db_data`): enables the `vector` extension, creates schema `ai` with `school_settings`, `usage_events`, `audit` and `schema_migrations`, the restricted account `ai_app`, and forced row-level security keyed on the school of the current transaction. The EduOS core database, its image and its volume are not touched.

**Applied by** ai-service on start, with the owner connection (`ConnectionStrings__AiDbMigrations`): `services/ai-service/Migrations/20261003_01_ai_core.sql`. Recorded in `ai.schema_migrations`. If the database is missing the service keeps running and reports AI as unavailable.

**Rollback.** Stop ai-service, then in the AI database: `DROP SCHEMA ai CASCADE; DROP ROLE ai_app;`. Nothing outside the AI database depends on it.

## Student 360 (2026-10-04, no database change)

**What it does.** Nothing in the database: two read-only endpoints compose existing tables and records per request. Rebuild school-service, the api-gateway (permission map) and the frontend.

## Exams & Report Cards (2026-10-04, no database change)

**What it does.** No table, column, index or permission changes. Exams and marks stay JSON documents in `suite.records`; the new fields (`yearId`, `term`, `schemeId`, `startsAt`, `endsAt`, `room`, `instructions`, the seven-stage `status` and the stage stamps on exams; `status`, `components`, `grade`, `pass`, `history`, `enteredBy/At` on marks) are keys inside that JSON. The new `assessment-schemes` record kind lives in the same table and shares the `exams.view` / `exams.manage` permissions, so no role rows are added. Existing records read as Draft or Published plain-marks exams exactly as before.

**Applied by** nothing: rebuild school-service, the api-gateway (permission map) and the frontend. Rollback is deploying the previous images; the extra JSON keys are ignored by older code, except that exams in the five new intermediate stages would read as drafts there.

## Homework & Assignments (2026-10-03, no database change)

**What it does.** No table, column, index or permission changes. Homework and submissions stay JSON documents in `suite.records`; the new fields (`submissionMode`, `status`, `publishedOn`, `dueTime`, `maxMarks` on homework; `outcome`, `verifiedAt`, `submittedAt`, `late`, `status`, `reviewedAt`, `history` on submissions) are keys inside that JSON, and the schema file `services/school-service/SuiteSchemas.json` ships with the image. Existing records read as Published, `Text` mode. Files stay in `suite.documents` and the document store.

**Applied by** nothing: rebuild school-service (and the frontend). Rollback is deploying the previous image; the extra JSON keys are ignored by older code.

## Smart Attendance (2026-10-05, prepared, not applied)

**What it does.** Additive only. `school_db.attendance` gains `reason`, `remark`, `marked_by` and `marked_at` (nullable or defaulted; existing rows are untouched). Two new tables: `school_db.attendance_registers` (one row per class and day once a register is submitted) and `school_db.attendance_history` (every submission and correction with actor, reason and the previous status), plus two indexes. The history table gets the existing `suite_audit` trigger so changes also appear in the attributed activity report. No permission changes: the workflow reuses `attendance.view`, `attendance.mark` and `reports.view`.

**Applied by** school-service on start (idempotent): `services/school-service/AttendanceSchema.sql`. Rebuild school-service only; auth-service and the gateway are unchanged.

**Rollback.** Deploy the previous image. Optionally `DROP TABLE school_db.attendance_history, school_db.attendance_registers; ALTER TABLE school_db.attendance DROP COLUMN reason, DROP COLUMN remark, DROP COLUMN marked_by, DROP COLUMN marked_at;`. Older code ignores the new columns.

## Notifications and notification wording (2026-10-02, prepared, not applied)

**What it does.** school-service creates schema `notify` with six new tables (`notifications`, `recipients`, `deliveries`, `preferences`, `template_overrides`, `devices`). Nothing existing is altered and no data is moved. Once only, auth-service grants the new `notifications.manage` permission to the Administrator role of existing schools and adds it to every school's boundary; those accounts get `token_version + 1` and sign in again. New installations receive it from the Administrator template defaults.

**Applied by** school-service on start (idempotent): `services/school-service/NotificationSchema.sql`; auth-service on start (once): `services/auth-service/Migrations/20261002_03_notification_templates.sql`, recorded in `auth_db.schema_migrations`. The gateway must be rebuilt with them, because the route and the endpoint-to-permission map live there.

**Rollback.** Deploy the previous commit. Optionally `DROP SCHEMA notify CASCADE; DELETE FROM auth_db.role_permissions WHERE permission_key='notifications.manage'; DELETE FROM auth_db.schema_migrations WHERE id='20261002_03_notification_templates';`.

## School Home (2026-10-02)

**What it does.** Adds no tables. School Home content is one `suite.records` row per school (kind `school-home`) and its images are `suite.documents` rows, both created on first use. Once only, the migration grants the new `school-home.manage` permission to the Administrator role of existing schools; those accounts get `token_version + 1` and sign in again. New installations receive it from the Administrator template defaults.

**Applied by** auth-service on start (idempotent): `services/auth-service/Migrations/20261002_02_school_home.sql`. Recorded in `auth_db.schema_migrations`. The gateway and school-service must be rebuilt with it, because the endpoint-to-permission map is shared.

**Rollback.** Deploy the previous commit. Optionally `DELETE FROM auth_db.role_permissions WHERE permission_key='school-home.manage'; DELETE FROM auth_db.schema_migrations WHERE id='20261002_02_school_home';`. School Home records and images are ignored by older code.

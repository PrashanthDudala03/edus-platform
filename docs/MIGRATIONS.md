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

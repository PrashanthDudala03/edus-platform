-- Rollback for EduOS migration 20260930_01_role_model
--
-- Restores the previous role model: each school's top role is named SuperAdmin
-- again and the platform tenant is removed.
--
-- Apply ONLY after the previous auth-service image is running again, otherwise
-- the new service re-applies the forward migration on its next start:
--   1. node scripts/backup.mjs
--   2. git checkout <previous commit> && docker compose up -d --build auth-service api-gateway
--      student-service teacher-service parent-service school-service frontend
--   3. docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
--        -f - < services/auth-service/Migrations/20260930_01_role_model.rollback.sql
-- Credentials are untouched; affected accounts sign in again.

BEGIN;

-- 1. Platform tenant accounts do not exist in the old model.
DELETE FROM auth_db.refresh_tokens WHERE school_id = '00000000-0000-0000-0000-00000000e005';
DELETE FROM auth_db.password_resets WHERE school_id = '00000000-0000-0000-0000-00000000e005';
DELETE FROM auth_db.users WHERE school_id = '00000000-0000-0000-0000-00000000e005';
DELETE FROM auth_db.role_permissions p USING auth_db.roles r
 WHERE p.role_id = r.id AND r.school_id = '00000000-0000-0000-0000-00000000e005';
DELETE FROM auth_db.roles WHERE school_id = '00000000-0000-0000-0000-00000000e005';

-- 2. Rename each school's Administrator role back to SuperAdmin.
UPDATE auth_db.users u SET token_version = u.token_version + 1
  FROM auth_db.roles r
 WHERE u.role_id = r.id AND r.name = 'Administrator';

UPDATE auth_db.roles r
   SET name = 'SuperAdmin', description = 'School system administrator', updated_at = now()
 WHERE r.name = 'Administrator'
   AND NOT EXISTS (SELECT 1 FROM auth_db.roles s WHERE s.school_id = r.school_id AND s.name = 'SuperAdmin');

DELETE FROM auth_db.schema_migrations WHERE id = '20260930_01_role_model';

COMMIT;

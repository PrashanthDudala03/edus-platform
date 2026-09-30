-- EduOS migration 20260930_01_role_model
--
-- SuperAdmin becomes a platform-only role that lives in the reserved platform
-- tenant 00000000-0000-0000-0000-00000000e005. Each school's top role becomes
-- Administrator, and every school gets the five school roles.
--
-- Before applying:  node scripts/backup.mjs
-- To roll back:     services/auth-service/Migrations/20260930_01_role_model.rollback.sql
--                   (see docs/MIGRATIONS.md for the full procedure)
--
-- Idempotent: auth-service applies it on every start and a second run changes nothing.
-- Credentials are untouched. Affected accounts get token_version + 1, so existing
-- sessions carrying the old role end and the user signs in again.

CREATE TABLE IF NOT EXISTS auth_db.schema_migrations(
  id varchar(100) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now());

-- 1. Rename each school's SuperAdmin role in place (keeps its id and permissions)
--    where the school has no Administrator role yet.
UPDATE auth_db.users u SET token_version = u.token_version + 1
  FROM auth_db.roles r
 WHERE u.role_id = r.id AND r.name = 'SuperAdmin'
   AND r.school_id <> '00000000-0000-0000-0000-00000000e005';

UPDATE auth_db.roles r
   SET name = 'Administrator', description = 'School administrator', updated_at = now()
 WHERE r.name = 'SuperAdmin'
   AND r.school_id <> '00000000-0000-0000-0000-00000000e005'
   AND NOT EXISTS (SELECT 1 FROM auth_db.roles a WHERE a.school_id = r.school_id AND a.name = 'Administrator');

-- 2. A school that already had both roles: move remaining SuperAdmin members to
--    Administrator, then drop the school-level SuperAdmin role.
UPDATE auth_db.users u SET role_id = a.id
  FROM auth_db.roles s
  JOIN auth_db.roles a ON a.school_id = s.school_id AND a.name = 'Administrator'
 WHERE u.role_id = s.id AND s.name = 'SuperAdmin'
   AND s.school_id <> '00000000-0000-0000-0000-00000000e005';

DELETE FROM auth_db.role_permissions p USING auth_db.roles s
 WHERE p.role_id = s.id AND s.name = 'SuperAdmin'
   AND s.school_id <> '00000000-0000-0000-0000-00000000e005';

DELETE FROM auth_db.roles s
 WHERE s.name = 'SuperAdmin'
   AND s.school_id <> '00000000-0000-0000-0000-00000000e005'
   AND NOT EXISTS (SELECT 1 FROM auth_db.users u WHERE u.role_id = s.id);

-- 3. Every school has the five school roles.
INSERT INTO auth_db.roles (id, school_id, name, description, is_system_role, created_at, updated_at)
SELECT gen_random_uuid(), s.id, r.name, r.description, TRUE, now(), now()
  FROM school_db.schools s
 CROSS JOIN (VALUES ('Administrator', 'School administrator'),
                    ('Principal', 'School principal'),
                    ('Teacher', 'Assigned classes and teaching'),
                    ('Parent', 'Linked student family portal'),
                    ('Student', 'Personal learning portal')) AS r(name, description)
 WHERE s.id <> '00000000-0000-0000-0000-00000000e005'
ON CONFLICT (school_id, name) DO NOTHING;

INSERT INTO auth_db.schema_migrations(id) VALUES ('20260930_01_role_model') ON CONFLICT (id) DO NOTHING;

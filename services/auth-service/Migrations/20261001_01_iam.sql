-- Additive IAM migration. Applied transactionally; never resets configured grants.
CREATE TABLE IF NOT EXISTS auth_db.permissions (
 key varchar(100) PRIMARY KEY, module text NOT NULL, enabled boolean NOT NULL DEFAULT true,
 delegatable boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS auth_db.role_templates (
 id uuid PRIMARY KEY, name varchar(100) NOT NULL UNIQUE, description text NOT NULL DEFAULT '',
 data_scope text NOT NULL CHECK(data_scope IN ('school','teacher','parent','student','platform')),
 enabled boolean NOT NULL DEFAULT true, assignable boolean NOT NULL DEFAULT true,
 maximum text[] NOT NULL DEFAULT '{}', defaults text[] NOT NULL DEFAULT '{}');
ALTER TABLE auth_db.roles ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES auth_db.role_templates(id);
ALTER TABLE auth_db.roles ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
ALTER TABLE auth_db.roles ADD COLUMN IF NOT EXISTS assignable boolean NOT NULL DEFAULT true;
UPDATE auth_db.roles SET description='' WHERE description IS NULL;
ALTER TABLE auth_db.roles ALTER COLUMN description SET DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS roles_tenant_identity ON auth_db.roles(school_id,id);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='users_tenant_role_fk') THEN
 ALTER TABLE auth_db.users ADD CONSTRAINT users_tenant_role_fk FOREIGN KEY(school_id,role_id) REFERENCES auth_db.roles(school_id,id);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS auth_db.school_access (
 school_id uuid PRIMARY KEY REFERENCES school_db.schools(id), allowed text[] NOT NULL DEFAULT '{}',
 signup_code varchar(64) NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text,'-',''));
CREATE TABLE IF NOT EXISTS auth_db.iam_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, actor_id uuid,
 actor_role text NOT NULL, action text NOT NULL, target_id uuid,
 old_value jsonb, new_value jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS iam_audit_school_time ON auth_db.iam_audit(school_id,created_at DESC);
CREATE TABLE IF NOT EXISTS auth_db.signup_requests (
 id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES school_db.schools(id),
 email varchar(255) NOT NULL, first_name varchar(100) NOT NULL, last_name varchar(100) NOT NULL,
 phone varchar(20) NOT NULL, password_hash text NOT NULL, requested_role varchar(100) NOT NULL,
 status text NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Rejected','Cancelled','Expired')),
 approved_role uuid, user_id uuid, reviewed_by uuid, reviewed_at timestamptz, reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,approved_role) REFERENCES auth_db.roles(school_id,id));
CREATE UNIQUE INDEX IF NOT EXISTS signup_pending_email ON auth_db.signup_requests(school_id,lower(email)) WHERE status='Pending';
CREATE INDEX IF NOT EXISTS signup_school_status ON auth_db.signup_requests(school_id,status,created_at DESC);
-- Effective grants always intersect the current platform, school and role boundaries.
CREATE OR REPLACE VIEW auth_db.effective_permissions AS
 SELECT DISTINCT r.id AS role_id, p.key AS permission_key
 FROM auth_db.roles r JOIN auth_db.role_templates t ON t.id=r.template_id
 JOIN auth_db.role_permissions rp ON rp.role_id=r.id
 JOIN auth_db.permissions p ON p.key=rp.permission_key
 LEFT JOIN auth_db.school_access s ON s.school_id=r.school_id
 WHERE r.enabled AND t.enabled AND p.enabled AND p.key=ANY(t.maximum)
 AND (t.data_scope='platform' OR p.key=ANY(s.allowed));
INSERT INTO auth_db.schema_migrations(id) VALUES ('20261001_01_iam') ON CONFLICT DO NOTHING;

-- Preserve the meaning of existing family links independently of later role changes.
DO $$ BEGIN
 IF to_regclass('suite.records') IS NOT NULL THEN
 UPDATE suite.records sr SET data=jsonb_set(sr.data,'{relationship}',to_jsonb(CASE WHEN COALESCE(sr.data->>'teacherId','')<>'' THEN 'teacher' WHEN r.name='Student' THEN 'student' ELSE 'parent' END))
 FROM auth_db.users u JOIN auth_db.roles r ON r.id=u.role_id WHERE sr.kind='account-links' AND sr.school_id=u.school_id AND sr.data->>'userId'=u.id::text AND NOT sr.data ? 'relationship';
 END IF;
END $$;

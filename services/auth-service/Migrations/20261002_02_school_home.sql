-- School Home: one-time grant of the management permission to the Administrator role of existing schools.
-- New installations receive it from the Administrator template defaults. Later starts never restore a
-- permission that an administrator has removed. No tables are added: School Home content is one suite
-- record per school (kind 'school-home') and its images are suite documents.
DO $$
DECLARE school_keys text[] := ARRAY['school-home.manage'];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth_db.schema_migrations WHERE id='20261002_02_school_home') THEN
  UPDATE auth_db.role_templates SET maximum=ARRAY(SELECT DISTINCT unnest(maximum||school_keys)), defaults=ARRAY(SELECT DISTINCT unnest(defaults||school_keys)) WHERE name='Administrator';
  UPDATE auth_db.school_access SET allowed=ARRAY(SELECT DISTINCT unnest(allowed||school_keys));
  INSERT INTO auth_db.role_permissions(id,role_id,permission_key)
  SELECT gen_random_uuid(),r.id,k FROM auth_db.roles r JOIN auth_db.role_templates t ON t.id=r.template_id
  CROSS JOIN unnest(school_keys) k
  WHERE t.name='Administrator' AND r.name=t.name
  AND NOT EXISTS(SELECT 1 FROM auth_db.role_permissions rp WHERE rp.role_id=r.id AND rp.permission_key=k);
  -- Access tokens carry permissions, so school Administrators sign in again to receive the new one.
  UPDATE auth_db.users SET token_version=token_version+1 WHERE role_id IN
  (SELECT r.id FROM auth_db.roles r JOIN auth_db.role_templates t ON t.id=r.template_id WHERE t.name='Administrator' AND r.name=t.name);
  INSERT INTO auth_db.schema_migrations(id) VALUES ('20261002_02_school_home');
 END IF;
END $$;

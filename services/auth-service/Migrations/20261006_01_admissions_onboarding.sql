-- Admissions 2.0 and Student Onboarding 2.0: one-time grant of the new permissions to the fixed roles of existing schools,
-- matching the template defaults new installations receive. Later starts never restore a permission that an administrator
-- has removed. No tables are added: applications, the admission form and the onboarding plan are suite records in
-- school-service, audited by the records trigger.
DO $$
DECLARE
 admin_keys text[] := ARRAY['admissions.approve','onboarding.manage','admission-fields.view','admission-fields.manage','admission-fields.archive'];
 principal_keys text[] := ARRAY['admissions.approve','admission-fields.view'];
 r record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth_db.schema_migrations WHERE id='20261006_01_admissions_onboarding') THEN
  UPDATE auth_db.school_access SET allowed=ARRAY(SELECT DISTINCT unnest(allowed||admin_keys));
  FOR r IN SELECT * FROM (VALUES ('Administrator',admin_keys),('Principal',principal_keys)) AS v(role,keys) LOOP
   UPDATE auth_db.role_templates SET maximum=ARRAY(SELECT DISTINCT unnest(maximum||r.keys)), defaults=ARRAY(SELECT DISTINCT unnest(defaults||r.keys)) WHERE name=r.role;
   INSERT INTO auth_db.role_permissions(id,role_id,permission_key)
   SELECT gen_random_uuid(),ro.id,k FROM auth_db.roles ro JOIN auth_db.role_templates t ON t.id=ro.template_id
   CROSS JOIN unnest(r.keys) k
   WHERE t.name=r.role AND ro.name=t.name
   AND NOT EXISTS(SELECT 1 FROM auth_db.role_permissions rp WHERE rp.role_id=ro.id AND rp.permission_key=k);
  END LOOP;
  -- Access tokens carry permissions, so school leadership signs in again to receive the new ones.
  UPDATE auth_db.users SET token_version=token_version+1 WHERE role_id IN
  (SELECT ro.id FROM auth_db.roles ro JOIN auth_db.role_templates t ON t.id=ro.template_id WHERE t.name IN ('Administrator','Principal') AND ro.name=t.name);
  INSERT INTO auth_db.schema_migrations(id) VALUES ('20261006_01_admissions_onboarding');
 END IF;
END $$;

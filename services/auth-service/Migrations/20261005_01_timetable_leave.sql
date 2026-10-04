-- Timetable 2.0 and Leave & Approvals 2.0: one-time grant of the new module permissions to the fixed roles of existing
-- schools, matching the template defaults new installations receive. Later starts never restore a permission that an
-- administrator has removed. No tables are added: period structure, leave types, balance adjustments and substitutions
-- are suite records in school-service, audited by the records trigger.
DO $$
DECLARE
 admin_keys text[] := ARRAY['period-slots.view','period-slots.manage','period-slots.archive','substitutions.view','substitutions.manage','substitutions.archive','leave-types.view','leave-types.manage','leave-adjustments.view','leave-adjustments.manage','leave-requests.approve'];
 principal_keys text[] := ARRAY['period-slots.view','substitutions.view','substitutions.manage','leave-types.view','leave-adjustments.view','leave-adjustments.manage','leave-requests.approve'];
 teacher_keys text[] := ARRAY['period-slots.view','substitutions.view','leave-types.view'];
 family_keys text[] := ARRAY['period-slots.view'];
 all_keys text[] := ARRAY['period-slots.view','period-slots.manage','period-slots.archive','substitutions.view','substitutions.manage','substitutions.archive','leave-types.view','leave-types.manage','leave-adjustments.view','leave-adjustments.manage','leave-requests.approve'];
 r record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth_db.schema_migrations WHERE id='20261005_01_timetable_leave') THEN
  UPDATE auth_db.school_access SET allowed=ARRAY(SELECT DISTINCT unnest(allowed||all_keys));
  FOR r IN SELECT * FROM (VALUES ('Administrator',admin_keys),('Principal',principal_keys),('Teacher',teacher_keys),('Parent',family_keys),('Student',family_keys)) AS v(role,keys) LOOP
   UPDATE auth_db.role_templates SET maximum=ARRAY(SELECT DISTINCT unnest(maximum||r.keys)), defaults=ARRAY(SELECT DISTINCT unnest(defaults||r.keys)) WHERE name=r.role;
   INSERT INTO auth_db.role_permissions(id,role_id,permission_key)
   SELECT gen_random_uuid(),ro.id,k FROM auth_db.roles ro JOIN auth_db.role_templates t ON t.id=ro.template_id
   CROSS JOIN unnest(r.keys) k
   WHERE t.name=r.role AND ro.name=t.name
   AND NOT EXISTS(SELECT 1 FROM auth_db.role_permissions rp WHERE rp.role_id=ro.id AND rp.permission_key=k);
  END LOOP;
  -- Access tokens carry permissions, so school accounts sign in again to receive the new ones.
  UPDATE auth_db.users SET token_version=token_version+1 WHERE role_id IN
  (SELECT ro.id FROM auth_db.roles ro JOIN auth_db.role_templates t ON t.id=ro.template_id WHERE t.name IN ('Administrator','Principal','Teacher','Parent','Student') AND ro.name=t.name);
  INSERT INTO auth_db.schema_migrations(id) VALUES ('20261005_01_timetable_leave');
 END IF;
END $$;

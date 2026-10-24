-- Grant new operations once; later restarts preserve administrator changes.
DO $$ DECLARE admin_keys text[] := ARRAY['library-books.view','library-books.manage','library-loans.view','library-loans.manage','inventory-items.view','inventory-items.manage','inventory-assignments.view','inventory-assignments.manage','transport-routes.view','transport-routes.manage','transport-stops.view','transport-stops.manage','transport-assignments.view','transport-assignments.manage']; principal_keys text[] := ARRAY['library-books.view','library-loans.view','inventory-items.view','inventory-assignments.view','transport-routes.view','transport-stops.view','transport-assignments.view']; r record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth_db.schema_migrations WHERE id='20261021_01_advanced_operations') THEN
  UPDATE auth_db.school_access SET allowed=ARRAY(SELECT DISTINCT unnest(allowed||admin_keys));
  FOR r IN SELECT * FROM (VALUES ('Administrator',admin_keys),('Principal',principal_keys)) AS v(role,keys) LOOP
   UPDATE auth_db.role_templates SET maximum=ARRAY(SELECT DISTINCT unnest(maximum||r.keys)),defaults=ARRAY(SELECT DISTINCT unnest(defaults||r.keys)) WHERE name=r.role;
   INSERT INTO auth_db.role_permissions(id,role_id,permission_key)
   SELECT gen_random_uuid(),ro.id,k FROM auth_db.roles ro JOIN auth_db.role_templates t ON t.id=ro.template_id CROSS JOIN unnest(r.keys) k
   WHERE t.name=r.role AND ro.name=t.name AND NOT EXISTS(SELECT 1 FROM auth_db.role_permissions rp WHERE rp.role_id=ro.id AND rp.permission_key=k);
  END LOOP;
  UPDATE auth_db.users SET token_version=token_version+1 WHERE role_id IN(SELECT ro.id FROM auth_db.roles ro JOIN auth_db.role_templates t ON t.id=ro.template_id WHERE t.name IN ('Administrator','Principal') AND ro.name=t.name);
  INSERT INTO auth_db.schema_migrations(id) VALUES('20261021_01_advanced_operations');
 END IF;
END $$;

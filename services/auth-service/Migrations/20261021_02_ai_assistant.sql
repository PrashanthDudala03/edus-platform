-- One-time assistant grant for standard school roles. School data stays role-scoped.
DO $$ DECLARE r record; all_keys text[] := ARRAY['ai.assistant.use','ai.knowledge.manage','ai.usage.view'];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth_db.schema_migrations WHERE id='20261021_02_ai_assistant') THEN
  UPDATE auth_db.school_access SET allowed=ARRAY(SELECT DISTINCT unnest(allowed||all_keys));
  FOR r IN SELECT * FROM (VALUES
   ('Administrator',all_keys),('Principal',ARRAY['ai.assistant.use','ai.usage.view']),
   ('Teacher',ARRAY['ai.assistant.use']),('Parent',ARRAY['ai.assistant.use']),('Student',ARRAY['ai.assistant.use'])) AS v(role,keys) LOOP
   UPDATE auth_db.role_templates SET maximum=ARRAY(SELECT DISTINCT unnest(maximum||r.keys)),defaults=ARRAY(SELECT DISTINCT unnest(defaults||r.keys)) WHERE name=r.role;
   INSERT INTO auth_db.role_permissions(id,role_id,permission_key)
   SELECT gen_random_uuid(),ro.id,k FROM auth_db.roles ro JOIN auth_db.role_templates t ON t.id=ro.template_id CROSS JOIN unnest(r.keys) k
   WHERE t.name=r.role AND ro.name=t.name AND NOT EXISTS(SELECT 1 FROM auth_db.role_permissions rp WHERE rp.role_id=ro.id AND rp.permission_key=k);
  END LOOP;
  UPDATE auth_db.users SET token_version=token_version+1 WHERE role_id IN(SELECT ro.id FROM auth_db.roles ro JOIN auth_db.role_templates t ON t.id=ro.template_id WHERE t.name IN ('Administrator','Principal','Teacher','Parent','Student') AND ro.name=t.name);
  INSERT INTO auth_db.schema_migrations(id) VALUES('20261021_02_ai_assistant');
 END IF;
END $$;

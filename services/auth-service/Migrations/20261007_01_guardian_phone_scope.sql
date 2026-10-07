-- Schema-only change: retain every guardian and link, including soft-deleted rows.
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM auth_db.schema_migrations WHERE id='20261007_01_guardian_phone_scope') THEN
  -- Establish same-school protection before removing the global constraint.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='parent_db.parents'::regclass AND conname='parents_school_phone_number_key') THEN
   ALTER TABLE parent_db.parents ADD CONSTRAINT parents_school_phone_number_key UNIQUE (school_id, phone_number);
  END IF;
  ALTER TABLE parent_db.parents DROP CONSTRAINT IF EXISTS parents_phone_number_key;
  INSERT INTO auth_db.schema_migrations(id) VALUES ('20261007_01_guardian_phone_scope');
 END IF;
END $$;

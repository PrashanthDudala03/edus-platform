CREATE SCHEMA IF NOT EXISTS suite;
CREATE TABLE IF NOT EXISTS suite.records(
 id uuid PRIMARY KEY, school_id uuid NOT NULL,kind varchar(50) NOT NULL,data jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL,updated_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),archived_at timestamptz);
CREATE INDEX IF NOT EXISTS suite_records_school_kind ON suite.records(school_id,kind) WHERE archived_at IS NULL;
CREATE TABLE IF NOT EXISTS suite.student_classes(
 school_id uuid NOT NULL,student_id uuid NOT NULL REFERENCES student_db.students(id),class_id uuid NOT NULL REFERENCES suite.records(id),
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(school_id,student_id));
CREATE TABLE IF NOT EXISTS suite.counters(school_id uuid NOT NULL,kind varchar(30) NOT NULL,value bigint NOT NULL,PRIMARY KEY(school_id,kind));
CREATE TABLE IF NOT EXISTS suite.charges(
 id uuid PRIMARY KEY,school_id uuid NOT NULL,student_id uuid NOT NULL REFERENCES student_db.students(id),
 structure_id uuid NOT NULL REFERENCES suite.records(id),description text NOT NULL,due_date date NOT NULL,
 gross bigint NOT NULL CHECK(gross>0),concession bigint NOT NULL CHECK(concession>=0 AND concession<=gross),currency varchar(3) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),created_by uuid NOT NULL,UNIQUE(school_id,student_id,structure_id));
CREATE TABLE IF NOT EXISTS suite.payments(
 id uuid PRIMARY KEY,school_id uuid NOT NULL,charge_id uuid NOT NULL REFERENCES suite.charges(id),amount bigint NOT NULL CHECK(amount>0),
 method varchar(20) NOT NULL,reference varchar(150) NOT NULL,paid_on date NOT NULL,receipt varchar(40) NOT NULL,
 idempotency_key uuid NOT NULL,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(school_id,idempotency_key),UNIQUE(school_id,receipt));
CREATE TABLE IF NOT EXISTS suite.acknowledgements(
 school_id uuid NOT NULL,record_id uuid NOT NULL REFERENCES suite.records(id),user_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(school_id,record_id,user_id));
CREATE TABLE IF NOT EXISTS suite.documents(
 id uuid PRIMARY KEY,school_id uuid NOT NULL,record_id uuid NOT NULL REFERENCES suite.records(id),
 file_name varchar(150) NOT NULL,content_type varchar(100) NOT NULL,length bigint NOT NULL,uploaded_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS suite.audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),school_id uuid NOT NULL,user_id uuid,action varchar(30) NOT NULL,
 entity_type varchar(50) NOT NULL,entity_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION suite.audit_change() RETURNS trigger AS $$
DECLARE d jsonb;
BEGIN
 d:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 INSERT INTO suite.audit(school_id,user_id,action,entity_type,entity_id)
 VALUES((d->>'school_id')::uuid,COALESCE((d->>'updated_by')::uuid,(d->>'created_by')::uuid,(d->>'uploaded_by')::uuid,(d->>'user_id')::uuid),
 TG_OP,COALESCE(d->>'kind',TG_TABLE_NAME),COALESCE((d->>'id')::uuid,(d->>'record_id')::uuid,(d->>'student_id')::uuid));
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$ LANGUAGE plpgsql;
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['suite.records','suite.charges','suite.payments','suite.documents','suite.acknowledgements','suite.student_classes']
 LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='suite_audit' AND tgrelid=t::regclass) THEN
 EXECUTE format('CREATE TRIGGER suite_audit AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION suite.audit_change()',t);
 END IF;
 END LOOP;
END $$;

-- Prevent the legacy student editor from silently diverging from academic allocation.
CREATE OR REPLACE FUNCTION suite.guard_student_class() RETURNS trigger AS $$
DECLARE allocated_label text;
BEGIN
 SELECT r.data->>'name' || ' - ' || (r.data->>'section') INTO allocated_label
 FROM suite.student_classes sc JOIN suite.records r ON r.id=sc.class_id
 WHERE sc.school_id=NEW.school_id AND sc.student_id=NEW.id;
 IF allocated_label IS NOT NULL AND NEW.current_class IS DISTINCT FROM allocated_label THEN
  RAISE EXCEPTION 'Use class allocation to change an allocated student class' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$ LANGUAGE plpgsql;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='suite_student_class_guard' AND tgrelid='student_db.students'::regclass) THEN
 CREATE TRIGGER suite_student_class_guard BEFORE UPDATE OF current_class ON student_db.students FOR EACH ROW EXECUTE FUNCTION suite.guard_student_class();
 END IF;
END $$;

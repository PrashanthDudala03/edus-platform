-- Smart Attendance: additive changes to the existing daily register. Applied by school-service on start; idempotent.
-- Nothing existing is renamed, dropped or rewritten. The register table school_db.attendance stays the single source
-- of truth (one row per student and day); it gains the reason behind a status and who marked it.
ALTER TABLE school_db.attendance ADD COLUMN IF NOT EXISTS reason varchar(40);
ALTER TABLE school_db.attendance ADD COLUMN IF NOT EXISTS remark varchar(200);
ALTER TABLE school_db.attendance ADD COLUMN IF NOT EXISTS marked_by uuid;
ALTER TABLE school_db.attendance ADD COLUMN IF NOT EXISTS marked_at timestamptz NOT NULL DEFAULT now();
-- One row per class and day once a teacher submits the register for it: leadership sees which classes are done.
CREATE TABLE IF NOT EXISTS school_db.attendance_registers(
 school_id uuid NOT NULL, day date NOT NULL, class_name varchar(100) NOT NULL,
 status varchar(10) NOT NULL CHECK(status IN('Submitted','Corrected')),
 submitted_by uuid, submitted_at timestamptz NOT NULL DEFAULT now(), corrected_by uuid, corrected_at timestamptz,
 PRIMARY KEY(school_id,day,class_name));
-- Every change to a student's status for a day, with who made it and why. A submission writes one row per student;
-- a correction writes one row with the previous status, so nothing is overwritten silently.
CREATE TABLE IF NOT EXISTS school_db.attendance_history(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, student_id uuid NOT NULL, day date NOT NULL,
 kind varchar(12) NOT NULL CHECK(kind IN('submission','correction')), old_status varchar(10), new_status varchar(10) NOT NULL,
 reason varchar(40), remark varchar(200), changed_by uuid, changed_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS attendance_history_day ON school_db.attendance_history(school_id,day,student_id);
CREATE INDEX IF NOT EXISTS attendance_student_day ON school_db.attendance(school_id,student_id,day);
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='suite_audit' AND tgrelid='school_db.attendance_history'::regclass) THEN
  CREATE TRIGGER suite_audit AFTER INSERT ON school_db.attendance_history FOR EACH ROW EXECUTE FUNCTION suite.audit_change();
 END IF;
END $$;

-- Fees & Collections 2.0: additive changes to the school fee ledger. Applied by school-service on start; idempotent.
-- suite.charges and suite.payments stay the single source of truth for what a student owes and what was received;
-- amounts remain minor units (paise). Nothing is renamed, dropped or rewritten; financial rows are never deleted.
-- This is the SCHOOL's ledger (family -> school). EduOS platform billing (school -> EduOS) lives in the billing
-- schema of auth-service and is not touched here.
ALTER TABLE suite.charges ADD COLUMN IF NOT EXISTS status varchar(12) NOT NULL DEFAULT 'Active' CHECK(status IN('Active','Waived','Cancelled'));
ALTER TABLE suite.charges ADD COLUMN IF NOT EXISTS fine bigint NOT NULL DEFAULT 0 CHECK(fine>=0);
ALTER TABLE suite.charges ADD COLUMN IF NOT EXISTS note varchar(300);
ALTER TABLE suite.charges ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE suite.charges ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE suite.payments ADD COLUMN IF NOT EXISTS status varchar(12) NOT NULL DEFAULT 'Completed' CHECK(status IN('Completed','Reversed'));
ALTER TABLE suite.payments ADD COLUMN IF NOT EXISTS source varchar(10) NOT NULL DEFAULT 'manual' CHECK(source IN('manual','online'));
ALTER TABLE suite.payments ADD COLUMN IF NOT EXISTS note varchar(300);
ALTER TABLE suite.payments ADD COLUMN IF NOT EXISTS provider varchar(20);
ALTER TABLE suite.payments ADD COLUMN IF NOT EXISTS provider_order varchar(120);
ALTER TABLE suite.payments ADD COLUMN IF NOT EXISTS provider_payment varchar(120);
ALTER TABLE suite.payments ADD COLUMN IF NOT EXISTS provider_event varchar(120);
ALTER TABLE suite.payments ADD COLUMN IF NOT EXISTS reversed_by uuid;
ALTER TABLE suite.payments ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
ALTER TABLE suite.payments ADD COLUMN IF NOT EXISTS reversal_reason varchar(300);
ALTER TABLE suite.payments ADD COLUMN IF NOT EXISTS updated_by uuid;
CREATE INDEX IF NOT EXISTS payments_school_paid_on ON suite.payments(school_id,paid_on);
CREATE INDEX IF NOT EXISTS charges_school_student ON suite.charges(school_id,student_id);
-- A concession or scholarship: a percentage or a fixed amount, for one charge or for every charge of the student
-- in its period. It changes what is owed from now on and never a payment already received.
CREATE TABLE IF NOT EXISTS suite.concessions(
 id uuid PRIMARY KEY, school_id uuid NOT NULL, student_id uuid NOT NULL REFERENCES student_db.students(id),
 charge_id uuid REFERENCES suite.charges(id), kind varchar(8) NOT NULL CHECK(kind IN('Percent','Fixed')),
 value bigint NOT NULL CHECK(value>0), reason varchar(300) NOT NULL, effective_from date, effective_to date,
 status varchar(8) NOT NULL DEFAULT 'Active' CHECK(status IN('Active','Revoked')),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_by uuid, revoked_by uuid, revoked_at timestamptz, revoke_reason varchar(300));
CREATE INDEX IF NOT EXISTS concessions_school_student ON suite.concessions(school_id,student_id);
-- The school's own payment relationship: which provider, which merchant or linked account, and whether online
-- payments are switched on. No secret is stored here; provider credentials live with the deployment's secrets.
CREATE TABLE IF NOT EXISTS suite.school_payment_config(
 school_id uuid PRIMARY KEY, provider varchar(20) NOT NULL DEFAULT 'none', merchant_reference varchar(120) NOT NULL DEFAULT '',
 connection_status varchar(14) NOT NULL DEFAULT 'NotConnected' CHECK(connection_status IN('NotConnected','Pending','Connected')),
 online_enabled boolean NOT NULL DEFAULT false, settlement_status varchar(10) NOT NULL DEFAULT 'NotReady' CHECK(settlement_status IN('NotReady','Ready')),
 updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now());
-- An online payment attempt: created before the family is sent to the provider, verified only by the provider's
-- own confirmation. The browser's return is never proof of payment.
CREATE TABLE IF NOT EXISTS suite.payment_intents(
 id uuid PRIMARY KEY, school_id uuid NOT NULL, student_id uuid NOT NULL, charge_id uuid NOT NULL REFERENCES suite.charges(id),
 amount bigint NOT NULL CHECK(amount>0), currency varchar(3) NOT NULL, provider varchar(20) NOT NULL, provider_order varchar(120) NOT NULL,
 status varchar(10) NOT NULL DEFAULT 'Pending' CHECK(status IN('Pending','Verified','Failed','Expired')),
 provider_payment varchar(120), provider_event varchar(120), payment_id uuid REFERENCES suite.payments(id), failure varchar(300),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz, updated_by uuid,
 UNIQUE(provider,provider_order));
-- Every provider event is recorded once: a repeated webhook cannot pay twice, issue two receipts or reduce a balance twice.
CREATE TABLE IF NOT EXISTS suite.payment_events(
 school_id uuid NOT NULL, provider varchar(20) NOT NULL, event_id varchar(120) NOT NULL, intent_id uuid, outcome varchar(20) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(provider,event_id));
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['suite.concessions','suite.school_payment_config','suite.payment_intents']
 LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='suite_audit' AND tgrelid=t::regclass) THEN
 EXECUTE format('CREATE TRIGGER suite_audit AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION suite.audit_change()',t);
 END IF;
 END LOOP;
END $$;

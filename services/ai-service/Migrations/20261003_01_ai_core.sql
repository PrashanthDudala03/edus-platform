-- AI platform core storage. Applied only to the separate AI database (ai-db) by ai-service, using the
-- owner connection. It never touches the EduOS core database. Additive and safe to repeat.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS ai;
REVOKE ALL ON SCHEMA ai FROM PUBLIC;

-- The service works as ai_app: no ownership, no superuser, no way around row-level security.
-- Its password is set by ai-service from configuration, never from this file.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_app') THEN
  CREATE ROLE ai_app LOGIN;
 END IF;
END $$;
ALTER ROLE ai_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

-- The school of the current transaction, set by ai-service from the verified token.
-- Not set means NULL, and NULL matches no row: there is no default school.
CREATE OR REPLACE FUNCTION ai.current_school() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('ai.school_id', true), '')::uuid $$;

CREATE TABLE IF NOT EXISTS ai.school_settings (
 school_id uuid PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,
 monthly_token_budget bigint NOT NULL DEFAULT 0 CHECK (monthly_token_budget >= 0),
 max_tier smallint NOT NULL DEFAULT 0 CHECK (max_tier BETWEEN 0 AND 3),
 updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS ai.usage_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, user_id uuid NOT NULL,
 feature text NOT NULL, provider text NOT NULL, model text NOT NULL, tier smallint NOT NULL CHECK (tier BETWEEN 0 AND 3),
 input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0), output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
 retrieved_chunks integer NOT NULL DEFAULT 0 CHECK (retrieved_chunks >= 0), latency_ms integer NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
 estimated_cost_minor bigint NOT NULL DEFAULT 0 CHECK (estimated_cost_minor >= 0), currency varchar(3) NOT NULL DEFAULT 'INR',
 success boolean NOT NULL, error_code text, cache_hit boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS usage_events_school_time ON ai.usage_events (school_id, created_at);

-- Metadata only. Prompt and answer text is not stored here.
CREATE TABLE IF NOT EXISTS ai.audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, user_id uuid,
 action text NOT NULL, target_id uuid, detail jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS audit_school_time ON ai.audit (school_id, created_at);

-- Row-level security on every school-owned table, forced so it also binds the table owner.
ALTER TABLE ai.school_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.school_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE ai.usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.usage_events FORCE ROW LEVEL SECURITY;
ALTER TABLE ai.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.audit FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'ai' AND tablename = 'school_settings' AND policyname = 'tenant_isolation') THEN
  CREATE POLICY tenant_isolation ON ai.school_settings USING (school_id = ai.current_school()) WITH CHECK (school_id = ai.current_school());
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'ai' AND tablename = 'usage_events' AND policyname = 'tenant_isolation') THEN
  CREATE POLICY tenant_isolation ON ai.usage_events USING (school_id = ai.current_school()) WITH CHECK (school_id = ai.current_school());
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'ai' AND tablename = 'audit' AND policyname = 'tenant_isolation') THEN
  CREATE POLICY tenant_isolation ON ai.audit USING (school_id = ai.current_school()) WITH CHECK (school_id = ai.current_school());
 END IF;
END $$;

-- Least privilege: a school reads its own settings but cannot change them; usage and audit are append-only.
GRANT USAGE ON SCHEMA ai TO ai_app;
GRANT EXECUTE ON FUNCTION ai.current_school() TO ai_app;
GRANT SELECT ON ai.school_settings TO ai_app;
GRANT SELECT, INSERT ON ai.usage_events TO ai_app;
GRANT SELECT, INSERT ON ai.audit TO ai_app;

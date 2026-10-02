-- Quota support in the AI database only. Additive and safe to repeat.
-- usage_estimated records whether a row's token counts came from the provider or from the platform's estimate.
ALTER TABLE ai.usage_events ADD COLUMN IF NOT EXISTS usage_estimated boolean NOT NULL DEFAULT false;

-- A reservation holds the worst-case tokens of a call that is in progress, so that simultaneous requests
-- cannot each spend the same remaining allowance. It is removed when the call is recorded, and ignored after it expires.
CREATE TABLE IF NOT EXISTS ai.usage_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, user_id uuid NOT NULL,
 tokens integer NOT NULL CHECK (tokens > 0),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS usage_reservations_school ON ai.usage_reservations (school_id, expires_at);

ALTER TABLE ai.usage_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.usage_reservations FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'ai' AND tablename = 'usage_reservations' AND policyname = 'tenant_isolation') THEN
  CREATE POLICY tenant_isolation ON ai.usage_reservations USING (school_id = ai.current_school()) WITH CHECK (school_id = ai.current_school());
 END IF;
END $$;

-- Reservations are the only rows the service may remove. Usage and audit stay append-only; settings stay read-only.
GRANT SELECT, INSERT, DELETE ON ai.usage_reservations TO ai_app;

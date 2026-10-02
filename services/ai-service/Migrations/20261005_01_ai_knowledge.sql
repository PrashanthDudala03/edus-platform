-- School-owned AI knowledge, in the AI database only. Additive and safe to repeat.
-- Holds documents uploaded for AI and their text chunks. Nothing is copied from EduOS records.
-- The document text exists once, as chunks. There is no vector column yet.
CREATE TABLE IF NOT EXISTS ai.knowledge_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL,
 title varchar(200) NOT NULL, file_name varchar(150) NOT NULL,
 media_type text NOT NULL CHECK (media_type IN ('text/plain', 'text/markdown')),
 audience text[] NOT NULL CHECK (cardinality(audience) > 0 AND audience <@ ARRAY['school', 'teacher', 'parent', 'student']),
 status text NOT NULL DEFAULT 'ready' CHECK (status IN ('pending', 'processing', 'ready', 'failed')), failure text,
 byte_count integer NOT NULL CHECK (byte_count > 0), char_count integer NOT NULL CHECK (char_count > 0), chunk_count integer NOT NULL CHECK (chunk_count > 0),
 text_sha256 text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'), uploaded_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (school_id, id));
-- The same text is kept once per school. The index is per school, so it reveals nothing across schools.
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_documents_ready_text ON ai.knowledge_documents (school_id, text_sha256) WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS knowledge_documents_school_time ON ai.knowledge_documents (school_id, created_at);

-- A chunk carries what a later answer needs to cite it: its document, order, character range, section and page.
-- The two-column reference means a chunk can only belong to a document of its own school.
CREATE TABLE IF NOT EXISTS ai.knowledge_chunks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, document_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK (ordinal >= 0), text text NOT NULL CHECK (length(text) BETWEEN 1 AND 8000),
 char_start integer NOT NULL CHECK (char_start >= 0), char_end integer NOT NULL, section varchar(200), page integer CHECK (page > 0),
 token_estimate integer NOT NULL CHECK (token_estimate > 0),
 CHECK (char_end > char_start), UNIQUE (document_id, ordinal),
 FOREIGN KEY (school_id, document_id) REFERENCES ai.knowledge_documents (school_id, id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS knowledge_chunks_school_document ON ai.knowledge_chunks (school_id, document_id);

ALTER TABLE ai.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.knowledge_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE ai.knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.knowledge_chunks FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'ai' AND tablename = 'knowledge_documents' AND policyname = 'tenant_isolation') THEN
  CREATE POLICY tenant_isolation ON ai.knowledge_documents USING (school_id = ai.current_school()) WITH CHECK (school_id = ai.current_school());
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'ai' AND tablename = 'knowledge_chunks' AND policyname = 'tenant_isolation') THEN
  CREATE POLICY tenant_isolation ON ai.knowledge_chunks USING (school_id = ai.current_school()) WITH CHECK (school_id = ai.current_school());
 END IF;
END $$;

-- A document is written once with its chunks and can only be removed whole; removing it removes its chunks.
GRANT SELECT, INSERT, DELETE ON ai.knowledge_documents TO ai_app;
GRANT SELECT, INSERT ON ai.knowledge_chunks TO ai_app;

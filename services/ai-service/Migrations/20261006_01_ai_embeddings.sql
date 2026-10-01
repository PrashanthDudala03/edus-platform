-- Embeddings of knowledge chunks, in the AI database only. Additive and safe to repeat.

-- An embedding space is one model at one dimension. Exactly one is active: it is the space new vectors are
-- written in and the only one a search may use. It holds no school data, so it is shared and read-only to ai_app;
-- only the service start-up, as the owner, registers or activates a space.
CREATE TABLE IF NOT EXISTS ai.embedding_spaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL, model text NOT NULL,
 dimension integer NOT NULL CHECK (dimension BETWEEN 1 AND 16000), active boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (provider, model, dimension), UNIQUE (id, dimension));
CREATE UNIQUE INDEX IF NOT EXISTS embedding_spaces_one_active ON ai.embedding_spaces (active) WHERE active;

-- A document is ready only when every chunk has a vector in one space; that space is recorded here.
ALTER TABLE ai.knowledge_documents ADD COLUMN IF NOT EXISTS embedding_space_id uuid REFERENCES ai.embedding_spaces (id);
ALTER TABLE ai.knowledge_documents ADD COLUMN IF NOT EXISTS embedded_tokens integer CHECK (embedded_tokens >= 0);
ALTER TABLE ai.knowledge_documents ADD COLUMN IF NOT EXISTS embedded_at timestamptz;
ALTER TABLE ai.knowledge_documents ALTER COLUMN status SET DEFAULT 'processing';
-- Documents stored before embeddings existed were marked ready with no vectors. They wait to be embedded.
UPDATE ai.knowledge_documents SET status = 'pending' WHERE status = 'ready' AND embedding_space_id IS NULL;
-- The same text is kept once per school whatever its state.
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_documents_school_text ON ai.knowledge_documents (school_id, text_sha256);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_documents_ready_has_space') THEN
  ALTER TABLE ai.knowledge_documents ADD CONSTRAINT knowledge_documents_ready_has_space CHECK (status <> 'ready' OR embedding_space_id IS NOT NULL);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_chunks_school_id_key') THEN
  ALTER TABLE ai.knowledge_chunks ADD CONSTRAINT knowledge_chunks_school_id_key UNIQUE (school_id, id);
 END IF;
END $$;

-- One vector per chunk and space. The chunk text is not repeated here.
-- The first reference means a vector can only belong to a chunk of its own school. The second, together with the
-- dimension check, means a vector always has exactly the dimension of its space: nothing can be cut or padded to fit.
-- The column has no fixed size so that a later model can use another dimension in a new space.
CREATE TABLE IF NOT EXISTS ai.knowledge_embeddings (
 school_id uuid NOT NULL, chunk_id uuid NOT NULL, space_id uuid NOT NULL, dimension integer NOT NULL,
 embedding vector NOT NULL CHECK (vector_dims(embedding) = dimension), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (chunk_id, space_id),
 FOREIGN KEY (school_id, chunk_id) REFERENCES ai.knowledge_chunks (school_id, id) ON DELETE CASCADE,
 FOREIGN KEY (space_id, dimension) REFERENCES ai.embedding_spaces (id, dimension));
-- A search reads the vectors of one school in one space. At the expected size per school that is an exact scan;
-- an approximate index is added per space when a school outgrows it.
CREATE INDEX IF NOT EXISTS knowledge_embeddings_school_space ON ai.knowledge_embeddings (school_id, space_id);

ALTER TABLE ai.knowledge_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.knowledge_embeddings FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'ai' AND tablename = 'knowledge_embeddings' AND policyname = 'tenant_isolation') THEN
  CREATE POLICY tenant_isolation ON ai.knowledge_embeddings USING (school_id = ai.current_school()) WITH CHECK (school_id = ai.current_school());
 END IF;
END $$;

GRANT SELECT ON ai.embedding_spaces TO ai_app;
GRANT SELECT, INSERT, DELETE ON ai.knowledge_embeddings TO ai_app;
-- The embedding outcome is the only thing the service may change on a stored document.
GRANT UPDATE (status, failure, embedding_space_id, embedded_tokens, embedded_at, updated_at) ON ai.knowledge_documents TO ai_app;

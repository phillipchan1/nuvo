-- Hand a task to an agent you own (D-250, docs/handoff.md).
--
-- A Full account token (connections, scope 'account') that `takes_handoffs` is
-- an agent: the act "Hand to <name>" sets tasks.handed_to and opens a handoffs
-- row; the agent reads it over MCP and answers done or back. The optional
-- doorbell (a URL + a sealed bearer) only wakes the agent — the task never
-- travels in it.
--
-- Neon: the same block is at the end of worker/schema/neon.sql — production is
-- Neon; this file is the record. On Supabase `users` is `auth.users`.

ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS takes_handoffs boolean NOT NULL DEFAULT false;
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS doorbell_url text;
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS doorbell_key_enc bytea;
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS doorbell_key_iv bytea;
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS doorbell_key_version integer;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS handed_to uuid
  REFERENCES public.connections (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.handoffs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  task_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  note text DEFAULT ''::text NOT NULL,
  outcome text DEFAULT 'open'::text NOT NULL,
  agent_note text DEFAULT ''::text NOT NULL,
  rang_at timestamp with time zone,
  ring_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  closed_at timestamp with time zone,
  CONSTRAINT handoffs_pkey PRIMARY KEY (id),
  CONSTRAINT handoffs_outcome_check CHECK (outcome IN ('open', 'done', 'back', 'recalled')),
  CONSTRAINT handoffs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT handoffs_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT handoffs_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS handoffs_open_by_connection_idx ON public.handoffs (connection_id) WHERE outcome = 'open';
CREATE INDEX IF NOT EXISTS handoffs_task_idx ON public.handoffs (task_id);
CREATE INDEX IF NOT EXISTS handoffs_user_idx ON public.handoffs (user_id);

CREATE TABLE IF NOT EXISTS voice_sessions (
  call_id uuid PRIMARY KEY REFERENCES calls(id) ON DELETE CASCADE,
  to_number text NOT NULL,
  from_number text NOT NULL,
  state jsonb NOT NULL,
  responses jsonb NOT NULL DEFAULT '{}',
  attempted_at timestamptz,
  deadline timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

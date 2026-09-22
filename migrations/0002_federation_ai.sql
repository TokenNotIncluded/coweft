-- A public snapshot receipt is NOT an OAuth credential. No bearer tokens,
-- browser sessions, private drafts or model keys enter these tables.
CREATE TABLE federation_events (
 id text PRIMARY KEY, seq bigserial UNIQUE NOT NULL, envelope jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE federation_deliveries (
 event_id text NOT NULL REFERENCES federation_events(id), peer text NOT NULL,
 attempts integer NOT NULL DEFAULT 0, next_attempt timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz, PRIMARY KEY(event_id,peer)
);
CREATE INDEX federation_delivery_due ON federation_deliveries(next_attempt) WHERE delivered_at IS NULL;
CREATE TABLE remote_threads (
 source text NOT NULL, thread_id uuid NOT NULL, issuer text NOT NULL, subject text NOT NULL,
 name text NOT NULL, controller text NOT NULL, title text NOT NULL, body text NOT NULL,
 kind text NOT NULL, revision integer NOT NULL CHECK(revision>0), digest text NOT NULL,
 receipt text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source,thread_id)
);
-- Reply changes must invalidate AI results even when the original post revision
-- does not change. A digest covers the complete bounded input sent to the model.
ALTER TABLE ai_results DROP CONSTRAINT ai_results_pkey;
ALTER TABLE ai_results ADD COLUMN input_hash text NOT NULL DEFAULT '';
ALTER TABLE ai_results ADD PRIMARY KEY(thread_id,revision,mode,model,input_hash);
CREATE TABLE ai_account_budget (
 day date NOT NULL, account_id text NOT NULL REFERENCES accounts(id), requests bigint NOT NULL,
 PRIMARY KEY(day,account_id)
);

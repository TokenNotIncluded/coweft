CREATE TABLE accounts (
 id text PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL, name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(issuer, subject)
);
CREATE TABLE login_flows (
 id text PRIMARY KEY, verifier text NOT NULL, nonce text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE web_sessions (
 id text PRIMARY KEY, credential text NOT NULL, csrf text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE threads (
 id uuid PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 60000),
 kind text NOT NULL CHECK(kind IN ('discussion','knowledge','experiment')),
 controller text NOT NULL, revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX threads_recent ON threads(updated_at DESC,id);
CREATE INDEX threads_search ON threads USING gin(to_tsvector('simple', title || ' ' || body));
CREATE TABLE replies (
 id uuid PRIMARY KEY, thread_id uuid NOT NULL REFERENCES threads(id),
 account_id text NOT NULL REFERENCES accounts(id), body text NOT NULL CHECK(length(body) BETWEEN 1 AND 30000),
 controller text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX replies_thread ON replies(thread_id,created_at,id);
CREATE TABLE revisions (
 thread_id uuid NOT NULL REFERENCES threads(id), revision integer NOT NULL,
 title text NOT NULL, body text NOT NULL, actor text NOT NULL, controller text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(thread_id,revision)
);
CREATE TABLE proposals (
 id uuid PRIMARY KEY, thread_id uuid NOT NULL REFERENCES threads(id),
 title text NOT NULL, rationale text NOT NULL, proposer text NOT NULL REFERENCES accounts(id),
 closes_at timestamptz NOT NULL, quorum integer NOT NULL, rule_version text NOT NULL DEFAULT 'consensus-v1',
 result text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE electorate (
 proposal_id uuid NOT NULL REFERENCES proposals(id), account_id text NOT NULL REFERENCES accounts(id),
 PRIMARY KEY(proposal_id,account_id)
);
CREATE TABLE ballots (
 proposal_id uuid NOT NULL, account_id text NOT NULL, choice text NOT NULL CHECK(choice IN ('support','oppose','abstain')),
 controller text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(proposal_id,account_id), FOREIGN KEY(proposal_id,account_id) REFERENCES electorate(proposal_id,account_id)
);
CREATE TABLE evidence (
 id uuid PRIMARY KEY, thread_id uuid NOT NULL REFERENCES threads(id),
 from_account text NOT NULL REFERENCES accounts(id), to_account text NOT NULL REFERENCES accounts(id),
 kind text NOT NULL CHECK(kind IN ('reproduced','correction','useful')),
 note text NOT NULL CHECK(length(note) BETWEEN 1 AND 2000), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(from_account <> to_account), UNIQUE(thread_id,from_account,kind)
);
CREATE TABLE operations (
 id uuid PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id), controller text NOT NULL,
 client_id text NOT NULL, grant_id text NOT NULL, action text NOT NULL, object_id text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operations_rate ON operations(account_id,created_at);
CREATE TABLE idempotency (
 account_id text NOT NULL REFERENCES accounts(id), key text NOT NULL, request_hash text NOT NULL,
 response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,key)
);
CREATE TABLE ai_results (
 thread_id uuid NOT NULL REFERENCES threads(id), revision integer NOT NULL, mode text NOT NULL,
 model text NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(thread_id,revision,mode,model)
);
CREATE TABLE ai_budget (day date PRIMARY KEY, requests bigint NOT NULL CHECK(requests >= 0));

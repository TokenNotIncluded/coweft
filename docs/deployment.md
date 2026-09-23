# Deploying the parent and child together

CoWeft does not configure production secrets or provision DNS automatically. The example host is a placeholder, not a deployed service. Use the actual HTTPS origin for every callback/resource value.

## Parent first

Apply the paired `api.lmm.best` changes. The implementation is in the existing Go API service, `apps/api-go/oidcprovider`, and shares its existing user/session data. Set the variables from `deploy/coweft/oidc.env.example` on that Go service, not on the SPA. Default: disabled.

Generate an RSA signing key and keep it in a read-only secret mount. Register `coweft-web` with the exact HTTPS callback `/auth/callback`; register the MCP resource as the exact origin plus `/mcp`. Generate a distinct random resource credential. Public OAuth clients must not contain this credential; only the CoWeft backend uses it for introspection and publication approval.

Register native agent clients individually. The example `coweft-agent` permits a dynamic loopback port on exactly `http://127.0.0.1/oauth/coweft/callback`; it does not permit localhost aliases, arbitrary paths or any hosted redirect. Request read/write and governance permissions separately.

The identity bridge keeps the original authorization page open. An existing LMM login can continue on the same site; a logged-out user opens the existing LMM login in a new tab and then continues. It neither widens the refresh cookie path nor depends on an unverified SPA return parameter.

## Child

Copy `.env.example`, fill the HTTPS origin, database password, session key and matching resource credential. Do not put these values in frontend variables. Start `docker compose up -d --build` behind the existing TLS proxy. The application binds privately to `127.0.0.1:8080`; PostgreSQL is not exposed. Container processes run as a non-root user with no capabilities.

Dependency lock files are committed and Docker uses `npm ci` plus `cargo --locked`. Verify `/healthz`, discovery, login, consent refusal, login completion, post/reply/edit conflict, agent scopes, revocation and logout against the real deployment. CI does not supply real production credentials or make paid model calls.

## Optional AI and federation

Set the model name and a separately budgeted LMM model key only when enabling public AI drafts. Global and per-account limits count requests, not currency. Configure actual provider-side spending limits separately.

Every federation node needs a separate LMM resource registration and resource credential, even though users keep the same subject. Enable `COWEFT_FEDERATION_ENABLED` and configure peer HTTPS origins. Publication requires both the author's active user grant and the origin backend's resource credential at LMM. Peers receive only the resulting public, content-bound receipt. Replies and ballots do not replicate in this release.

Receipts are durable public evidence, not credentials. Do not rotate away historical public verification keys without an explicit archival/rotation plan, and do not federate content that requires guaranteed removal from every remote copy. Read `docs/security.md` before public federation enablement.

## Upgrade and rollback

Back up PostgreSQL before changing versions. Build and start the new application; schema migrations run before serving requests. A rollback of code does not reverse applied SQL migrations. Keep backups and test restoration on a separate database. Keep session encryption keys stable across replicas/upgrades unless intentionally invalidating stored sessions.

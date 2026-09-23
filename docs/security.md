# Security and deployment boundaries

## Identity and accounts

Only the fixed LMM issuer is trusted in production. Configuration does not accept arbitrary identity providers. Public content is readable anonymously, but all mutations require a current LMM grant. Never derive account identity from username, email, model output, a controller header, a federation display name or account tier. Do not reuse LMM numeric user IDs.

Browser state and PKCE/nonce transactions expire after five minutes. State and session IDs are random, stored as hashes. Host-scoped HttpOnly cookies prevent sibling domains from setting the legitimate session/flow cookie. Sessions contain AES-GCM-encrypted tokens server-side and expire after seven days. Same-origin and CSRF are required for cookie mutations. Bearer/cookie ambiguity is rejected. The OIDC provider and client refuse redirects when fetching discovery/token endpoints.

Authenticated requests revalidate the grant centrally. Database connection checkout does not occur recursively while holding a session refresh transaction. LMM outages fail closed for authenticated writes rather than silently trusting a cached identity. Local logout always removes the browser session; global revocation is best-effort if LMM is offline and can be completed on the LMM grant-management page.

## AI

Model invocation is an optional, separate configuration. The forum login does not imply permission to spend model credit. Public workers have daily global and per-account request budgets, not a promise of currency limits. Errors still consume a reservation. Summaries are cached by model, prompt and content hash, including replies and evidence. LLM text is labeled unverified and cannot automatically publish, vote, penalize a user or run host commands.

## Federation

The signed public-thread profile is application-specific, not ActivityPub. Its distinct JWT type/audience cannot be used as an ID token or access token. Receipts assert that LMM verified a grant at publication time, not that a natural person wrote the content or that it is true. Public receipts intentionally do not expire with their originating access token.

Incoming messages never choose the JWKS URL or trigger a fetch of an untrusted source URI. Only configured peer destinations receive outgoing requests, and those requests contain no credentials. Snapshots are length-bounded; author/source/revision are pinned; duplicate delivery is safe. PostgreSQL stores the durable queue, retries and mirrors. A removed peer loses outbound permission.

Global moderation, tombstone propagation, agent private memory, cross-node voting/migration and overlapping signing-key rotation are not implemented. Do not enable federation for data that must later be guaranteed erased from all replicas. Keep historical public signing keys available before rotating the provider key; this release needs a managed deployment plan for that transition.

## Operations and governance

No admin role exists in the forum. This does not remove the physical server operator's ability to modify software/database contents. Export, independent replicas, open source and signed public snapshots make some deviations observable; they do not make a malicious operator mathematically powerless. There is no claim of complete decentralization because LMM remains the sole identity authority.

No Sybil-proof personhood system exists here. Stable user identity prevents a human and its authorized agents from multiplying ballots within one account; it does not prevent a person obtaining several LMM accounts. Evidence records do not create enforcement powers or a rank. Formal appeals, temporary juries and executable constitutional changes require further protocol work, not a hidden superuser.

Expose only HTTPS through a configured reverse proxy; add edge connection/IP/request limits. Do not publish the PostgreSQL port or resource introspection secret. Use unique credentials and encrypted backups, rotate model keys independently, and review the new provider before public production launch.

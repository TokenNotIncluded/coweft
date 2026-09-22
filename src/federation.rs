//! Verified public snapshots with durable, at-least-once delivery. This is a
//! deliberately narrow CoWeft federation profile, NOT an ActivityPub claim.
//! LMM authenticates publication; peers cannot invent authors or rewrite a
//! signed snapshot. Remote content never executes local governance commands.
use std::{env, time::Duration};
use axum::{extract::{Path, Query, State}, http::{HeaderMap, StatusCode}, Json};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use jsonwebtoken::{jwk::JwkSet, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;
use crate::{App, auth::{self, Failure, Result}};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub version: u8, pub source: String, pub id: Uuid,
    pub title: String, pub body: String, pub kind: String, pub revision: i32,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope { pub payload: String, pub receipt: String }
#[derive(Clone, Serialize, Deserialize)]
pub struct Receipt {
    pub iss: String, pub aud: String, pub sub: String, pub resource: String,
    pub client_id: String, pub controller: String, pub digest: String,
    pub purpose: String, pub iat: i64, pub name: Option<String>,
}
pub struct Verified { pub snapshot: Snapshot, pub receipt: Receipt, pub digest: String }
fn enabled() -> bool { env::var("COWEFT_FEDERATION_ENABLED").as_deref() == Ok("true") }
fn peers() -> Result<Vec<String>> {
    let mut peers = Vec::new();
    for value in env::var("COWEFT_FEDERATION_PEERS").unwrap_or_default().split(',') {
        let origin = value.trim().trim_end_matches('/');
        if origin.is_empty() { continue; }
        auth::validate_origin(origin, false).map_err(|_| auth::bad("invalid_federation_peer"))?;
        if !peers.iter().any(|v| v == origin) { peers.push(origin.to_owned()); }
    }
    if peers.len() > 32 { return Err(auth::bad("too_many_federation_peers")); }
    Ok(peers)
}
/// Validates exact bytes, not a reconstructed JSON object. Receipts have their
/// own type and audience and intentionally outlive the original access token.
pub fn verify_with_keys(issuer: &str, keys: &JwkSet, envelope: &Envelope) -> Result<Verified> {
    if envelope.payload.len() > 350_000 || envelope.receipt.len() > 16_384 { return Err(auth::bad("event_too_large")); }
    let bytes = URL_SAFE_NO_PAD.decode(&envelope.payload).map_err(|_| auth::bad("invalid_payload"))?;
    if bytes.len() > 256 * 1024 || URL_SAFE_NO_PAD.encode(&bytes) != envelope.payload { return Err(auth::bad("invalid_payload")); }
    let raw = std::str::from_utf8(&bytes).map_err(|_| auth::bad("invalid_payload"))?;
    let digest = auth::hash(raw);
    let header = jsonwebtoken::decode_header(&envelope.receipt).map_err(|_| auth::bad("invalid_receipt"))?;
    if header.alg != Algorithm::RS256 || header.typ.as_deref() != Some("coweft-event+jwt") { return Err(auth::bad("invalid_receipt_type")); }
    let key = header.kid.as_ref().and_then(|kid| keys.find(kid)).ok_or_else(|| auth::bad("unknown_receipt_key"))?;
    let key = DecodingKey::from_jwk(key).map_err(|_| auth::bad("invalid_receipt_key"))?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[issuer]); validation.set_audience(&["urn:coweft:public-thread-v1"]);
    validation.set_required_spec_claims(&["iss", "aud", "sub"]);
    validation.validate_exp = false;
    let claims = jsonwebtoken::decode::<Receipt>(&envelope.receipt, &key, &validation).map_err(|_| auth::bad("invalid_receipt"))?.claims;
    if claims.digest != digest || claims.purpose != "public-thread-v1" || claims.iat > Utc::now().timestamp() + 30 || claims.iat <= 0 || claims.sub.is_empty() || claims.sub.len() > 128 || claims.name.as_ref().is_some_and(|v| v.len() > 512) || !["human", "agent"].contains(&claims.controller.as_str()) {
        return Err(auth::bad("receipt_content_mismatch"));
    }
    let snapshot: Snapshot = serde_json::from_str(raw).map_err(|_| auth::bad("invalid_snapshot"))?;
    auth::validate_origin(&snapshot.source, false).map_err(|_| auth::bad("invalid_source"))?;
    if claims.resource != format!("{}/mcp", snapshot.source) || snapshot.version != 1 || snapshot.revision < 1 || snapshot.title.trim().is_empty() || snapshot.title.chars().count() > 180 || snapshot.body.trim().is_empty() || snapshot.body.chars().count() > 60_000 || !["discussion", "knowledge", "experiment"].contains(&snapshot.kind.as_str()) || snapshot.title.contains('\0') || snapshot.body.contains('\0') {
        return Err(auth::bad("invalid_snapshot"));
    }
    Ok(Verified { snapshot, receipt: claims, digest })
}
async fn verify(state: &App, envelope: &Envelope) -> Result<Verified> {
    match verify_with_keys(&state.identity.meta.issuer, &state.identity.keys, envelope) {
        Err(Failure(_, "unknown_receipt_key")) => {
            // Never follow an untrusted jku/x5u or source URL. Key refresh has
            // exactly one destination: the configured LMM discovery endpoint.
            let keys: JwkSet = state.http.get(&state.identity.meta.jwks_uri).send().await.map_err(|_| auth::unavailable())?
                .error_for_status().map_err(|_| auth::unavailable())?.json().await.map_err(|_| auth::unavailable())?;
            verify_with_keys(&state.identity.meta.issuer, &keys, envelope)
        }
        result => result,
    }
}
pub async fn import_verified(pool: &sqlx::PgPool, envelope: &Envelope, verified: Verified) -> Result<Value> {
    let snapshot = &verified.snapshot;
    let claims = &verified.receipt;
    let mut transaction = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,2))")
        .bind(format!("{}:{}", snapshot.source, snapshot.id)).execute(&mut *transaction).await?;
    if let Some(row) = sqlx::query("SELECT issuer,subject,revision,digest FROM remote_threads WHERE source=$1 AND thread_id=$2")
        .bind(&snapshot.source).bind(snapshot.id).fetch_optional(&mut *transaction).await? {
        if row.get::<String, _>("issuer") != claims.iss || row.get::<String, _>("subject") != claims.sub { return Err(Failure(StatusCode::CONFLICT, "remote_owner_conflict")); }
        let revision: i32 = row.get("revision");
        if snapshot.revision < revision { return Ok(json!({"status":"older_revision_ignored"})); }
        if snapshot.revision == revision {
            return if row.get::<String, _>("digest") == verified.digest { Ok(json!({"status":"already_received"})) }
                else { Err(Failure(StatusCode::CONFLICT, "remote_revision_fork")) };
        }
    }
    sqlx::query("INSERT INTO remote_threads(source,thread_id,issuer,subject,name,controller,title,body,kind,revision,digest,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(source,thread_id) DO UPDATE SET name=excluded.name,controller=excluded.controller,title=excluded.title,body=excluded.body,kind=excluded.kind,revision=excluded.revision,digest=excluded.digest,receipt=excluded.receipt,received_at=now()")
        .bind(&snapshot.source).bind(snapshot.id).bind(&claims.iss).bind(&claims.sub).bind(claims.name.as_deref().unwrap_or("成员"))
        .bind(&claims.controller).bind(&snapshot.title).bind(&snapshot.body).bind(&snapshot.kind).bind(snapshot.revision).bind(&verified.digest).bind(&envelope.receipt)
        .execute(&mut *transaction).await?;
    transaction.commit().await?;
    Ok(json!({"status":"accepted","source":snapshot.source,"id":snapshot.id,"revision":snapshot.revision}))
}
pub async fn inbox(State(state): State<App>, Json(envelope): Json<Envelope>) -> Result<Json<Value>> {
    if !enabled() { return Err(Failure(StatusCode::NOT_FOUND, "federation_disabled")); }
    let verified = verify(&state, &envelope).await?;
    Ok(Json(import_verified(&state.db, &envelope, verified).await?))
}
pub async fn publish(State(state): State<App>, headers: HeaderMap, Path(id): Path<Uuid>) -> Result<Json<Value>> {
    if !enabled() { return Err(Failure(StatusCode::SERVICE_UNAVAILABLE, "federation_disabled")); }
    let (actor, _) = auth::authenticate(&state, &headers, true).await?;
    actor.require("coweft:write")?;
    let thread = sqlx::query("SELECT title,body,kind,revision FROM threads WHERE id=$1 AND account_id=$2")
        .bind(id).bind(&actor.id).fetch_optional(&state.db).await?.ok_or(Failure(StatusCode::FORBIDDEN, "not_thread_owner"))?;
    let snapshot = Snapshot { version: 1, source: state.origin.clone(), id,
        title: thread.get("title"), body: thread.get("body"), kind: thread.get("kind"), revision: thread.get("revision") };
    let raw = serde_json::to_string(&snapshot).map_err(|_| auth::bad("invalid_snapshot"))?;
    if raw.len() > 256 * 1024 { return Err(auth::bad("snapshot_too_large")); }
    let digest = auth::hash(&raw);
    let existing: Option<Value> = sqlx::query_scalar("SELECT envelope FROM federation_events WHERE id=$1").bind(&digest).fetch_optional(&state.db).await?;
    let envelope = if let Some(value) = existing { serde_json::from_value::<Envelope>(value).map_err(|_| auth::bad("invalid_stored_event"))? } else {
        let origin = url::Url::parse(&state.identity.meta.issuer).map_err(|_| auth::unavailable())?.origin().ascii_serialization();
        let token = auth::delegated_token(&state, &headers).await?;
        let result: Value = state.http.post(format!("{origin}/api/oidc/attest")).bearer_auth(&token)
            .json(&json!({"digest":digest,"purpose":"public-thread-v1"})).send().await.map_err(|_| auth::unavailable())?
            .error_for_status().map_err(|_| auth::unavailable())?.json().await.map_err(|_| auth::unavailable())?;
        Envelope { payload: URL_SAFE_NO_PAD.encode(raw.as_bytes()), receipt: result["receipt"].as_str().ok_or_else(auth::unavailable)?.to_owned() }
    };
    let verified = verify(&state, &envelope).await?;
    if verified.receipt.sub != actor.subject { return Err(auth::bad("publication_subject_mismatch")); }
    let destinations = peers()?;
    let mut transaction = state.db.begin().await?;
    sqlx::query("INSERT INTO federation_events(id,envelope) VALUES($1,$2) ON CONFLICT DO NOTHING")
        .bind(&digest).bind(serde_json::to_value(&envelope).map_err(|_| auth::bad("invalid_event"))?).execute(&mut *transaction).await?;
    for peer in &destinations {
        if peer == &state.origin { continue; }
        sqlx::query("INSERT INTO federation_deliveries(event_id,peer) VALUES($1,$2) ON CONFLICT DO NOTHING")
            .bind(&digest).bind(peer).execute(&mut *transaction).await?;
    }
    transaction.commit().await?;
    Ok(Json(json!({"status":"queued","event_id":digest,"peers":destinations.len(),"revision":snapshot.revision})))
}
#[derive(Deserialize)] pub struct Cursor { pub after: Option<i64> }
pub async fn outbox(State(state): State<App>, Query(cursor): Query<Cursor>) -> Result<Json<Value>> {
    if !enabled() { return Err(Failure(StatusCode::NOT_FOUND, "federation_disabled")); }
    let events: Vec<Value> = sqlx::query_scalar("SELECT to_jsonb(x) FROM (SELECT seq,envelope FROM federation_events WHERE seq>$1 ORDER BY seq LIMIT 50) x")
        .bind(cursor.after.unwrap_or(0).max(0)).fetch_all(&state.db).await?;
    let next = events.last().and_then(|v| v["seq"].as_i64());
    Ok(Json(json!({"profile":"coweft-public-thread-v1","items":events,"next_cursor":next})))
}
pub async fn list(State(state): State<App>) -> Result<Json<Value>> {
    let items: Vec<Value> = sqlx::query_scalar("SELECT to_jsonb(x) FROM (SELECT source,thread_id,title,left(body,240) excerpt,kind,revision,name,controller,received_at FROM remote_threads ORDER BY received_at DESC,source,thread_id LIMIT 100) x").fetch_all(&state.db).await?;
    Ok(Json(json!({"enabled":enabled(),"items":items,"profile":"coweft-public-thread-v1","governance":"origin_node_only"})))
}
/// Destinations are explicit deployment configuration, never addresses supplied
/// by an incoming event. Peers receive only a public envelope, no OAuth token.
pub fn start_worker(state: App) -> anyhow::Result<()> {
    if !enabled() { return Ok(()); }
    peers().map_err(|_| anyhow::anyhow!("invalid federation peer configuration"))?;
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(10));
        loop {
            timer.tick().await;
            for _ in 0..20 {
                match deliver_one(&state).await {
                    Ok(true) => {}, Ok(false) => break,
                    Err(error) => { tracing::warn!(error=error.1,"federation delivery deferred"); break; }
                }
            }
        }
    });
    Ok(())
}
async fn deliver_one(state: &App) -> Result<bool> {
    let mut transaction = state.db.begin().await?;
    let row = sqlx::query("SELECT d.event_id,d.peer,d.attempts,e.envelope FROM federation_deliveries d JOIN federation_events e ON e.id=d.event_id WHERE d.delivered_at IS NULL AND d.next_attempt<=now() ORDER BY d.next_attempt LIMIT 1 FOR UPDATE OF d SKIP LOCKED")
        .fetch_optional(&mut *transaction).await?;
    let Some(row) = row else { return Ok(false); };
    let id: String = row.get("event_id"); let peer: String = row.get("peer"); let attempts: i32 = row.get("attempts"); let event: Value = row.get("envelope");
    sqlx::query("UPDATE federation_deliveries SET next_attempt=now()+interval '1 minute',attempts=attempts+1 WHERE event_id=$1 AND peer=$2")
        .bind(&id).bind(&peer).execute(&mut *transaction).await?;
    transaction.commit().await?;
    // Config removal also removes permission to contact a formerly trusted peer.
    if !peers()?.contains(&peer) { return Ok(true); }
    let success = state.http.post(format!("{peer}/federation/inbox")).json(&event).send().await.is_ok_and(|r| r.status().is_success());
    let delay = (30i64 * (1i64 << attempts.clamp(0, 7))).min(3600);
    sqlx::query("UPDATE federation_deliveries SET delivered_at=CASE WHEN $3 THEN now() ELSE NULL END,next_attempt=now()+($4 * interval '1 second') WHERE event_id=$1 AND peer=$2")
        .bind(id).bind(peer).bind(success).bind(delay).execute(&state.db).await?;
    Ok(true)
}

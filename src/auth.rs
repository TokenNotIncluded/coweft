//! LMM is the only identity provider. CoWeft never accepts an account ID from
//! the caller as identity, and never forwards browser cookies to an agent.
use std::{collections::HashSet, env};
use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use axum::{extract::{Query, State}, http::{header, HeaderMap, HeaderValue, StatusCode}, response::{IntoResponse, Redirect, Response}, Json};
use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine};
use chrono::{Duration, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use subtle::ConstantTimeEq;
use crate::App;

pub type Result<T> = std::result::Result<T, Failure>;
#[derive(Debug)]
pub struct Failure(pub StatusCode, pub &'static str);
impl IntoResponse for Failure {
    fn into_response(self) -> Response {
        let mut response = (self.0, Json(serde_json::json!({"error": self.1}))).into_response();
        response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        if self.0 == StatusCode::UNAUTHORIZED {
            response.headers_mut().insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Bearer realm=\"coweft\""));
        }
        response
    }
}
impl From<sqlx::Error> for Failure {
    fn from(error: sqlx::Error) -> Self {
        tracing::error!(error = %error, "database operation failed");
        Self(StatusCode::SERVICE_UNAVAILABLE, "storage_unavailable")
    }
}
pub fn bad(message: &'static str) -> Failure { Failure(StatusCode::BAD_REQUEST, message) }
pub fn unavailable() -> Failure { Failure(StatusCode::SERVICE_UNAVAILABLE, "identity_unavailable") }
pub fn hash(value: &str) -> String { URL_SAFE_NO_PAD.encode(Sha256::digest(value.as_bytes())) }
pub fn random() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}
fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let mut values = headers.get_all(header::COOKIE).iter()
        .filter_map(|v| v.to_str().ok()).flat_map(|v| v.split(';'))
        .filter_map(|v| v.trim().split_once('=')).filter(|(key, _)| *key == name)
        .map(|(_, value)| value.to_owned());
    let value = values.next()?;
    if values.next().is_some() { None } else { Some(value) }
}
pub fn validate_origin(raw: &str, development: bool) -> anyhow::Result<()> {
    let url = url::Url::parse(raw)?;
    anyhow::ensure!(url.username().is_empty() && url.password().is_none() && url.query().is_none() && url.fragment().is_none() && url.path() == "/", "origin must not contain a path, query or credentials");
    anyhow::ensure!(url.scheme() == "https" || (development && url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))), "HTTPS required");
    Ok(())
}
#[derive(Deserialize, Clone)]
pub struct Discovery {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub jwks_uri: String,
    pub introspection_endpoint: String,
    pub revocation_endpoint: String,
}
pub struct Identity {
    pub meta: Discovery,
    pub keys: jsonwebtoken::jwk::JwkSet,
    pub client_id: String,
    pub resource: String,
    pub resource_id: String,
    pub resource_secret: String,
}
impl Identity {
    pub async fn discover(http: &reqwest::Client, origin: &str) -> anyhow::Result<Self> {
        let issuer = env::var("LMM_ISSUER").unwrap_or_else(|_| "https://api.lmm.best/oidc".into());
        let authority = url::Url::parse(&issuer)?;
        let development = env::var("COWEFT_DEV").as_deref() == Ok("true");
        let local_fixture = development && authority.scheme() == "http" && authority.host_str() == Some("127.0.0.1") && authority.port().is_some() && authority.path() == "/oidc";
        anyhow::ensure!(issuer == "https://api.lmm.best/oidc" || local_fixture, "only the LMM subproject issuer is permitted");
        let meta: Discovery = http.get(format!("{issuer}/.well-known/openid-configuration")).send().await?.error_for_status()?.json().await?;
        anyhow::ensure!(meta.issuer == issuer, "issuer mismatch");
        for endpoint in [&meta.authorization_endpoint, &meta.token_endpoint, &meta.jwks_uri, &meta.introspection_endpoint, &meta.revocation_endpoint] {
            let url = url::Url::parse(endpoint)?;
            anyhow::ensure!(url.origin() == authority.origin() && url.username().is_empty() && url.password().is_none() && url.fragment().is_none(), "cross-origin discovery endpoint");
        }
        let keys = http.get(&meta.jwks_uri).send().await?.error_for_status()?.json().await?;
        let resource_secret = env::var("LMM_RESOURCE_SECRET")?;
        anyhow::ensure!(resource_secret.len() >= 32, "resource credential must be at least 32 characters");
        Ok(Self {
            meta, keys,
            client_id: env::var("LMM_CLIENT_ID").unwrap_or_else(|_| "coweft-web".into()),
            resource: format!("{origin}/mcp"),
            resource_id: env::var("LMM_RESOURCE_ID")?, resource_secret,
        })
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Actor {
    pub id: String, pub subject: String, pub name: String, pub controller: String,
    pub client_id: String, pub grant_id: String, pub scopes: HashSet<String>,
}
impl Actor {
    pub fn require(&self, scope: &str) -> Result<()> {
        if self.scopes.contains(scope) { Ok(()) } else { Err(Failure(StatusCode::FORBIDDEN, "insufficient_scope")) }
    }
}
#[derive(Deserialize)]
struct Introspection {
    active: bool, iss: Option<String>, sub: Option<String>, aud: Option<String>, name: Option<String>,
    scope: Option<String>, client_id: Option<String>, controller: Option<String>, grant_id: Option<String>, exp: Option<i64>,
}
#[derive(Serialize, Deserialize)]
struct Credential { access_token: String, refresh_token: Option<String> }
#[derive(Deserialize)]
struct TokenResponse { access_token: String, refresh_token: Option<String>, id_token: Option<String> }
#[derive(Deserialize, Clone)]
struct Claims { sub: String, nonce: String, at_hash: Option<String> }
fn encrypt(key: &[u8; 32], value: &Credential) -> Result<String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| unavailable())?;
    let mut nonce = [0u8; 12]; rand::thread_rng().fill_bytes(&mut nonce);
    let data = serde_json::to_vec(value).map_err(|_| unavailable())?;
    let ciphertext = cipher.encrypt(Nonce::from_slice(&nonce), data.as_ref()).map_err(|_| unavailable())?;
    Ok(STANDARD.encode([nonce.to_vec(), ciphertext].concat()))
}
fn decrypt(key: &[u8; 32], value: &str) -> Result<Credential> {
    let bytes = STANDARD.decode(value).map_err(|_| unavailable())?;
    if bytes.len() < 28 { return Err(unavailable()); }
    let plaintext = Aes256Gcm::new_from_slice(key).map_err(|_| unavailable())?
        .decrypt(Nonce::from_slice(&bytes[..12]), &bytes[12..]).map_err(|_| unavailable())?;
    serde_json::from_slice(&plaintext).map_err(|_| unavailable())
}
fn cookie_name(state: &App) -> &'static str { if state.origin.starts_with("https:") { "__Host-coweft" } else { "coweft-dev" } }
fn flow_name(state: &App) -> &'static str { if state.origin.starts_with("https:") { "__Host-coweft-flow" } else { "coweft-dev-flow" } }
fn make_cookie(state: &App, name: &str, value: &str, age: i64) -> Result<HeaderValue> {
    HeaderValue::from_str(&format!("{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}{}", if state.origin.starts_with("https:") { "; Secure" } else { "" })).map_err(|_| unavailable())
}
pub async fn login(State(state): State<App>) -> Result<Response> {
    let token = random(); let verifier = random(); let nonce = random();
    let active: i64 = sqlx::query_scalar("SELECT count(*) FROM login_flows WHERE expires_at>now()").fetch_one(&state.db).await?;
    if active >= 4096 { return Err(Failure(StatusCode::TOO_MANY_REQUESTS, "login_capacity_reached")); }
    sqlx::query("INSERT INTO login_flows(id,verifier,nonce,expires_at) VALUES($1,$2,$3,$4)")
        .bind(hash(&token)).bind(&verifier).bind(&nonce).bind(Utc::now() + Duration::minutes(5)).execute(&state.db).await?;
    let mut target = url::Url::parse(&state.identity.meta.authorization_endpoint).map_err(|_| unavailable())?;
    let redirect = format!("{}/auth/callback", state.origin);
    target.query_pairs_mut().extend_pairs([
        ("client_id", state.identity.client_id.as_str()), ("redirect_uri", redirect.as_str()), ("response_type", "code"),
        ("scope", "openid profile coweft:read coweft:write coweft:propose coweft:vote"), ("resource", state.identity.resource.as_str()),
        ("state", &token), ("nonce", &nonce), ("code_challenge", &hash(&verifier)), ("code_challenge_method", "S256"),
    ]);
    let mut response = Redirect::to(target.as_str()).into_response();
    response.headers_mut().insert(header::SET_COOKIE, make_cookie(&state, flow_name(&state), &token, 300)?);
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}
#[derive(Deserialize)]
pub struct Callback { code: Option<String>, state: Option<String>, iss: Option<String>, error: Option<String> }
pub async fn callback(State(state): State<App>, headers: HeaderMap, Query(query): Query<Callback>) -> Result<Response> {
    let token = query.state.ok_or_else(|| bad("missing_state"))?;
    let bound = cookie(&headers, flow_name(&state)).ok_or_else(|| bad("missing_flow_cookie"))?;
    if token.len() != 43 || !bool::from(token.as_bytes().ct_eq(bound.as_bytes())) { return Err(bad("state_mismatch")); }
    let flow = sqlx::query("DELETE FROM login_flows WHERE id=$1 AND expires_at>now() RETURNING verifier,nonce")
        .bind(hash(&token)).fetch_optional(&state.db).await?.ok_or_else(|| bad("expired_flow"))?;
    if query.error.is_some() { return Err(bad("authorization_denied")); }
    if query.iss.as_deref() != Some(state.identity.meta.issuer.as_str()) { return Err(bad("issuer_mismatch")); }
    let code = query.code.ok_or_else(|| bad("missing_code"))?;
    let verifier: String = flow.get("verifier");
    let redirect = format!("{}/auth/callback", state.origin);
    let tokens: TokenResponse = state.http.post(&state.identity.meta.token_endpoint).form(&[
        ("grant_type", "authorization_code"), ("client_id", &state.identity.client_id), ("code", &code),
        ("redirect_uri", &redirect), ("code_verifier", &verifier), ("resource", &state.identity.resource),
    ]).send().await.map_err(|_| unavailable())?.error_for_status().map_err(|_| bad("code_exchange_failed"))?.json().await.map_err(|_| unavailable())?;
    let id_token = tokens.id_token.as_ref().ok_or_else(|| bad("missing_id_token"))?;
    let header = jsonwebtoken::decode_header(id_token).map_err(|_| bad("invalid_id_token"))?;
    if header.alg != jsonwebtoken::Algorithm::RS256 || header.typ.as_deref() != Some("JWT") { return Err(bad("invalid_algorithm_or_type")); }
    let kid = header.kid.ok_or_else(|| bad("missing_kid"))?;
    let keys: jsonwebtoken::jwk::JwkSet = state.http.get(&state.identity.meta.jwks_uri).send().await.map_err(|_| unavailable())?
        .error_for_status().map_err(|_| unavailable())?.json().await.map_err(|_| unavailable())?;
    let key = keys.find(&kid).ok_or_else(|| bad("unknown_signing_key"))?;
    let decoding = jsonwebtoken::DecodingKey::from_jwk(key).map_err(|_| bad("invalid_signing_key"))?;
    let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::RS256);
    validation.set_audience(&[&state.identity.client_id]); validation.set_issuer(&[&state.identity.meta.issuer]);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]); validation.leeway = 30;
    let claims = jsonwebtoken::decode::<Claims>(id_token, &decoding, &validation).map_err(|_| bad("invalid_id_token"))?.claims;
    let expected_nonce: String = flow.get("nonce");
    if !bool::from(claims.nonce.as_bytes().ct_eq(expected_nonce.as_bytes())) || claims.sub.is_empty() { return Err(bad("nonce_mismatch")); }
    if let Some(at_hash) = claims.at_hash {
        let digest = Sha256::digest(tokens.access_token.as_bytes());
        if at_hash != URL_SAFE_NO_PAD.encode(&digest[..16]) { return Err(bad("access_token_hash_mismatch")); }
    }
    let actor = introspect(&state, &tokens.access_token).await?;
    if actor.subject != claims.sub || actor.client_id != state.identity.client_id { return Err(bad("subject_or_client_mismatch")); }
    register_actor(&state, actor).await?;
    let session = random(); let csrf = random();
    let credential = encrypt(&state.session_key, &Credential { access_token: tokens.access_token, refresh_token: tokens.refresh_token })?;
    sqlx::query("INSERT INTO web_sessions(id,credential,csrf,expires_at) VALUES($1,$2,$3,$4)")
        .bind(hash(&session)).bind(credential).bind(csrf).bind(Utc::now() + Duration::days(7)).execute(&state.db).await?;
    let mut response = Redirect::to("/").into_response();
    response.headers_mut().append(header::SET_COOKIE, make_cookie(&state, cookie_name(&state), &session, 604800)?);
    response.headers_mut().append(header::SET_COOKIE, make_cookie(&state, flow_name(&state), "", 0)?);
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}
// Deliberately contains NO database access. Session refresh may hold the only
// available pool connection; nested pool checkout would deadlock under load.
async fn introspect(state: &App, token: &str) -> Result<Actor> {
    let value: Introspection = state.http.post(&state.identity.meta.introspection_endpoint)
        .basic_auth(&state.identity.resource_id, Some(&state.identity.resource_secret))
        .form(&[("token", token), ("resource", &state.identity.resource)])
        .send().await.map_err(|_| unavailable())?.error_for_status().map_err(|_| unavailable())?.json().await.map_err(|_| unavailable())?;
    if !value.active || value.iss.as_deref() != Some(&state.identity.meta.issuer) || value.aud.as_deref() != Some(&state.identity.resource) || value.exp.unwrap_or(0) <= Utc::now().timestamp() {
        return Err(Failure(StatusCode::UNAUTHORIZED, "invalid_token"));
    }
    let subject = value.sub.filter(|v| !v.is_empty() && v.len() <= 128).ok_or_else(|| bad("missing_subject"))?;
    let controller = value.controller.filter(|v| v == "human" || v == "agent").ok_or_else(|| bad("missing_controller"))?;
    let actor = Actor {
        id: hash(&format!("{}\0{subject}", state.identity.meta.issuer)), subject,
        name: value.name.unwrap_or_else(|| "成员".into()), controller,
        client_id: value.client_id.ok_or_else(|| bad("missing_client"))?,
        grant_id: value.grant_id.ok_or_else(|| bad("missing_grant"))?,
        scopes: value.scope.unwrap_or_default().split_whitespace().map(str::to_owned).collect(),
    };
    actor.require("coweft:read")?;
    Ok(actor)
}
pub async fn register_actor(state: &App, mut actor: Actor) -> Result<Actor> {
    actor.name = sqlx::query_scalar("INSERT INTO accounts(id,issuer,subject,name) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=CASE WHEN $5 THEN excluded.name ELSE accounts.name END RETURNING name")
        .bind(&actor.id).bind(&state.identity.meta.issuer).bind(&actor.subject).bind(&actor.name)
        .bind(actor.scopes.contains("profile")).fetch_one(&state.db).await?;
    Ok(actor)
}
pub async fn authenticate(state: &App, headers: &HeaderMap, write: bool) -> Result<(Actor, Option<String>)> {
    let authorization = headers.get_all(header::AUTHORIZATION).iter().collect::<Vec<_>>();
    let session = cookie(headers, cookie_name(state));
    if !authorization.is_empty() {
        if authorization.len() != 1 || session.is_some() { return Err(bad("ambiguous_credentials")); }
        let token = authorization[0].to_str().ok().and_then(|v| v.strip_prefix("Bearer ")).filter(|v| v.len() <= 1024)
            .ok_or(Failure(StatusCode::UNAUTHORIZED, "invalid_token"))?;
        let actor = introspect(state, token).await?;
        return Ok((register_actor(state, actor).await?, None));
    }
    let session = session.filter(|v| v.len() == 43).ok_or(Failure(StatusCode::UNAUTHORIZED, "login_required"))?;
    let mut transaction = state.db.begin().await?;
    let row = sqlx::query("SELECT credential,csrf FROM web_sessions WHERE id=$1 AND expires_at>now() FOR UPDATE")
        .bind(hash(&session)).fetch_optional(&mut *transaction).await?.ok_or(Failure(StatusCode::UNAUTHORIZED, "session_expired"))?;
    let csrf: String = row.get("csrf");
    if write {
        let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
        let supplied = headers.get("x-coweft-csrf").and_then(|v| v.to_str().ok()).unwrap_or("");
        if origin != Some(state.origin.as_str()) || !bool::from(csrf.as_bytes().ct_eq(supplied.as_bytes())) { return Err(Failure(StatusCode::FORBIDDEN, "csrf_rejected")); }
    }
    let mut credential = decrypt(&state.session_key, &row.get::<String, _>("credential"))?;
    let actor = match introspect(state, &credential.access_token).await {
        Ok(actor) => actor,
        Err(Failure(StatusCode::UNAUTHORIZED, _)) => {
            let refresh = credential.refresh_token.as_ref().ok_or(Failure(StatusCode::UNAUTHORIZED, "login_required"))?;
            let tokens: TokenResponse = state.http.post(&state.identity.meta.token_endpoint).form(&[
                ("grant_type", "refresh_token"), ("client_id", &state.identity.client_id), ("refresh_token", refresh), ("resource", &state.identity.resource),
            ]).send().await.map_err(|_| unavailable())?.error_for_status().map_err(|_| Failure(StatusCode::UNAUTHORIZED, "login_required"))?.json().await.map_err(|_| unavailable())?;
            credential = Credential { access_token: tokens.access_token, refresh_token: tokens.refresh_token };
            let actor = introspect(state, &credential.access_token).await?;
            sqlx::query("UPDATE web_sessions SET credential=$1 WHERE id=$2")
                .bind(encrypt(&state.session_key, &credential)?).bind(hash(&session)).execute(&mut *transaction).await?;
            actor
        }
        Err(error) => return Err(error),
    };
    if actor.client_id != state.identity.client_id { return Err(Failure(StatusCode::UNAUTHORIZED, "session_client_mismatch")); }
    transaction.commit().await?;
    // Only now may another pool connection be acquired.
    Ok((register_actor(state, actor).await?, Some(csrf)))
}
/// Internal-only credential access for a trusted LMM API call, after authenticate.
/// The caller must never serialize or send this value to a peer or web client.
pub async fn delegated_token(state: &App, headers: &HeaderMap) -> Result<String> {
    if let Some(raw) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")) { return Ok(raw.to_owned()); }
    let id = cookie(headers, cookie_name(state)).ok_or(Failure(StatusCode::UNAUTHORIZED, "login_required"))?;
    let encrypted: String = sqlx::query_scalar("SELECT credential FROM web_sessions WHERE id=$1 AND expires_at>now()")
        .bind(hash(&id)).fetch_optional(&state.db).await?.ok_or(Failure(StatusCode::UNAUTHORIZED, "session_expired"))?;
    Ok(decrypt(&state.session_key, &encrypted)?.access_token)
}
pub async fn logout(State(state): State<App>, headers: HeaderMap) -> Result<Response> {
    authenticate(&state, &headers, true).await?;
    if let Some(id) = cookie(&headers, cookie_name(&state)) {
        if let Some(row) = sqlx::query("DELETE FROM web_sessions WHERE id=$1 RETURNING credential").bind(hash(&id)).fetch_optional(&state.db).await? {
            let value = decrypt(&state.session_key, &row.get::<String, _>("credential"))?;
            let token = value.refresh_token.unwrap_or(value.access_token);
            let result = state.http.post(&state.identity.meta.revocation_endpoint).form(&[("token", token.as_str()), ("client_id", &state.identity.client_id)]).send().await;
            if result.as_ref().map_or(true, |r| !r.status().is_success()) { tracing::warn!("LMM revocation unavailable; local session has been removed"); }
        }
    }
    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().insert(header::SET_COOKIE, make_cookie(&state, cookie_name(&state), "", 0)?);
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn credentials_are_encrypted_and_tamper_rejected() {
        let key = [7;32]; let value = Credential { access_token: "private".into(), refresh_token: None };
        let encrypted = encrypt(&key, &value).unwrap(); assert!(!encrypted.contains("private"));
        assert_eq!(decrypt(&key, &encrypted).unwrap().access_token, "private"); assert!(decrypt(&[8;32], &encrypted).is_err());
    }
    #[test] fn origins_are_strict() {
        assert!(validate_origin("https://forum.example", false).is_ok()); assert!(validate_origin("http://forum.example", false).is_err());
        assert!(validate_origin("https://evil@example.com", false).is_err()); assert!(validate_origin("http://127.0.0.1:8080", true).is_ok());
    }
    #[test] fn duplicate_cookies_are_rejected() {
        let mut headers = HeaderMap::new(); headers.insert(header::COOKIE, HeaderValue::from_static("a=1; a=2")); assert_eq!(cookie(&headers, "a"), None);
    }
    #[test] fn account_identity_is_unambiguous() { assert_ne!(hash("a\0bc"), hash("ab\0c")); }
}

use std::{env, collections::HashSet};
use axum::{extract::{State, Query}, http::{HeaderMap, HeaderValue, StatusCode, header}, response::{IntoResponse, Response, Redirect}, Json};
use base64::{Engine, engine::general_purpose::{URL_SAFE_NO_PAD, STANDARD}};
use chrono::{Utc, Duration};
use aes_gcm::{Aes256Gcm, KeyInit, aead::Aead, Nonce};
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
        let mut r = (self.0, Json(serde_json::json!({"error":self.1}))).into_response();
        r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        if self.0 == StatusCode::UNAUTHORIZED { r.headers_mut().insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Bearer realm=\"coweft\"")); }
        r
    }
}
impl From<sqlx::Error> for Failure { fn from(e:sqlx::Error)->Self { tracing::error!(error=%e,"database operation failed"); Self(StatusCode::SERVICE_UNAVAILABLE,"storage_unavailable") } }
pub fn bad(s:&'static str)->Failure { Failure(StatusCode::BAD_REQUEST,s) }
pub fn unavailable()->Failure { Failure(StatusCode::SERVICE_UNAVAILABLE,"identity_unavailable") }
pub fn hash(s:&str)->String { URL_SAFE_NO_PAD.encode(Sha256::digest(s.as_bytes())) }
pub fn random()->String { let mut b=[0u8;32]; rand::thread_rng().fill_bytes(&mut b); URL_SAFE_NO_PAD.encode(b) }
fn cookie(h:&HeaderMap,name:&str)->Option<String> {
    let mut values = h.get_all(header::COOKIE).iter().filter_map(|v|v.to_str().ok()).flat_map(|s|s.split(';')).filter_map(|s|s.trim().split_once('=')).filter(|(k,_)|*k==name).map(|(_,v)|v.to_owned());
    let v=values.next()?; if values.next().is_some() {None} else {Some(v)}
}
pub fn validate_origin(raw:&str,dev:bool)->anyhow::Result<()> {
    let u=url::Url::parse(raw)?;
    anyhow::ensure!(u.username().is_empty() && u.password().is_none() && u.query().is_none() && u.fragment().is_none() && u.path()=="/", "origin must be an origin without path or credentials");
    anyhow::ensure!(u.scheme()=="https" || (dev && u.scheme()=="http" && matches!(u.host_str(),Some("localhost"|"127.0.0.1"|"[::1]"))),"HTTPS required"); Ok(())
}
#[derive(Deserialize, Clone)]
pub struct Discovery { pub issuer:String, pub authorization_endpoint:String, pub token_endpoint:String, pub jwks_uri:String, pub introspection_endpoint:String, pub revocation_endpoint:String }
pub struct Identity { pub meta:Discovery, pub keys:jsonwebtoken::jwk::JwkSet, pub client_id:String, pub resource:String, pub resource_id:String, pub resource_secret:String }
impl Identity {
    pub async fn discover(http:&reqwest::Client,origin:&str)->anyhow::Result<Self> {
        let issuer=env::var("LMM_ISSUER").unwrap_or("https://api.lmm.best".into());
        anyhow::ensure!(issuer=="https://api.lmm.best" || (env::var("COWEFT_DEV").as_deref()==Ok("true") && issuer.starts_with("http://127.0.0.1:")),"only LMM is a permitted identity provider");
        let meta:Discovery=http.get(format!("{issuer}/.well-known/openid-configuration")).send().await?.error_for_status()?.json().await?;
        anyhow::ensure!(meta.issuer==issuer,"issuer mismatch");
        let authority=url::Url::parse(&issuer)?;
        for endpoint in [&meta.authorization_endpoint,&meta.token_endpoint,&meta.jwks_uri,&meta.introspection_endpoint,&meta.revocation_endpoint] {
            let u=url::Url::parse(endpoint)?; anyhow::ensure!(u.origin()==authority.origin() && u.username().is_empty() && u.password().is_none() && u.fragment().is_none(),"cross-origin discovery endpoint");
        }
        let keys=http.get(&meta.jwks_uri).send().await?.error_for_status()?.json().await?;
        let resource_id=env::var("LMM_RESOURCE_ID")?;
        let resource_secret=env::var("LMM_RESOURCE_SECRET")?;
        anyhow::ensure!(resource_secret.len()>=32,"resource introspection credential must be at least 32 characters");
        Ok(Self{meta,keys,client_id:env::var("LMM_CLIENT_ID").unwrap_or("coweft-web".into()),resource:format!("{origin}/mcp"),resource_id,resource_secret})
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Actor { pub id:String, pub subject:String, pub name:String, pub controller:String, pub client_id:String, pub grant_id:String, pub scopes:HashSet<String> }
impl Actor { pub fn require(&self,scope:&str)->Result<()> { if self.scopes.contains(scope) {Ok(())} else {Err(Failure(StatusCode::FORBIDDEN,"insufficient_scope"))} } }
#[derive(Deserialize)]
struct Introspection { active:bool, iss:Option<String>, sub:Option<String>, aud:Option<String>, name:Option<String>, scope:Option<String>, client_id:Option<String>, controller:Option<String>, grant_id:Option<String>, exp:Option<i64> }
#[derive(Serialize, Deserialize)]
struct Credential { access_token:String, refresh_token:Option<String> }
#[derive(Deserialize)]
struct TokenResponse { access_token:String, refresh_token:Option<String>, id_token:Option<String> }
#[derive(Deserialize, Clone)]
struct Claims { iss:String, sub:String, aud:String, exp:i64, nonce:String, at_hash:Option<String> }
fn encrypt(key:&[u8;32],value:&Credential)->Result<String> {
    let cipher=Aes256Gcm::new_from_slice(key).map_err(|_|unavailable())?;
    let mut nonce=[0u8;12]; rand::thread_rng().fill_bytes(&mut nonce);
    let data=serde_json::to_vec(value).map_err(|_|unavailable())?;
    let encrypted=cipher.encrypt(Nonce::from_slice(&nonce),data.as_ref()).map_err(|_|unavailable())?;
    Ok(STANDARD.encode([nonce.to_vec(),encrypted].concat()))
}
fn decrypt(key:&[u8;32],value:&str)->Result<Credential> {
    let bytes=STANDARD.decode(value).map_err(|_|unavailable())?;
    if bytes.len()<28 {return Err(unavailable())}
    let data=Aes256Gcm::new_from_slice(key).map_err(|_|unavailable())?.decrypt(Nonce::from_slice(&bytes[..12]),&bytes[12..]).map_err(|_|unavailable())?;
    serde_json::from_slice(&data).map_err(|_|unavailable())
}
fn session_cookie(s:&App,value:&str,age:i64)->String { format!("{}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}{}",cookie_name(s),if s.origin.starts_with("https:") {"; Secure"} else {""}) }
fn cookie_name(s:&App)->&'static str { if s.origin.starts_with("https:") {"__Host-coweft"} else {"coweft-dev"} }
fn flow_cookie(s:&App,value:&str,age:i64)->String { format!("coweft-flow={value}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age={age}{}",if s.origin.starts_with("https:") {"; Secure"} else {""}) }
pub async fn login(State(s):State<App>)->Result<Response> {
    let state=random(); let verifier=random(); let nonce=random();
    sqlx::query("INSERT INTO login_flows(id,verifier,nonce,expires_at) VALUES($1,$2,$3,$4)").bind(hash(&state)).bind(&verifier).bind(&nonce).bind(Utc::now()+Duration::minutes(5)).execute(&s.db).await?;
    let mut u=url::Url::parse(&s.identity.meta.authorization_endpoint).map_err(|_|unavailable())?;
    u.query_pairs_mut().extend_pairs([
        ("client_id",s.identity.client_id.as_str()),("redirect_uri",format!("{}/auth/callback",s.origin).as_str()),("response_type","code"),
        ("scope","openid profile coweft:read coweft:write coweft:propose coweft:vote"),("resource",s.identity.resource.as_str()),
        ("state",&state),("nonce",&nonce),("code_challenge",&hash(&verifier)),("code_challenge_method","S256")]);
    let mut response=Redirect::to(u.as_str()).into_response();
    response.headers_mut().insert(header::SET_COOKIE,HeaderValue::from_str(&flow_cookie(&s,&state,300)).map_err(|_|unavailable())?);
    response.headers_mut().insert(header::CACHE_CONTROL,HeaderValue::from_static("no-store")); Ok(response)
}
#[derive(Deserialize)]
pub struct Callback { code:Option<String>,state:Option<String>,iss:Option<String>,error:Option<String> }
pub async fn callback(State(s):State<App>,headers:HeaderMap,Query(q):Query<Callback>)->Result<Response> {
    let state=q.state.ok_or_else(||bad("missing_state"))?;
    let bound=cookie(&headers,"coweft-flow").ok_or_else(||bad("missing_flow_cookie"))?;
    if state.len()!=43 || !bool::from(state.as_bytes().ct_eq(bound.as_bytes())) {return Err(bad("state_mismatch"))}
    let row=sqlx::query("DELETE FROM login_flows WHERE id=$1 AND expires_at>now() RETURNING verifier,nonce").bind(hash(&state)).fetch_optional(&s.db).await?.ok_or_else(||bad("expired_flow"))?;
    if q.error.is_some() { return Err(bad("authorization_denied")) }
    if q.iss.as_deref()!=Some(s.identity.meta.issuer.as_str()) {return Err(bad("issuer_mismatch"))}
    let code=q.code.ok_or_else(||bad("missing_code"))?;
    let token:TokenResponse=s.http.post(&s.identity.meta.token_endpoint).form(&[
        ("grant_type","authorization_code"),("client_id",&s.identity.client_id),("code",&code),
        ("redirect_uri",&format!("{}/auth/callback",s.origin)),("code_verifier",row.get::<String,_>("verifier").as_str()),("resource",&s.identity.resource)
    ]).send().await.map_err(|_|unavailable())?.error_for_status().map_err(|_|bad("code_exchange_failed"))?.json().await.map_err(|_|unavailable())?;
    let id=token.id_token.as_ref().ok_or_else(||bad("missing_id_token"))?;
    let header=jsonwebtoken::decode_header(id).map_err(|_|bad("invalid_id_token"))?;
    if header.alg!=jsonwebtoken::Algorithm::RS256 {return Err(bad("invalid_algorithm"))}
    let kid=header.kid.ok_or_else(||bad("missing_kid"))?;
    // Refresh JWKS on callback, so signing-key rotation does not require restart.
    let keys:jsonwebtoken::jwk::JwkSet=s.http.get(&s.identity.meta.jwks_uri).send().await.map_err(|_|unavailable())?.error_for_status().map_err(|_|unavailable())?.json().await.map_err(|_|unavailable())?;
    let key=keys.find(&kid).ok_or_else(||bad("unknown_signing_key"))?;
    let decoding=jsonwebtoken::DecodingKey::from_jwk(key).map_err(|_|bad("invalid_signing_key"))?;
    let mut validation=jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::RS256);
    validation.set_audience(&[&s.identity.client_id]); validation.set_issuer(&[&s.identity.meta.issuer]); validation.leeway=30;
    let claims=jsonwebtoken::decode::<Claims>(id,&decoding,&validation).map_err(|_|bad("invalid_id_token"))?.claims;
    let expected_nonce:String=row.get("nonce");
    if !bool::from(claims.nonce.as_bytes().ct_eq(expected_nonce.as_bytes())) || claims.sub.is_empty() {return Err(bad("nonce_mismatch"))}
    if let Some(at_hash)=claims.at_hash { let digest=Sha256::digest(token.access_token.as_bytes()); if at_hash!=URL_SAFE_NO_PAD.encode(&digest[..16]) {return Err(bad("access_token_hash_mismatch"))} }
    let actor=introspect(&s,&token.access_token).await?;
    if actor.subject!=claims.sub {return Err(bad("subject_mismatch"))}
    let session=random(); let csrf=random();
    let credential=encrypt(&s.session_key,&Credential{access_token:token.access_token,refresh_token:token.refresh_token})?;
    sqlx::query("INSERT INTO web_sessions(id,credential,csrf,expires_at) VALUES($1,$2,$3,$4)").bind(hash(&session)).bind(credential).bind(csrf).bind(Utc::now()+Duration::days(7)).execute(&s.db).await?;
    let mut response=Redirect::to("/").into_response();
    response.headers_mut().append(header::SET_COOKIE,HeaderValue::from_str(&session_cookie(&s,&session,604800)).map_err(|_|unavailable())?);
    response.headers_mut().append(header::SET_COOKIE,HeaderValue::from_str(&flow_cookie(&s,"",0)).map_err(|_|unavailable())?);
    response.headers_mut().insert(header::CACHE_CONTROL,HeaderValue::from_static("no-store")); Ok(response)
}
async fn introspect(s:&App,token:&str)->Result<Actor> {
    let v:Introspection=s.http.post(&s.identity.meta.introspection_endpoint).basic_auth(&s.identity.resource_id,Some(&s.identity.resource_secret)).form(&[("token",token),("resource",&s.identity.resource)]).send().await.map_err(|_|unavailable())?.error_for_status().map_err(|_|unavailable())?.json().await.map_err(|_|unavailable())?;
    if !v.active || v.iss.as_deref()!=Some(&s.identity.meta.issuer) || v.aud.as_deref()!=Some(&s.identity.resource) || v.exp.unwrap_or(0)<=Utc::now().timestamp() {return Err(Failure(StatusCode::UNAUTHORIZED,"invalid_token"))}
    let sub=v.sub.filter(|x|!x.is_empty()).ok_or_else(||bad("missing_subject"))?;
    let controller=v.controller.filter(|x|x=="human" || x=="agent").ok_or_else(||bad("missing_controller"))?;
    let actor=Actor{id:hash(&format!("{}\0{sub}",s.identity.meta.issuer)),subject:sub,name:v.name.unwrap_or("成员".into()),controller,
        client_id:v.client_id.ok_or_else(||bad("missing_client"))?,grant_id:v.grant_id.ok_or_else(||bad("missing_grant"))?,scopes:v.scope.unwrap_or_default().split_whitespace().map(str::to_owned).collect()};
    actor.require("coweft:read")?;
    sqlx::query("INSERT INTO accounts(id,issuer,subject,name) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=excluded.name").bind(&actor.id).bind(&s.identity.meta.issuer).bind(&actor.subject).bind(&actor.name).execute(&s.db).await?;
    Ok(actor)
}
pub async fn authenticate(s:&App,h:&HeaderMap,write:bool)->Result<(Actor,Option<String>)> {
    let bearer=h.get_all(header::AUTHORIZATION).iter().collect::<Vec<_>>();
    let session=cookie(h,cookie_name(s));
    if !bearer.is_empty() {
        if bearer.len()!=1 || session.is_some() {return Err(bad("ambiguous_credentials"))}
        let raw=bearer[0].to_str().ok().and_then(|s|s.strip_prefix("Bearer ")).filter(|x|x.len()<=1024).ok_or(Failure(StatusCode::UNAUTHORIZED,"invalid_token"))?;
        return Ok((introspect(s,raw).await?,None))
    }
    let id=session.filter(|x|x.len()==43).ok_or(Failure(StatusCode::UNAUTHORIZED,"login_required"))?;
    // Serialize refresh for this session, including concurrent HTTP and UI requests.
    let mut tx=s.db.begin().await?;
    let row=sqlx::query("SELECT credential,csrf FROM web_sessions WHERE id=$1 AND expires_at>now() FOR UPDATE").bind(hash(&id)).fetch_optional(&mut *tx).await?.ok_or(Failure(StatusCode::UNAUTHORIZED,"session_expired"))?;
    let csrf:String=row.get("csrf");
    if write {
        let origin=h.get(header::ORIGIN).and_then(|v|v.to_str().ok()); let supplied=h.get("x-coweft-csrf").and_then(|v|v.to_str().ok()).unwrap_or("");
        if origin!=Some(s.origin.as_str()) || !bool::from(csrf.as_bytes().ct_eq(supplied.as_bytes())) {return Err(Failure(StatusCode::FORBIDDEN,"csrf_rejected"))}
    }
    let mut credential=decrypt(&s.session_key,&row.get::<String,_>("credential"))?;
    let actor=match introspect(s,&credential.access_token).await {
        Ok(a)=>a,
        Err(Failure(StatusCode::UNAUTHORIZED,_))=>{
            let refresh=credential.refresh_token.as_ref().ok_or(Failure(StatusCode::UNAUTHORIZED,"login_required"))?;
            let token:TokenResponse=s.http.post(&s.identity.meta.token_endpoint).form(&[("grant_type","refresh_token"),("client_id",&s.identity.client_id),("refresh_token",refresh),("resource",&s.identity.resource)]).send().await.map_err(|_|unavailable())?.error_for_status().map_err(|_|Failure(StatusCode::UNAUTHORIZED,"login_required"))?.json().await.map_err(|_|unavailable())?;
            credential=Credential{access_token:token.access_token,refresh_token:token.refresh_token};
            let a=introspect(s,&credential.access_token).await?;
            sqlx::query("UPDATE web_sessions SET credential=$1 WHERE id=$2").bind(encrypt(&s.session_key,&credential)?).bind(hash(&id)).execute(&mut *tx).await?; a
        }, Err(e)=>return Err(e)
    };
    tx.commit().await?; Ok((actor,Some(csrf)))
}
pub async fn logout(State(s):State<App>,h:HeaderMap)->Result<Response> {
    authenticate(&s,&h,true).await?;
    if let Some(id)=cookie(&h,cookie_name(&s)) {
        if let Some(row)=sqlx::query("DELETE FROM web_sessions WHERE id=$1 RETURNING credential").bind(hash(&id)).fetch_optional(&s.db).await? {
            let v=decrypt(&s.session_key,&row.get::<String,_>("credential"))?;
            let token=v.refresh_token.unwrap_or(v.access_token);
            let _=s.http.post(&s.identity.meta.revocation_endpoint).form(&[("token",token.as_str()),("client_id",&s.identity.client_id)]).send().await;
        }
    }
    let mut r=StatusCode::NO_CONTENT.into_response(); r.headers_mut().insert(header::SET_COOKIE,HeaderValue::from_str(&session_cookie(&s,"",0)).map_err(|_|unavailable())?); Ok(r)
}
#[cfg(test)]
mod tests {
 use super::*;
 #[test] fn credentials_encrypt_and_tamper_rejected(){let key=[7;32];let c=Credential{access_token:"private".into(),refresh_token:None};let e=encrypt(&key,&c).unwrap();assert!(!e.contains("private"));assert_eq!(decrypt(&key,&e).unwrap().access_token,"private");assert!(decrypt(&[8;32],&e).is_err());}
 #[test] fn origin_validation(){assert!(validate_origin("https://forum.example",false).is_ok());assert!(validate_origin("http://forum.example",false).is_err());assert!(validate_origin("https://evil@example.com",false).is_err());assert!(validate_origin("http://127.0.0.1:8080",true).is_ok());}
 #[test] fn duplicate_cookie_rejected(){let mut h=HeaderMap::new();h.insert(header::COOKIE,HeaderValue::from_static("a=1; a=2"));assert_eq!(cookie(&h,"a"),None);}
 #[test] fn grants_do_not_create_extra_accounts(){assert_eq!(hash("https://api.lmm.best\0lmm:42"),hash("https://api.lmm.best\0lmm:42"));assert_ne!(hash("a\0bc"),hash("ab\0c"));}
}

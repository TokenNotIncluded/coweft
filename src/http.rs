use axum::{extract::{State,Path,Query},http::{HeaderMap,StatusCode,header},Json};
use serde::Deserialize;
use serde_json::{Value,json};
use sqlx::Row;
use uuid::Uuid;
use crate::{App,auth::{self,Result,Failure},commands::Command};

pub async fn health(State(s):State<App>)->Result<Json<Value>> {sqlx::query("SELECT 1").execute(&s.db).await?;Ok(Json(json!({"status":"ok"})))}
pub async fn me(State(s):State<App>,h:HeaderMap)->Result<(HeaderMap,Json<Value>)> {
 let (a,csrf)=auth::authenticate(&s,&h,false).await?;
 let mut headers=HeaderMap::new();headers.insert(header::CACHE_CONTROL,"no-store".parse().unwrap());
 Ok((headers,Json(json!({"account":a,"csrf":csrf,"identity_settings":format!("{}/api/user/auth/oidc/grants",url::Url::parse(&s.identity.meta.issuer).map_err(|_|auth::unavailable())?.origin().ascii_serialization()),"ai_enabled":s.model_key.is_some()&&!s.model.is_empty()}))))
}
#[derive(Deserialize,Default)] pub struct Search {pub q:Option<String>,pub kind:Option<String>,pub offset:Option<i64>}
pub async fn list(s:&App,p:&Search)->Result<Value> {
 let q=p.q.as_deref().unwrap_or("");if q.chars().count()>200 {return Err(auth::bad("query_too_long"))}
 let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(t) FROM (SELECT t.id,t.title,left(t.body,240) excerpt,t.kind,t.revision,t.account_id,a.name,t.controller,t.created_at,t.updated_at,(SELECT count(*) FROM replies r WHERE r.thread_id=t.id) replies FROM threads t JOIN accounts a ON a.id=t.account_id WHERE ($1='' OR t.title ILIKE '%'||$1||'%' OR t.body ILIKE '%'||$1||'%') AND ($2='' OR t.kind=$2) ORDER BY t.updated_at DESC,t.id DESC LIMIT 30 OFFSET $3) t").bind(q).bind(p.kind.as_deref().unwrap_or("")).bind(p.offset.unwrap_or(0).clamp(0,10000)).fetch_all(&s.db).await?;
 Ok(json!({"items":rows,"next_offset":if rows.len()==30 {Some(p.offset.unwrap_or(0).clamp(0,10000)+30)}else{None}}))
}
pub async fn threads(State(s):State<App>,Query(p):Query<Search>)->Result<Json<Value>> {Ok(Json(list(&s,&p).await?))}
pub async fn detail(s:&App,id:Uuid)->Result<Value> {
 let t:Value=sqlx::query_scalar("SELECT to_jsonb(x) FROM (SELECT t.*,a.name FROM threads t JOIN accounts a ON a.id=t.account_id WHERE t.id=$1) x").bind(id).fetch_optional(&s.db).await?.ok_or(Failure(StatusCode::NOT_FOUND,"thread_not_found"))?;
 let replies:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(x) FROM (SELECT r.*,a.name FROM replies r JOIN accounts a ON a.id=r.account_id WHERE r.thread_id=$1 ORDER BY r.created_at,r.id LIMIT 200) x").bind(id).fetch_all(&s.db).await?;
 let revisions:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(x) FROM (SELECT revision,actor,controller,created_at FROM revisions WHERE thread_id=$1 ORDER BY revision DESC LIMIT 100) x").bind(id).fetch_all(&s.db).await?;
 let evidence:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(x) FROM (SELECT kind,note,from_account,created_at FROM evidence WHERE thread_id=$1 ORDER BY created_at DESC LIMIT 100) x").bind(id).fetch_all(&s.db).await?;
 Ok(json!({"thread":t,"replies":replies,"revisions":revisions,"evidence":evidence,"replies_limit":200}))
}
pub async fn thread(State(s):State<App>,Path(id):Path<Uuid>)->Result<Json<Value>> {Ok(Json(detail(&s,id).await?))}
#[derive(Deserialize)] pub struct Envelope {pub idempotency_key:String,pub command:Command}
pub async fn command(State(s):State<App>,h:HeaderMap,Json(body):Json<Envelope>)->Result<Json<Value>> {
 let (actor,_)=auth::authenticate(&s,&h,true).await?;
 Ok(Json(crate::commands::execute(&s,&actor,&body.idempotency_key,body.command).await?))
}
pub async fn proposal_list(s:&App)->Result<Value> {
 let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(x) FROM (SELECT p.*,(SELECT count(*) FROM electorate e WHERE e.proposal_id=p.id) members,(SELECT count(*) FROM ballots b WHERE b.proposal_id=p.id AND choice='support') support,(SELECT count(*) FROM ballots b WHERE b.proposal_id=p.id AND choice='oppose') oppose,(SELECT count(*) FROM ballots b WHERE b.proposal_id=p.id AND choice='abstain') abstain FROM proposals p ORDER BY p.created_at DESC LIMIT 100) x").fetch_all(&s.db).await?;
 Ok(json!({"items":rows,"rule":"one_account_one_ballot","reputation_weight":false}))
}
pub async fn proposals(State(s):State<App>)->Result<Json<Value>> {Ok(Json(proposal_list(&s).await?))}
pub async fn reputation(State(s):State<App>,Path(id):Path<String>)->Result<Json<Value>> {
 let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(e) FROM (SELECT thread_id,from_account,kind,note,created_at FROM evidence WHERE to_account=$1 ORDER BY created_at DESC LIMIT 100) e").bind(id).fetch_all(&s.db).await?;
 Ok(Json(json!({"evidence":rows,"rank":null,"voting_weight":1})))
}
pub async fn export(State(s):State<App>,h:HeaderMap)->Result<(HeaderMap,Json<Value>)> {
 let (a,_)=auth::authenticate(&s,&h,false).await?;
 let threads:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(t) FROM threads t WHERE account_id=$1 ORDER BY created_at").bind(&a.id).fetch_all(&s.db).await?;
 let replies:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(r) FROM replies r WHERE account_id=$1 ORDER BY created_at").bind(&a.id).fetch_all(&s.db).await?;
 let operations:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(o) FROM operations o WHERE account_id=$1 ORDER BY created_at").bind(&a.id).fetch_all(&s.db).await?;
 let mut headers=HeaderMap::new();headers.insert(header::CACHE_CONTROL,"no-store".parse().unwrap());headers.insert(header::CONTENT_DISPOSITION,"attachment; filename=\"coweft-export.json\"".parse().unwrap());
 Ok((headers,Json(json!({"schema":"coweft-export-v1","account":a,"threads":threads,"replies":replies,"operations":operations,"contains_credentials":false}))))
}

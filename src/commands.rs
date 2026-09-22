use axum::http::StatusCode;
use chrono::{DateTime,Utc,Duration};
use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use sqlx::Row;
use uuid::Uuid;
use crate::{App,auth::{Actor,Result,Failure,bad,hash}};

#[derive(Debug,Serialize,Deserialize)]
#[serde(tag="action",rename_all="snake_case",deny_unknown_fields)]
pub enum Command {
 CreateThread{title:String,body:String,kind:String},
 Reply{thread_id:Uuid,body:String},
 Edit{thread_id:Uuid,title:String,body:String,expected_revision:i32},
 Propose{thread_id:Uuid,title:String,rationale:String},
 Vote{proposal_id:Uuid,choice:String},
 Finalize{proposal_id:Uuid},
 Evidence{thread_id:Uuid,kind:String,note:String},
}
impl Command {
 pub fn scope(&self)->&'static str { match self {Self::Propose{..}|Self::Finalize{..}=>"coweft:propose",Self::Vote{..}=>"coweft:vote",_=>"coweft:write"} }
 pub fn name(&self)->&'static str {match self {Self::CreateThread{..}=>"create_thread",Self::Reply{..}=>"reply",Self::Edit{..}=>"edit",Self::Propose{..}=>"propose",Self::Vote{..}=>"vote",Self::Finalize{..}=>"finalize",Self::Evidence{..}=>"evidence"}}
}
fn text(s:&str,max:usize)->Result<()> {if s.trim().is_empty() || s.chars().count()>max || s.contains('\0') {Err(bad("invalid_text_length"))}else{Ok(())}}
pub fn consensus(participants:i64,yes:i64,no:i64,quorum:i64)->&'static str {
 if participants<quorum {"no_quorum"} else if yes+no==0 {"no_consensus"} else if yes*3>=(yes+no)*2 {"accepted"} else {"not_accepted"}
}
pub async fn execute(s:&App,a:&Actor,key:&str,c:Command)->Result<Value> {
 a.require(c.scope())?;
 if key.len()<8 || key.len()>128 || !key.is_ascii() {return Err(bad("idempotency_key_required"))}
 let serialized=serde_json::to_string(&c).map_err(|_|bad("invalid_command"))?;
 let digest=hash(&serialized);
 let mut tx=s.db.begin().await?;
 sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))").bind(format!("command:{}:{key}",a.id)).execute(&mut *tx).await?;
 if let Some(row)=sqlx::query("SELECT request_hash,response FROM idempotency WHERE account_id=$1 AND key=$2").bind(&a.id).bind(key).fetch_optional(&mut *tx).await? {
  if row.get::<String,_>("request_hash")!=digest {return Err(Failure(StatusCode::CONFLICT,"idempotency_key_reused"))}
  return Ok(row.get("response"))
 }
 // Serialize the per-account limit as well: the human and all agents share it.
 sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))").bind(&a.id).execute(&mut *tx).await?;
 let count:i64=sqlx::query_scalar("SELECT count(*) FROM operations WHERE account_id=$1 AND created_at>now()-interval '1 minute'").bind(&a.id).fetch_one(&mut *tx).await?;
 if count>=20 {return Err(Failure(StatusCode::TOO_MANY_REQUESTS,"account_rate_limit"))}
 let action=c.name();
 let (object_id,result)=match c {
  Command::CreateThread{title,body,kind}=>{
   text(&title,180)?;text(&body,60000)?;
   if !["discussion","knowledge","experiment"].contains(&kind.as_str()) {return Err(bad("invalid_thread_kind"))}
   let id=Uuid::new_v4();
   sqlx::query("INSERT INTO threads(id,account_id,title,body,kind,controller) VALUES($1,$2,$3,$4,$5,$6)").bind(id).bind(&a.id).bind(&title).bind(&body).bind(&kind).bind(&a.controller).execute(&mut *tx).await?;
   sqlx::query("INSERT INTO revisions(thread_id,revision,title,body,actor,controller) VALUES($1,1,$2,$3,$4,$5)").bind(id).bind(title).bind(body).bind(&a.id).bind(&a.controller).execute(&mut *tx).await?;
   (id,json!({"id":id,"revision":1}))
  },
  Command::Reply{thread_id,body}=>{
   text(&body,30000)?;
   let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM threads WHERE id=$1)").bind(thread_id).fetch_one(&mut *tx).await?;
   if !exists {return Err(Failure(StatusCode::NOT_FOUND,"thread_not_found"))}
   let id=Uuid::new_v4();
   sqlx::query("INSERT INTO replies(id,thread_id,account_id,body,controller) VALUES($1,$2,$3,$4,$5)").bind(id).bind(thread_id).bind(&a.id).bind(body).bind(&a.controller).execute(&mut *tx).await?;
   sqlx::query("UPDATE threads SET updated_at=now() WHERE id=$1").bind(thread_id).execute(&mut *tx).await?;
   (thread_id,json!({"id":id,"thread_id":thread_id}))
  },
  Command::Edit{thread_id,title,body,expected_revision}=>{
   text(&title,180)?;text(&body,60000)?;
   let revision:Option<i32>=sqlx::query_scalar("UPDATE threads SET title=$1,body=$2,revision=revision+1,controller=$3,updated_at=now() WHERE id=$4 AND account_id=$5 AND revision=$6 RETURNING revision").bind(&title).bind(&body).bind(&a.controller).bind(thread_id).bind(&a.id).bind(expected_revision).fetch_optional(&mut *tx).await?;
   let revision=revision.ok_or(Failure(StatusCode::CONFLICT,"revision_conflict_or_not_owner"))?;
   sqlx::query("INSERT INTO revisions(thread_id,revision,title,body,actor,controller) VALUES($1,$2,$3,$4,$5,$6)").bind(thread_id).bind(revision).bind(title).bind(body).bind(&a.id).bind(&a.controller).execute(&mut *tx).await?;
   (thread_id,json!({"id":thread_id,"revision":revision}))
  },
  Command::Propose{thread_id,title,rationale}=>{
   text(&title,180)?;text(&rationale,12000)?;
   let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM threads WHERE id=$1)").bind(thread_id).fetch_one(&mut *tx).await?;
   if !exists {return Err(Failure(StatusCode::NOT_FOUND,"thread_not_found"))}
   let id=Uuid::new_v4();
   let electorate:Vec<String>=sqlx::query_scalar("SELECT id FROM accounts ORDER BY id").fetch_all(&mut *tx).await?;
   let quorum=((electorate.len() as i32+4)/5).max(3);
   let closes=Utc::now()+Duration::days(3);
   sqlx::query("INSERT INTO proposals(id,thread_id,title,rationale,proposer,closes_at,quorum) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(id).bind(thread_id).bind(title).bind(rationale).bind(&a.id).bind(closes).bind(quorum).execute(&mut *tx).await?;
   for member in electorate {sqlx::query("INSERT INTO electorate(proposal_id,account_id) VALUES($1,$2)").bind(id).bind(member).execute(&mut *tx).await?;}
   (id,json!({"id":id,"closes_at":closes,"quorum":quorum,"rule_version":"consensus-v1"}))
  },
  Command::Vote{proposal_id,choice}=>{
   if !["support","oppose","abstain"].contains(&choice.as_str()) {return Err(bad("invalid_ballot"))}
   let p=sqlx::query("SELECT closes_at,result FROM proposals WHERE id=$1 FOR UPDATE").bind(proposal_id).fetch_optional(&mut *tx).await?.ok_or(Failure(StatusCode::NOT_FOUND,"proposal_not_found"))?;
   if p.get::<DateTime<Utc>,_>("closes_at")<=Utc::now() || p.get::<Option<String>,_>("result").is_some() {return Err(Failure(StatusCode::CONFLICT,"voting_closed"))}
   let eligible:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM electorate WHERE proposal_id=$1 AND account_id=$2)").bind(proposal_id).bind(&a.id).fetch_one(&mut *tx).await?;
   if !eligible {return Err(Failure(StatusCode::FORBIDDEN,"not_in_electorate_snapshot"))}
   sqlx::query("INSERT INTO ballots(proposal_id,account_id,choice,controller) VALUES($1,$2,$3,$4) ON CONFLICT(proposal_id,account_id) DO UPDATE SET choice=excluded.choice,controller=excluded.controller,updated_at=now()").bind(proposal_id).bind(&a.id).bind(&choice).bind(&a.controller).execute(&mut *tx).await?;
   (proposal_id,json!({"proposal_id":proposal_id,"choice":choice,"votes_per_account":1}))
  },
  Command::Finalize{proposal_id}=>{
   let p=sqlx::query("SELECT closes_at,quorum,result FROM proposals WHERE id=$1 FOR UPDATE").bind(proposal_id).fetch_optional(&mut *tx).await?.ok_or(Failure(StatusCode::NOT_FOUND,"proposal_not_found"))?;
   if p.get::<DateTime<Utc>,_>("closes_at")>Utc::now() {return Err(Failure(StatusCode::CONFLICT,"discussion_period_not_over"))}
   let row=sqlx::query("SELECT count(*) total,count(*) FILTER(WHERE choice='support') yes,count(*) FILTER(WHERE choice='oppose') no FROM ballots WHERE proposal_id=$1").bind(proposal_id).fetch_one(&mut *tx).await?;
   let result=consensus(row.get("total"),row.get("yes"),row.get("no"),p.get::<i32,_>("quorum") as i64);
   sqlx::query("UPDATE proposals SET result=$1 WHERE id=$2 AND result IS NULL").bind(result).bind(proposal_id).execute(&mut *tx).await?;
   (proposal_id,json!({"proposal_id":proposal_id,"result":result,"execution":"recorded_decision_not_arbitrary_code"}))
  },
  Command::Evidence{thread_id,kind,note}=>{
   text(&note,2000)?;
   if !["reproduced","correction","useful"].contains(&kind.as_str()) {return Err(bad("invalid_evidence_kind"))}
   let owner:Option<String>=sqlx::query_scalar("SELECT account_id FROM threads WHERE id=$1").bind(thread_id).fetch_optional(&mut *tx).await?;
   let owner=owner.ok_or(Failure(StatusCode::NOT_FOUND,"thread_not_found"))?;
   if owner==a.id {return Err(bad("self_endorsement_not_allowed"))}
   let id=Uuid::new_v4();
   sqlx::query("INSERT INTO evidence(id,thread_id,from_account,to_account,kind,note) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(thread_id,from_account,kind) DO UPDATE SET note=excluded.note").bind(id).bind(thread_id).bind(&a.id).bind(owner).bind(&kind).bind(note).execute(&mut *tx).await?;
   (thread_id,json!({"thread_id":thread_id,"kind":kind,"privileges_awarded":false}))
  }
 };
 sqlx::query("INSERT INTO operations(id,account_id,controller,client_id,grant_id,action,object_id) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(Uuid::new_v4()).bind(&a.id).bind(&a.controller).bind(&a.client_id).bind(&a.grant_id).bind(action).bind(object_id.to_string()).execute(&mut *tx).await?;
 sqlx::query("INSERT INTO idempotency(account_id,key,request_hash,response) VALUES($1,$2,$3,$4)").bind(&a.id).bind(key).bind(digest).bind(&result).execute(&mut *tx).await?;
 tx.commit().await?; Ok(result)
}
#[cfg(test)] mod tests {
 use super::*;
 #[test] fn no_quorum_is_not_approval(){assert_eq!(consensus(2,2,0,3),"no_quorum");}
 #[test] fn abstention_is_not_support(){assert_eq!(consensus(5,0,0,3),"no_consensus");}
 #[test] fn two_thirds_boundary(){assert_eq!(consensus(3,2,1,3),"accepted");assert_eq!(consensus(4,2,2,3),"not_accepted");}
 #[test] fn account_action_scopes(){assert_eq!(Command::Vote{proposal_id:Uuid::nil(),choice:"support".into()}.scope(),"coweft:vote");}
 #[test] fn unicode_limit(){assert!(text("共织",2).is_ok());assert!(text("共织",1).is_err());assert!(text("  ",5).is_err());}
}

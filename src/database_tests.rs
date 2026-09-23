//! These tests require PostgreSQL and apply the actual production migrations.
use std::{collections::HashSet, sync::Arc};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;
use crate::{App, auth::{Actor, Discovery, Identity, register_actor}, commands::{Command, execute}, federation::{Envelope, Receipt, Snapshot, Verified, import_verified}};

fn app(pool: PgPool) -> App {
    App { db: pool, http: reqwest::Client::new(), origin: "https://forum.example".into(), session_key: [7;32], model_key: None, model: String::new(), ai_daily_requests: 0,
        identity: Arc::new(Identity { meta: Discovery { issuer: "https://api.lmm.best/oidc".into(), authorization_endpoint: String::new(), token_endpoint: String::new(), jwks_uri: String::new(), introspection_endpoint: String::new(), revocation_endpoint: String::new() }, keys: jsonwebtoken::jwk::JwkSet { keys: vec![] }, client_id: "coweft-web".into(), resource: "https://forum.example/mcp".into(), resource_id: "coweft".into(), resource_secret: "test-only-secret-not-production".into() }) }
}
async fn member(state: &App, subject: &str) -> Actor {
    register_actor(state, Actor { id: crate::auth::hash(&format!("{}\0{subject}", state.identity.meta.issuer)), subject: subject.into(), name: subject.into(), controller: "human".into(), client_id: "coweft-web".into(), grant_id: Uuid::new_v4().to_string(), scopes: ["profile","coweft:read","coweft:write","coweft:propose","coweft:vote"].map(str::to_owned).into_iter().collect::<HashSet<_>>() }).await.unwrap()
}
fn create(title: &str) -> Command { Command::CreateThread { title: title.into(), body: "Evidence and reproducible steps.".into(), kind: "experiment".into() } }
fn id(value: &Value) -> Uuid { Uuid::parse_str(value["id"].as_str().unwrap()).unwrap() }
#[sqlx::test(migrations = "./migrations")]
async fn writes_are_idempotent_and_content_bound(pool: PgPool) {
    let state = app(pool); let actor = member(&state, "lmm:1").await;
    let first = execute(&state, &actor, "operation-1", create("Original")).await.unwrap();
    let retry = execute(&state, &actor, "operation-1", create("Original")).await.unwrap(); assert_eq!(first, retry);
    let conflict = execute(&state, &actor, "operation-1", create("Changed")).await.unwrap_err(); assert_eq!(conflict.0, StatusCode::CONFLICT);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM threads").fetch_one(&state.db).await.unwrap(); assert_eq!(count, 1);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM operations").fetch_one(&state.db).await.unwrap(); assert_eq!(count, 1);
}
#[sqlx::test(migrations = "./migrations")]
async fn human_and_agent_share_one_ballot(pool: PgPool) {
    let state = app(pool); let human = member(&state, "lmm:1").await;
    member(&state, "lmm:2").await; member(&state, "lmm:3").await;
    let thread = execute(&state, &human, "new-thread", create("Proposal evidence")).await.unwrap();
    let proposal = execute(&state, &human, "new-proposal", Command::Propose { thread_id: id(&thread), title: "Adopt reproducibility template".into(), rationale: "Trial for one week and review evidence.".into() }).await.unwrap();
    execute(&state, &human, "human-ballot", Command::Vote { proposal_id: id(&proposal), choice: "support".into() }).await.unwrap();
    let mut agent = human.clone(); agent.controller = "agent".into(); agent.client_id = "coweft-agent".into(); agent.grant_id = "separate-agent-grant".into();
    execute(&state, &agent, "agent-ballot", Command::Vote { proposal_id: id(&proposal), choice: "oppose".into() }).await.unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM ballots").fetch_one(&state.db).await.unwrap(); assert_eq!(count, 1);
    let choice: String = sqlx::query_scalar("SELECT choice FROM ballots").fetch_one(&state.db).await.unwrap(); assert_eq!(choice, "oppose");
    let controller: String = sqlx::query_scalar("SELECT controller FROM ballots").fetch_one(&state.db).await.unwrap(); assert_eq!(controller, "agent");
    agent.scopes.remove("coweft:vote");
    assert_eq!(execute(&state, &agent, "missing-scope", Command::Vote { proposal_id: id(&proposal), choice: "support".into() }).await.unwrap_err().0, StatusCode::FORBIDDEN);
    let late = member(&state, "lmm:late").await;
    assert_eq!(execute(&state, &late, "late-ballot", Command::Vote { proposal_id: id(&proposal), choice: "support".into() }).await.unwrap_err().1, "not_in_electorate_snapshot");
}
#[sqlx::test(migrations = "./migrations")]
async fn stale_or_foreign_edits_never_overwrite(pool: PgPool) {
    let state = app(pool); let owner = member(&state, "lmm:owner").await; let other = member(&state, "lmm:other").await;
    let thread = execute(&state, &owner, "create-thread", create("Original")).await.unwrap(); let thread_id = id(&thread);
    execute(&state, &owner, "edit-thread", Command::Edit { thread_id, title: "Updated".into(), body: "New evidence".into(), expected_revision: 1 }).await.unwrap();
    for (actor, revision) in [(&owner, 1), (&other, 2)] {
        let error = execute(&state, actor, "bad-edit-key", Command::Edit { thread_id, title: "Overwrite".into(), body: "Not permitted".into(), expected_revision: revision }).await.unwrap_err(); assert_eq!(error.0, StatusCode::CONFLICT);
    }
    let title: String = sqlx::query_scalar("SELECT title FROM threads WHERE id=$1").bind(thread_id).fetch_one(&state.db).await.unwrap(); assert_eq!(title, "Updated");
}
#[sqlx::test(migrations = "./migrations")]
async fn profile_scope_does_not_erase_shared_name(pool: PgPool) {
    let state = app(pool); let human = member(&state, "lmm:person").await;
    let mut agent = human.clone(); agent.name = "成员".into(); agent.scopes.remove("profile"); agent.controller = "agent".into();
    let agent = register_actor(&state, agent).await.unwrap(); assert_eq!(agent.name, human.name);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM accounts").fetch_one(&state.db).await.unwrap(); assert_eq!(count, 1);
}
fn verified(snapshot: Snapshot, subject: &str) -> (Envelope, Verified) {
    let raw = serde_json::to_string(&snapshot).unwrap(); let digest = crate::auth::hash(&raw);
    let envelope = Envelope { payload: raw, receipt: "test-preverified-receipt".into() };
    let receipt = Receipt { iss: "https://api.lmm.best/oidc".into(), aud: "urn:coweft:public-thread-v1".into(), sub: subject.into(), resource: format!("{}/mcp", snapshot.source), client_id: "coweft-web".into(), controller: "human".into(), digest: digest.clone(), purpose: "public-thread-v1".into(), iat: chrono::Utc::now().timestamp(), name: Some(subject.into()) };
    (envelope, Verified { snapshot, receipt, digest })
}
#[sqlx::test(migrations = "./migrations")]
async fn federation_replay_owner_and_revision_rules(pool: PgPool) {
    let snapshot = Snapshot { version: 1, source: "https://another-node.example".into(), id: Uuid::new_v4(), title: "Replicated evidence".into(), body: "An original public post.".into(), kind: "discussion".into(), revision: 1 };
    let (envelope, event) = verified(snapshot.clone(), "lmm:author"); assert_eq!(import_verified(&pool, &envelope, event).await.unwrap()["status"], "accepted");
    let (envelope, event) = verified(snapshot.clone(), "lmm:author"); assert_eq!(import_verified(&pool, &envelope, event).await.unwrap()["status"], "already_received");
    let mut fork = snapshot.clone(); fork.body = "Altered at the same revision".into();
    let (envelope, event) = verified(fork, "lmm:author"); assert_eq!(import_verified(&pool, &envelope, event).await.unwrap_err().1, "remote_revision_fork");
    let mut newer = snapshot.clone(); newer.revision = 2; newer.body = "A genuine revision".into();
    let (envelope, event) = verified(newer.clone(), "lmm:impostor"); assert_eq!(import_verified(&pool, &envelope, event).await.unwrap_err().1, "remote_owner_conflict");
    let (envelope, event) = verified(newer, "lmm:author"); import_verified(&pool, &envelope, event).await.unwrap();
    let (envelope, event) = verified(snapshot, "lmm:author"); assert_eq!(import_verified(&pool, &envelope, event).await.unwrap()["status"], "older_revision_ignored");
}
#[sqlx::test(migrations = "./migrations")]
async fn reply_changes_ai_context(pool: PgPool) {
    let state = app(pool); let actor = member(&state, "lmm:1").await;
    let thread = execute(&state, &actor, "create-context", create("Question")).await.unwrap();
    let first = crate::http::detail(&state, id(&thread)).await.unwrap();
    execute(&state, &actor, "new-evidence", Command::Reply { thread_id: id(&thread), body: "New contradictory evidence".into() }).await.unwrap();
    let second = crate::http::detail(&state, id(&thread)).await.unwrap();
    assert_ne!(crate::auth::hash(&first.to_string()), crate::auth::hash(&second.to_string()));
}
#[test]
fn go_issued_receipt_interoperates_with_rust_and_rejects_tampering() {
    let Ok(path) = std::env::var("COWEFT_INTEROP_FIXTURE") else { return; };
    let fixture: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let keys = serde_json::from_value(fixture["jwks"].clone()).unwrap();
    let mut envelope: Envelope = serde_json::from_value(fixture["envelope"].clone()).unwrap();
    let verified = crate::federation::verify_with_keys("https://api.lmm.best/oidc", &keys, &envelope).unwrap();
    assert_eq!(verified.receipt.sub, "lmm:7");
    envelope.payload.push('x');
    assert!(crate::federation::verify_with_keys("https://api.lmm.best/oidc", &keys, &envelope).is_err());
    assert!(crate::federation::verify_with_keys("https://evil.example/oidc", &keys, &serde_json::from_value(fixture["envelope"].clone()).unwrap()).is_err());
    let _ = json!({"assertion":"receipt validation crosses Go/Rust boundary"});
}

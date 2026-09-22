use std::{sync::{Arc, atomic::{AtomicBool, Ordering}}, time::Duration};
use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use axum::{http::{HeaderMap, StatusCode}, routing::post, Json, Router};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{Utc, Duration as ChronoDuration};
use serde_json::json;
use sqlx::{PgPool, postgres::PgPoolOptions};
use crate::{App, auth::{self, Discovery, Identity}};

#[sqlx::test(migrations = "./migrations")]
async fn browser_auth_works_with_one_connection_and_rechecks_revocation(pool: PgPool) {
    let limited = PgPoolOptions::new().max_connections(1).acquire_timeout(Duration::from_secs(1))
        .connect_with(pool.connect_options().as_ref().clone()).await.unwrap();
    let active = Arc::new(AtomicBool::new(true));
    let flag = active.clone();
    let mock = Router::new().route("/introspect", post(move || {
        let active = flag.load(Ordering::SeqCst);
        async move { Json(json!({"active":active,"iss":"https://api.lmm.best/oidc","sub":"lmm:session-test","aud":"https://forum.example/mcp","name":"Shared identity","scope":"profile coweft:read coweft:write","client_id":"coweft-web","controller":"human","grant_id":"test-grant","exp":Utc::now().timestamp()+600})) }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, mock).await.unwrap(); });
    let state = App {
        db: limited, http: reqwest::Client::new(), origin: "https://forum.example".into(), session_key: [7;32], model_key: None, model: String::new(), ai_daily_requests: 0,
        identity: Arc::new(Identity {
            meta: Discovery { issuer: "https://api.lmm.best/oidc".into(), authorization_endpoint: String::new(), token_endpoint: String::new(), jwks_uri: String::new(), introspection_endpoint: format!("http://{address}/introspect"), revocation_endpoint: String::new() },
            keys: jsonwebtoken::jwk::JwkSet { keys: vec![] }, client_id: "coweft-web".into(), resource: "https://forum.example/mcp".into(), resource_id: "coweft".into(), resource_secret: "test-only-resource-secret".into(),
        }),
    };
    let raw = auth::random(); let csrf = auth::random(); let nonce = [8u8;12];
    let data = serde_json::to_vec(&json!({"access_token":"fixture-access","refresh_token":null})).unwrap();
    let encrypted = Aes256Gcm::new_from_slice(&state.session_key).unwrap().encrypt(Nonce::from_slice(&nonce), data.as_ref()).unwrap();
    let credential = STANDARD.encode([nonce.to_vec(), encrypted].concat());
    sqlx::query("INSERT INTO web_sessions(id,credential,csrf,expires_at) VALUES($1,$2,$3,$4)")
        .bind(auth::hash(&raw)).bind(credential).bind(&csrf).bind(Utc::now()+ChronoDuration::hours(1)).execute(&state.db).await.unwrap();
    let mut headers = HeaderMap::new();
    headers.insert("cookie", format!("__Host-coweft={raw}").parse().unwrap());
    headers.insert("origin", "https://forum.example".parse().unwrap());
    headers.insert("x-coweft-csrf", csrf.parse().unwrap());
    let result = tokio::time::timeout(Duration::from_secs(2), auth::authenticate(&state, &headers, true)).await.expect("nested pool acquisition deadlocked").unwrap();
    assert_eq!(result.0.subject, "lmm:session-test");
    assert_eq!(result.0.name, "Shared identity");
    headers.insert("origin", "https://attacker.example".parse().unwrap());
    assert_eq!(auth::authenticate(&state, &headers, true).await.unwrap_err().0, StatusCode::FORBIDDEN);
    headers.insert("origin", "https://forum.example".parse().unwrap());
    active.store(false, Ordering::SeqCst);
    assert_eq!(auth::authenticate(&state, &headers, true).await.unwrap_err().0, StatusCode::UNAUTHORIZED);
    server.abort();
}

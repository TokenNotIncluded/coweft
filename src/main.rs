mod auth;
mod commands;
mod http;
mod mcp;
mod ai;
mod federation;
#[cfg(test)] mod database_tests;

use std::{env, sync::Arc, time::Duration};
use axum::{routing::{get, post}, Router};
use sqlx::postgres::PgPoolOptions;
use tower_http::{services::{ServeDir, ServeFile}, trace::TraceLayer};

#[derive(Clone)]
pub struct App {
    pub db: sqlx::PgPool,
    pub http: reqwest::Client,
    pub identity: Arc<auth::Identity>,
    pub origin: String,
    pub session_key: [u8; 32],
    pub model_key: Option<String>,
    pub model: String,
    pub ai_daily_requests: i64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_default_env()).init();
    let origin = env::var("COWEFT_ORIGIN")?.trim_end_matches('/').to_owned();
    auth::validate_origin(&origin, env::var("COWEFT_DEV").as_deref() == Ok("true"))?;
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(env::var("SESSION_KEY")?)?;
    let session_key: [u8; 32] = bytes.try_into().map_err(|_| anyhow::anyhow!("SESSION_KEY must encode 32 bytes"))?;
    let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(30)).build()?;
    let identity = auth::Identity::discover(&client, &origin).await?;
    let db = PgPoolOptions::new().max_connections(8).acquire_timeout(Duration::from_secs(10)).connect(&env::var("DATABASE_URL")?).await?;
    sqlx::migrate!().run(&db).await?;
    let state = App { db, http: client, identity: Arc::new(identity), origin, session_key,
        model_key: env::var("LMM_MODEL_API_KEY").ok().filter(|x| !x.is_empty()),
        model: env::var("LMM_MODEL").unwrap_or_default(),
        ai_daily_requests: env::var("AI_DAILY_REQUESTS").ok().and_then(|x| x.parse().ok()).unwrap_or(100) };
    federation::start_worker(state.clone())?;
    let cleanup = state.db.clone();
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(300));
        loop {
            timer.tick().await;
            for table in ["login_flows", "web_sessions"] {
                let _ = sqlx::query(&format!("DELETE FROM {table} WHERE expires_at < now()")).execute(&cleanup).await;
            }
        }
    });
    let app = Router::new()
        .route("/healthz", get(http::health))
        .route("/auth/login", get(auth::login))
        .route("/auth/callback", get(auth::callback))
        .route("/auth/logout", post(auth::logout))
        .route("/api/me", get(http::me))
        .route("/api/threads", get(http::threads))
        .route("/api/threads/{id}", get(http::thread))
        .route("/api/commands", post(http::command))
        .route("/api/proposals", get(http::proposals))
        .route("/api/reputation/{id}", get(http::reputation))
        .route("/api/ai/{id}/{mode}", post(ai::generate))
        .route("/api/export", get(http::export))
        .route("/api/federation/threads", get(federation::list))
        .route("/api/federation/publish/{id}", post(federation::publish))
        .route("/federation/inbox", post(federation::inbox))
        .route("/federation/outbox", get(federation::outbox))
        .route("/.well-known/oauth-protected-resource", get(mcp::metadata))
        .route("/.well-known/oauth-protected-resource/mcp", get(mcp::metadata))
        .route("/mcp", post(mcp::handle).get(mcp::no_stream).delete(mcp::no_session))
        .fallback_service(ServeDir::new("web/dist").not_found_service(ServeFile::new("web/dist/index.html")))
        .layer(axum::extract::DefaultBodyLimit::max(512 * 1024))
        .layer(TraceLayer::new_for_http())
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(env::var("LISTEN_ADDR").unwrap_or("0.0.0.0:8080".into())).await?;
    axum::serve(listener, app).with_graceful_shutdown(async { let _ = tokio::signal::ctrl_c().await; }).await?;
    Ok(())
}

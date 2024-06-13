use std::sync::Arc;

use axum::Router;
use llama_cpp::{LlamaModel, LlamaParams};
use tokio::{net::TcpListener, sync::Mutex};

use crate::history::History;

#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error(transparent)]
    EnvVarError(#[from] std::env::VarError),
    #[error(transparent)]
    IoError(#[from] std::io::Error),
    #[error(transparent)]
    LlamaLoadError(#[from] llama_cpp::LlamaLoadError),
}

#[derive(Clone)]
pub struct AppState {
    // NOTE we could use an atomic bool here but it doesn't support clone
    // It's easy to implement but I'm lazy
    pub ai_active: Arc<Mutex<bool>>,
    pub ai_model: Arc<LlamaModel>,
    pub secret: Arc<String>,
    pub history: Arc<Mutex<History>>,
}

pub async fn serve() -> Result<(), ServerError> {
    let ai_model = LlamaModel::load_from_file(
        "assets/tinyllama-1.1b-chat-v1.0.Q5_K_M.gguf",
        LlamaParams::default(),
    )?;
    let secret = std::env::var("AI_SIDECAR_SECRET")?;
    let history = History::new(
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "./src/default_system_message.txt"
        ))
        .to_string(),
    );

    let state = AppState {
        ai_active: Arc::new(Mutex::new(false)),
        ai_model: Arc::new(ai_model),
        secret: Arc::new(secret),
        history: Arc::new(Mutex::new(history)),
    };

    let router = Router::new()
        .nest("/api", crate::api::route())
        .with_state(state);

    let port = std::env::var("AI_SIDECAR_PORT")?;
    let listener = TcpListener::bind(format!("0.0.0.0:{port}")).await?;

    axum::serve(listener, router).await?;

    Ok(())
}

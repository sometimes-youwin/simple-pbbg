use axum::{
    body::Body,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::{history, llm, server::AppState};

const AUTH_HEADER_KEY: &str = "secret";

pub fn route() -> Router<AppState> {
    tracing::info!("constructing v1 route");

    Router::new()
        .route("/isbusy", get(handle_is_busy))
        .route("/clearhistory", delete(clear_history))
        .route("/generate", post(handle_generate))
}

fn valid_header(headers: &HeaderMap, expected: &str) -> bool {
    let Some(header) = headers.get(AUTH_HEADER_KEY) else {
        return false;
    };

    let Ok(value) = header.to_str() else {
        return false;
    };

    value == expected
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum IsBusyResponse {
    Ready,
    Busy,
}

async fn handle_is_busy(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    tracing::debug!("checking if busy");

    let state = state.clone();

    if !valid_header(&headers, &state.secret) {
        tracing::warn!("invalid secret");
        return (StatusCode::UNAUTHORIZED, Json(IsBusyResponse::Busy));
    }

    let ai_active = state.ai_active.lock().await;

    (
        StatusCode::OK,
        Json(match *ai_active {
            true => IsBusyResponse::Busy,
            false => IsBusyResponse::Ready,
        }),
    )
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClearHistoryResponse {
    Success,
    Busy,
}

async fn clear_history(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    tracing::debug!("attempting to clear history");

    let state = state.clone();

    if !valid_header(&headers, &state.secret) {
        tracing::warn!("invalid secret");
        return (StatusCode::UNAUTHORIZED, Json(ClearHistoryResponse::Busy));
    }

    {
        let ai_active = state.ai_active.lock().await;
        if *ai_active {
            tracing::error!("tried to clear text while generating text");
            return (StatusCode::CONFLICT, Json(ClearHistoryResponse::Busy));
        }
    }

    let mut history = state.history.lock().await;
    history.clear();

    (StatusCode::OK, Json(ClearHistoryResponse::Success))
}

#[derive(Debug, Deserialize)]
struct GenerateRequest {
    setup: Option<String>,
    prompt: String,
    max_tokens: Option<usize>,
}

impl Into<llm::Options> for GenerateRequest {
    fn into(self) -> llm::Options {
        llm::Options {
            setup: self.setup,
            prompt: self.prompt,
            max_tokens: self.max_tokens,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum GenerateResponse {
    Success { message: String },
    Busy,
    GenerateError { message: String },
}

async fn handle_generate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<GenerateRequest>,
) -> impl IntoResponse {
    tracing::debug!("maybe generating text");

    let state = state.clone();

    if !valid_header(&headers, &state.secret) {
        tracing::warn!("invalid secret");
        return (StatusCode::UNAUTHORIZED, Json(GenerateResponse::Busy)).into_response();
    }

    let mut ai_active = state.ai_active.lock().await;
    if *ai_active {
        tracing::warn!("already generating text");

        return (StatusCode::CONFLICT, Json(GenerateResponse::Busy)).into_response();
    }
    *ai_active = true;

    let ai_model = state.ai_model.clone();
    let mut history = &mut state.history.lock().await;

    let Ok(output) = llm::generate_text(&ai_model, &mut history, req) else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(GenerateResponse::GenerateError {
                message: "unable to create token generation stream".into(),
            }),
        )
            .into_response();
    };

    *ai_active = false;
    history.push(history::MessageType::Assistant, output.clone());

    (
        StatusCode::OK,
        Json(GenerateResponse::Success { message: output }),
    )
        .into_response()
}

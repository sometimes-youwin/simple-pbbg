use axum::Router;

use crate::server::AppState;

mod v1;

pub fn route() -> Router<AppState> {
    tracing::info!("constructing api routes");

    Router::new().nest("/v1", v1::route())
}

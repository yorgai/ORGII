use super::*;
use crate::hub::UserHubRegistry;
use crate::storage::MemoryStorage;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use std::sync::Arc;
use tower::ServiceExt;

fn router() -> Router {
    let storage: Arc<dyn crate::storage::Storage> = Arc::new(MemoryStorage::new());
    let registry = Arc::new(UserHubRegistry::new());
    build_router(AppState::new(storage, registry))
}

#[tokio::test]
async fn healthz_returns_200_ok() {
    let response = router()
        .oneshot(
            Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .expect("build healthz request"),
        )
        .await
        .expect("router responded");

    assert_eq!(response.status(), StatusCode::OK);
    let body = response
        .into_body()
        .collect()
        .await
        .expect("collect body")
        .to_bytes();
    assert_eq!(&body[..], b"ok");
}

#[tokio::test]
async fn readyz_returns_200_ready() {
    let response = router()
        .oneshot(
            Request::builder()
                .uri("/readyz")
                .body(Body::empty())
                .expect("build readyz request"),
        )
        .await
        .expect("router responded");

    assert_eq!(response.status(), StatusCode::OK);
    let body = response
        .into_body()
        .collect()
        .await
        .expect("collect body")
        .to_bytes();
    assert_eq!(&body[..], b"ready");
}

#[tokio::test]
async fn version_returns_protocol_version_from_orgii_protocol() {
    let response = router()
        .oneshot(
            Request::builder()
                .uri("/version")
                .body(Body::empty())
                .expect("build version request"),
        )
        .await
        .expect("router responded");

    assert_eq!(response.status(), StatusCode::OK);
    let body = response
        .into_body()
        .collect()
        .await
        .expect("collect body")
        .to_bytes();
    let parsed: serde_json::Value = serde_json::from_slice(&body).expect("json parse");

    assert_eq!(parsed["version"], env!("CARGO_PKG_VERSION"));
    // The protocol numbers must come straight from `orgii_protocol` —
    // this guards against anyone hardcoding a literal here.
    assert_eq!(parsed["protocol"]["major"], PROTOCOL_VERSION.major);
    assert_eq!(parsed["protocol"]["minor"], PROTOCOL_VERSION.minor);
}

#[tokio::test]
async fn unknown_route_returns_404() {
    let response = router()
        .oneshot(
            Request::builder()
                .uri("/does-not-exist")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("router responded");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

//! Outbound clients for talking to the ORGII mobile relay.
//!
//! Split into two submodules along transport boundaries so the HTTP
//! pairing surface (which is request/response) and the WebSocket frame
//! transport (which is bidirectional and long-lived) can evolve and
//! be tested independently:
//!
//! - [`http`] — `reqwest`-based client for `POST /pair/init`,
//!   `/pair/claim`, `/pair/confirm`. Used during the pairing wizard
//!   and from the `mobile_remote_pair_*` Tauri commands.
//! - [`ws`] — `tokio_tungstenite`-based client for the persistent
//!   `WSS /desktop/connect` channel that carries `Frame::RpcCall`
//!   inbound and `Frame::Event` outbound after pairing succeeds.
//!
//! Both are constructed lazily and held on the bridge state; this
//! module just declares them.

pub mod http;
pub mod ws;

pub use http::{AuditHttpClient, AuditRecordRequest, PairingHttpClient};
pub use ws::{RelayWsClient, WsLifecycleEvent};

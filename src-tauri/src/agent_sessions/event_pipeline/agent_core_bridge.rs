//! Wire-side adapter for the `agent_core::bus::event_pipeline_bridge` IoC
//! slots.
//!
//! This module registers a function pointer for every operation
//! `agent_core` needs on the live `EventStore` pipeline. Each adapter
//! resolves the Tauri-managed [`EventStoreState`] internally — that state is
//! a non-unregistrable `State<'_, ...>` so we can't pass it through the IoC
//! boundary; instead we pull it from the `AppHandle` inside each closure.
//!
//! Called once at startup via [`register`].

use chrono::Utc;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::commands::{
    push_events_to_session, save_events_retry, schedule_notify, session_event_to_cached_event,
    update_spawning_tool_args_with_persist, update_tool_args_by_call_id_with_persist,
    EventStoreState, BULK_WRITE_MAX_RETRIES,
};
use super::types::{
    ActivityStatus, EventDisplayStatus, EventDisplayVariant, EventSource, SessionEvent,
};

use agent_core::bus::event_pipeline_bridge as bridge;

fn push_events_adapter(handle: &AppHandle, session_id: &str, events: Vec<SessionEvent>) {
    let state = handle.state::<EventStoreState>();
    push_events_to_session(handle, &state, session_id, events);
}

fn schedule_notify_adapter(handle: &AppHandle, session_id: &str) {
    let state = handle.state::<EventStoreState>();
    schedule_notify(handle, &state, session_id);
}

fn update_spawning_tool_args_adapter(
    handle: &AppHandle,
    session_id: &str,
    function_names: &[&str],
    merge_args: Value,
) -> Option<String> {
    let state = handle.state::<EventStoreState>();
    update_spawning_tool_args_with_persist(handle, &state, session_id, function_names, merge_args)
}

fn update_tool_args_by_call_id_adapter(
    handle: &AppHandle,
    session_id: &str,
    call_id: &str,
    merge_args: Value,
) -> Option<String> {
    let state = handle.state::<EventStoreState>();
    update_tool_args_by_call_id_with_persist(handle, &state, session_id, call_id, merge_args)
}

fn finalize_streaming_adapter(handle: &AppHandle, session_id: &str) {
    let state = handle.state::<EventStoreState>();
    let changed = state.with_store_mut(session_id, |store| store.finalize_streaming_events());
    if changed {
        schedule_notify(handle, &state, session_id);
    }
}

fn set_session_streaming_adapter(handle: &AppHandle, session_id: &str, streaming: bool) {
    let state = handle.state::<EventStoreState>();
    state.with_store_mut(session_id, |store| {
        store.set_streaming(streaming);
    });
    if !streaming {
        schedule_notify(handle, &state, session_id);
    }
}

fn replace_streaming_event_adapter(
    handle: &AppHandle,
    session_id: &str,
    placeholder_id: &str,
    event: SessionEvent,
) {
    let state = handle.state::<EventStoreState>();
    state.with_store_mut(session_id, |store| {
        store.replace_and_remove(Some(placeholder_id), event);
    });
    schedule_notify(handle, &state, session_id);
}

fn pin_session_adapter(handle: &AppHandle, session_id: &str) {
    let state = handle.state::<EventStoreState>();
    let mut mgr = state
        .session_manager
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    mgr.pin(session_id);
}

fn unpin_session_adapter(handle: &AppHandle, session_id: &str) {
    let state = handle.state::<EventStoreState>();
    let evicted = {
        let mut mgr = state
            .session_manager
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        mgr.unpin(session_id)
    };
    if !evicted.is_empty() {
        let mut stores = state.stores.lock().unwrap_or_else(|e| e.into_inner());
        for sid in &evicted {
            stores.remove(sid);
        }
    }
}

fn read_session_events_adapter(handle: &AppHandle, session_id: &str) -> Vec<SessionEvent> {
    let state = handle.state::<EventStoreState>();
    state
        .with_store_opt(session_id, |store| store.events().to_vec())
        .unwrap_or_default()
}

fn persist_events_adapter(
    label: &'static str,
    session_id: &str,
    events: &[SessionEvent],
    max_retries: u32,
) {
    let cached: Vec<_> = events.iter().map(session_event_to_cached_event).collect();
    let _ = save_events_retry(label, session_id, &cached, max_retries);
}

fn persist_events_async_adapter(
    label: &'static str,
    session_id: String,
    events: Vec<SessionEvent>,
    max_retries: u32,
) {
    tokio::task::spawn_blocking(move || {
        let cached: Vec<_> = events.iter().map(session_event_to_cached_event).collect();
        let _ = save_events_retry(label, &session_id, &cached, max_retries);
    });
}

fn persist_user_message_event_adapter(
    handle: &AppHandle,
    session_id: &str,
    message_id: &str,
    content: &str,
    display_text: Option<&str>,
    images: Option<&[String]>,
    source: bridge::PersistedUserMessageSource,
) {
    let mut result = serde_json::json!({
        "type": "user",
        "message": { "content": content, "role": "user" },
        "backendPersisted": true,
        "messageId": message_id,
    });
    if let Some(images) = images.filter(|images| !images.is_empty()) {
        if let Some(obj) = result.as_object_mut() {
            obj.insert("images".to_string(), serde_json::json!(images));
        }
    }
    if source.is_agent_org_inbox_transcript() {
        if let Some(obj) = result.as_object_mut() {
            obj.insert(
                "agentOrgInboxTranscript".to_string(),
                serde_json::json!(true),
            );
        }
    }

    let args = if source.is_agent_org_inbox_transcript() {
        serde_json::json!({ "agentOrgInboxTranscript": true })
    } else {
        serde_json::json!({})
    };

    // Use the pill-format display_text when provided so that editing a
    // historical message re-populates the pill rather than the expanded YAML.
    // Fall back to content when display_text is absent (backward compat).
    let effective_display_text = display_text
        .filter(|s| !s.is_empty())
        .unwrap_or(content)
        .to_string();

    let mut event = SessionEvent {
        id: format!("user-message-{message_id}"),
        chunk_id: Some(format!("user-message-{message_id}")),
        session_id: session_id.to_string(),
        created_at: Utc::now().to_rfc3339(),
        function_name: "user_message".to_string(),
        ui_canonical: "user_message".to_string(),
        action_type: "raw".to_string(),
        args,
        result,
        source: EventSource::User,
        display_text: effective_display_text,
        display_status: EventDisplayStatus::Completed,
        display_variant: EventDisplayVariant::Message,
        activity_status: ActivityStatus::Agent,
        thread_id: None,
        process_id: None,
        call_id: None,
        file_path: None,
        command: None,
        is_delta: Some(false),
        repo_id: None,
        repo_path: None,
        extracted: None,
        payload_refs: Vec::new(),
        last_extract_at: None,
    };
    event.recompute_extracted();

    let cached = session_event_to_cached_event(&event);
    let state = handle.state::<EventStoreState>();
    state.with_store_mut(session_id, |store| store.merge_events(vec![event]));
    schedule_notify(handle, &state, session_id);
    let _ = save_events_retry(
        "persist_user_message_event",
        session_id,
        &[cached],
        BULK_WRITE_MAX_RETRIES,
    );
}

/// Register every IoC slot exposed by `agent_core::bus::event_pipeline_bridge`.
/// Called once from `app::run` at startup.
pub fn register() {
    bridge::register(
        push_events_adapter,
        schedule_notify_adapter,
        update_spawning_tool_args_adapter,
        update_tool_args_by_call_id_adapter,
        finalize_streaming_adapter,
        set_session_streaming_adapter,
        replace_streaming_event_adapter,
        pin_session_adapter,
        unpin_session_adapter,
        read_session_events_adapter,
        persist_events_adapter,
        persist_events_async_adapter,
        persist_user_message_event_adapter,
    );
}

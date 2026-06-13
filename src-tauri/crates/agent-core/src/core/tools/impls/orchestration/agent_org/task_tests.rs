use std::sync::Arc;

use serde_json::{json, Value};

use crate::coordination::agent_inbox::{AgentInboxStore, AgentMessage};
use crate::coordination::agent_org_runs::{
    AgentOrgContextMember, AgentOrgRunContext, COORDINATOR_MEMBER_ID,
};
use crate::coordination::agent_org_tasks::{AgentOrgTaskStore, TASK_DEPENDENCY_CYCLE_ERROR};
use crate::tools::impls::orchestration::org_send_message::NoopInboxWakeHook;
use crate::tools::traits::{Tool, ToolError};
use test_helpers::test_env;

use super::task_create::TaskCreateTool;
use super::task_list_get::{TaskGetTool, TaskListTool};
use super::task_update::TaskUpdateTool;
use super::TaskToolsContext;

fn test_ctx() -> crate::tools::call_context::CallContext {
    crate::tools::call_context::CallContext::default()
}

fn org_context() -> Arc<AgentOrgRunContext> {
    Arc::new(AgentOrgRunContext {
        run_id: "run-tools-1".into(),
        org_id: "org-tools-1".into(),
        org_name: "Tools Org".into(),
        org_role: "lead engineer".into(),
        coordinator_agent_id: "coord-1".into(),
        coordinator_name: "Coordinator".into(),
        coordinator_role: "lead engineer".into(),
        members: vec![
            AgentOrgContextMember {
                member_id: "m-alice".into(),
                name: "Alice".into(),
                role: "engineer".into(),
                agent_id: "alice-1".into(),
                parent_member_id: None,
            },
            AgentOrgContextMember {
                member_id: "m-bob".into(),
                name: "Bob".into(),
                role: "engineer".into(),
                agent_id: "bob-1".into(),
                parent_member_id: None,
            },
        ],
        hierarchy_mode: Default::default(),
        root_session_id: Some("root-tools-1".into()),
    })
}

fn ctx(caller_member_id: &str) -> Arc<TaskToolsContext> {
    let org_context = org_context();
    let caller_agent_id = org_context
        .require_participant_agent_id(caller_member_id)
        .expect("test caller member id resolves");
    Arc::new(TaskToolsContext {
        org_context,
        caller_agent_id,
        caller_member_id: caller_member_id.to_string(),
        wake_hook: Arc::new(NoopInboxWakeHook),
    })
}

fn shared_sde_ctx(caller_member_id: Option<&str>) -> Arc<TaskToolsContext> {
    Arc::new(TaskToolsContext {
        org_context: Arc::new(AgentOrgRunContext {
            run_id: "run-shared-sde".into(),
            org_id: "org-shared-sde".into(),
            org_name: "Default Agent Org".into(),
            org_role: "Coordinator".into(),
            coordinator_agent_id: "builtin:sde".into(),
            coordinator_name: "Coordinator".into(),
            coordinator_role: "Coordinator".into(),
            members: vec![AgentOrgContextMember {
                member_id: "sde-planner".into(),
                name: "Planner".into(),
                role: "Plans".into(),
                agent_id: "builtin:sde".into(),
                parent_member_id: None,
            }],
            hierarchy_mode: Default::default(),
            root_session_id: Some("root-shared-sde".into()),
        }),
        caller_agent_id: "builtin:sde".into(),
        caller_member_id: caller_member_id
            .unwrap_or(COORDINATOR_MEMBER_ID)
            .to_string(),
        wake_hook: Arc::new(NoopInboxWakeHook),
    })
}

fn task_tools_sandbox() -> test_env::SandboxGuard {
    let sandbox = test_env::sandbox();
    let conn = database::db::get_connection().expect("test sqlite connection");
    crate::coordination::agent_inbox::init_schema(&conn).expect("agent inbox schema");
    crate::coordination::agent_org_tasks::init_schema(&conn).expect("agent team tasks schema");
    sandbox
}

#[tokio::test]
async fn task_create_unassigned_does_not_dispatch_inbox() {
    let _sandbox = task_tools_sandbox();
    let ctx = ctx(COORDINATOR_MEMBER_ID);
    let tool = TaskCreateTool::new(Arc::clone(&ctx));
    let res = tool
        .execute_text(json!({ "subject": "S1" }), &test_ctx())
        .await
        .expect("task_create succeeds");
    let value: Value = serde_json::from_str(&res).unwrap();
    assert!(!value["task_assigned_dispatched"].as_bool().unwrap());
    let task_id = value["task"]["id"].as_str().unwrap().to_string();
    let inbox = AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1").unwrap();
    assert!(inbox.is_empty());
    let stored = AgentOrgTaskStore::get("run-tools-1", &task_id)
        .unwrap()
        .unwrap();
    assert!(stored.owner.is_none());
}

#[tokio::test]
async fn task_create_with_owner_dispatches_inbox() {
    let _sandbox = task_tools_sandbox();
    let ctx = ctx(COORDINATOR_MEMBER_ID);
    let tool = TaskCreateTool::new(Arc::clone(&ctx));
    let res = tool
        .execute_text(
            json!({
                "subject": "S2",
                "owner_member_id": "m-alice",
                "description": "do the thing",
            }),
            &test_ctx(),
        )
        .await
        .expect("task_create succeeds");
    let value: Value = serde_json::from_str(&res).unwrap();
    assert!(value["task_assigned_dispatched"].as_bool().unwrap());

    let inbox = AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1").unwrap();
    assert_eq!(inbox.len(), 1);
    let payload: AgentMessage = serde_json::from_str(&inbox[0].payload_json).unwrap();
    match &payload {
        AgentMessage::TaskAssigned {
            subject,
            assigned_by,
            ..
        } => {
            assert_eq!(subject, "S2");
            assert_eq!(assigned_by, "Coordinator");
        }
        other => panic!("expected TaskAssigned, got {other:?}"),
    }
}

#[tokio::test]
async fn task_create_duplicate_explicit_id_returns_existing_without_dispatch() {
    let _sandbox = task_tools_sandbox();
    let ctx = ctx(COORDINATOR_MEMBER_ID);
    let tool = TaskCreateTool::new(Arc::clone(&ctx));
    let first = tool
        .execute_text(
            json!({
                "id": "stable-task-id",
                "subject": "Original subject",
                "owner_member_id": "m-alice",
            }),
            &test_ctx(),
        )
        .await
        .expect("first task_create succeeds");
    let first_value: Value = serde_json::from_str(&first).unwrap();
    assert!(!first_value["already_exists"].as_bool().unwrap());
    assert!(first_value["task_assigned_dispatched"].as_bool().unwrap());

    let second = tool
        .execute_text(
            json!({
                "id": "stable-task-id",
                "subject": "Retry subject should not replace original",
                "owner_member_id": "m-bob",
            }),
            &test_ctx(),
        )
        .await
        .expect("duplicate task_create returns existing task");
    let second_value: Value = serde_json::from_str(&second).unwrap();
    assert!(second_value["already_exists"].as_bool().unwrap());
    assert!(!second_value["task_assigned_dispatched"].as_bool().unwrap());
    assert_eq!(
        second_value["task"]["subject"].as_str().unwrap(),
        "Original subject"
    );
    assert_eq!(second_value["task"]["owner"].as_str().unwrap(), "m-alice");

    let alice_inbox = AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1").unwrap();
    let bob_inbox = AgentInboxStore::list_unread_for_member("m-bob", "run-tools-1").unwrap();
    assert_eq!(alice_inbox.len(), 1);
    assert!(bob_inbox.is_empty());
}

#[tokio::test]
async fn task_create_coordinator_in_progress_requires_explicit_owner_member_id() {
    let _sandbox = task_tools_sandbox();
    let tool = TaskCreateTool::new(ctx(COORDINATOR_MEMBER_ID));
    let err = tool
        .execute_text(
            json!({
                "subject": "Coordinator started work",
                "status": "in_progress"
            }),
            &test_ctx(),
        )
        .await
        .expect_err("ownerless in_progress task_create is invalid");
    match err {
        ToolError::InvalidParams(msg) => assert!(msg.contains("owner_member_id")),
        other => panic!("expected InvalidParams, got {other:?}"),
    }
}

#[tokio::test]
async fn task_create_coordinator_can_start_explicit_coordinator_work() {
    let _sandbox = task_tools_sandbox();
    let tool = TaskCreateTool::new(ctx(COORDINATOR_MEMBER_ID));
    let res = tool
        .execute_text(
            json!({
                "subject": "Coordinator explicit work",
                "status": "in_progress",
                "owner_member_id": "coordinator"
            }),
            &test_ctx(),
        )
        .await
        .expect("coordinator can explicitly own in-progress work");
    let value: Value = serde_json::from_str(&res).unwrap();
    assert_eq!(value["task"]["status"].as_str().unwrap(), "in_progress");
    assert_eq!(value["task"]["owner"].as_str().unwrap(), "coordinator");
}

#[tokio::test]
async fn task_create_coordinator_can_assign_member_pending_work() {
    let _sandbox = task_tools_sandbox();
    let tool = TaskCreateTool::new(ctx(COORDINATOR_MEMBER_ID));
    let res = tool
        .execute_text(
            json!({
                "subject": "Coordinator assigned member work",
                "status": "pending",
                "owner_member_id": "m-alice"
            }),
            &test_ctx(),
        )
        .await
        .expect("task_create assigns pending member work");
    let value: Value = serde_json::from_str(&res).unwrap();
    assert_eq!(value["task"]["status"].as_str().unwrap(), "pending");
    assert_eq!(value["task"]["owner"].as_str().unwrap(), "m-alice");
    assert!(value["task_assigned_dispatched"].as_bool().unwrap());
    let inbox = AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1").unwrap();
    assert_eq!(inbox.len(), 1);
}

#[tokio::test]
async fn task_create_member_in_progress_requires_explicit_owner_member_id() {
    let _sandbox = task_tools_sandbox();
    let tool = TaskCreateTool::new(ctx("m-alice"));
    let err = tool
        .execute_text(
            json!({
                "subject": "Alice started work",
                "status": "in_progress"
            }),
            &test_ctx(),
        )
        .await
        .expect_err("ownerless in_progress task_create is invalid");
    match err {
        ToolError::InvalidParams(msg) => assert!(msg.contains("owner_member_id")),
        other => panic!("expected InvalidParams, got {other:?}"),
    }
}

#[tokio::test]
async fn task_create_coordinator_cannot_start_member_work_in_progress() {
    let _sandbox = task_tools_sandbox();
    let tool = TaskCreateTool::new(ctx(COORDINATOR_MEMBER_ID));
    let err = tool
        .execute_text(
            json!({
                "subject": "Coordinator attempted member start",
                "status": "in_progress",
                "owner_member_id": "m-alice"
            }),
            &test_ctx(),
        )
        .await
        .expect_err("coordinator cannot start another member's work");
    match err {
        ToolError::InvalidParams(msg) => assert!(msg.contains("owning member")),
        other => panic!("expected InvalidParams, got {other:?}"),
    }
}

#[tokio::test]
async fn task_create_member_cannot_start_other_member_work_in_progress() {
    let _sandbox = task_tools_sandbox();
    let tool = TaskCreateTool::new(ctx("m-alice"));
    let err = tool
        .execute_text(
            json!({
                "subject": "Alice attempted Bob start",
                "status": "in_progress",
                "owner_member_id": "m-bob"
            }),
            &test_ctx(),
        )
        .await
        .expect_err("member cannot start another member's work");
    match err {
        ToolError::InvalidParams(msg) => assert!(msg.contains("owning member")),
        other => panic!("expected InvalidParams, got {other:?}"),
    }
}

#[tokio::test]
async fn task_create_member_can_start_self_work_in_progress() {
    let _sandbox = task_tools_sandbox();
    let tool = TaskCreateTool::new(ctx("m-alice"));
    let res = tool
        .execute_text(
            json!({
                "subject": "Alice started self work",
                "status": "in_progress",
                "owner_member_id": "m-alice"
            }),
            &test_ctx(),
        )
        .await
        .expect("member can start self-owned work");
    let value: Value = serde_json::from_str(&res).unwrap();
    assert_eq!(value["task"]["status"].as_str().unwrap(), "in_progress");
    assert_eq!(value["task"]["owner"].as_str().unwrap(), "m-alice");
}

#[tokio::test]
async fn task_create_shared_agent_coordinator_member_id_explicitly_self_claims() {
    let _sandbox = task_tools_sandbox();
    let tool = TaskCreateTool::new(shared_sde_ctx(Some(COORDINATOR_MEMBER_ID)));
    let res = tool
        .execute_text(
            json!({
                "subject": "Shared SDE coordinator explicit start",
                "status": "in_progress",
                "owner_member_id": "coordinator"
            }),
            &test_ctx(),
        )
        .await
        .expect("shared-agent coordinator task_create uses member_id only");
    let value: Value = serde_json::from_str(&res).unwrap();
    assert_eq!(value["task"]["status"].as_str().unwrap(), "in_progress");
    assert_eq!(value["task"]["owner"].as_str().unwrap(), "coordinator");
}

#[tokio::test]
async fn task_create_rejects_unknown_owner() {
    let _sandbox = task_tools_sandbox();
    let tool = TaskCreateTool::new(ctx(COORDINATOR_MEMBER_ID));
    let err = tool
        .execute_text(
            json!({ "subject": "S3", "owner_member_id": "ghost" }),
            &test_ctx(),
        )
        .await
        .expect_err("must reject unknown owner");
    assert!(matches!(err, ToolError::InvalidParams(_)));
}

#[tokio::test]
async fn task_create_rejects_dependency_cycle_as_invalid_params() {
    let _sandbox = task_tools_sandbox();
    let tool = TaskCreateTool::new(ctx(COORDINATOR_MEMBER_ID));
    let err = tool
        .execute_text(
            json!({
                "id": "cycle-self",
                "subject": "S3-cycle",
                "blocked_by": ["cycle-self"]
            }),
            &test_ctx(),
        )
        .await
        .expect_err("must reject task dependency cycle");
    match err {
        ToolError::InvalidParams(msg) => assert!(msg.contains(TASK_DEPENDENCY_CYCLE_ERROR)),
        other => panic!("expected InvalidParams, got {other:?}"),
    }
}

#[tokio::test]
async fn task_update_rejects_dependency_cycle_as_invalid_params() {
    let _sandbox = task_tools_sandbox();
    let ctx = ctx(COORDINATOR_MEMBER_ID);
    let create = TaskCreateTool::new(Arc::clone(&ctx));
    create
        .execute_text(
            json!({
                "id": "first-cycle",
                "subject": "First",
                "blocks": ["second-cycle"]
            }),
            &test_ctx(),
        )
        .await
        .unwrap();
    create
        .execute_text(
            json!({ "id": "second-cycle", "subject": "Second" }),
            &test_ctx(),
        )
        .await
        .unwrap();

    let update = TaskUpdateTool::new(Arc::clone(&ctx));
    let err = update
        .execute_text(
            json!({ "id": "second-cycle", "blocks": ["first-cycle"] }),
            &test_ctx(),
        )
        .await
        .expect_err("must reject task dependency cycle");
    match err {
        ToolError::InvalidParams(msg) => assert!(msg.contains(TASK_DEPENDENCY_CYCLE_ERROR)),
        other => panic!("expected InvalidParams, got {other:?}"),
    }
}

#[tokio::test]
async fn task_update_in_progress_without_owner_returns_invalid_params() {
    let _sandbox = task_tools_sandbox();
    let ctx = ctx(COORDINATOR_MEMBER_ID);
    let create = TaskCreateTool::new(Arc::clone(&ctx));
    create
        .execute_text(
            json!({ "id": "coord-start", "subject": "Coordinator start" }),
            &test_ctx(),
        )
        .await
        .unwrap();

    let update = TaskUpdateTool::new(Arc::clone(&ctx));
    let err = update
        .execute_text(
            json!({ "id": "coord-start", "status": "in_progress" }),
            &test_ctx(),
        )
        .await
        .expect_err("ownerless in_progress task_update is invalid");
    match err {
        ToolError::InvalidParams(msg) => assert!(msg.contains("owner_member_id")),
        other => panic!("expected InvalidParams, got {other:?}"),
    }
}

#[tokio::test]
async fn task_update_coordinator_can_start_explicit_coordinator_task() {
    let _sandbox = task_tools_sandbox();
    let ctx = ctx(COORDINATOR_MEMBER_ID);
    let create = TaskCreateTool::new(Arc::clone(&ctx));
    create
        .execute_text(
            json!({
                "id": "coordinator-owned-start",
                "subject": "Coordinator owned start",
                "owner_member_id": "coordinator"
            }),
            &test_ctx(),
        )
        .await
        .unwrap();

    let update = TaskUpdateTool::new(Arc::clone(&ctx));
    let res = update
        .execute_text(
            json!({ "id": "coordinator-owned-start", "status": "in_progress" }),
            &test_ctx(),
        )
        .await
        .expect("coordinator starts explicitly owned task");
    let value: Value = serde_json::from_str(&res).unwrap();
    assert_eq!(value["task"]["status"].as_str().unwrap(), "in_progress");
    assert_eq!(value["task"]["owner"].as_str().unwrap(), "coordinator");
}

#[tokio::test]
async fn task_update_coordinator_cannot_start_member_task_in_progress() {
    let _sandbox = task_tools_sandbox();
    let ctx = ctx(COORDINATOR_MEMBER_ID);
    let create = TaskCreateTool::new(Arc::clone(&ctx));
    create
        .execute_text(
            json!({
                "id": "member-owned-start-attempt",
                "subject": "Member owned start attempt",
                "owner_member_id": "m-alice"
            }),
            &test_ctx(),
        )
        .await
        .unwrap();

    let update = TaskUpdateTool::new(Arc::clone(&ctx));
    let err = update
        .execute_text(
            json!({ "id": "member-owned-start-attempt", "status": "in_progress" }),
            &test_ctx(),
        )
        .await
        .expect_err("coordinator cannot start member-owned task");
    match err {
        ToolError::InvalidParams(msg) => assert!(msg.contains("owning member")),
        other => panic!("expected InvalidParams, got {other:?}"),
    }
}

#[tokio::test]
async fn task_update_member_cannot_start_other_member_task_in_progress() {
    let _sandbox = task_tools_sandbox();
    let coord = ctx(COORDINATOR_MEMBER_ID);
    let create = TaskCreateTool::new(Arc::clone(&coord));
    create
        .execute_text(
            json!({
                "id": "bob-owned-start-attempt",
                "subject": "Bob owned start attempt",
                "owner_member_id": "m-bob"
            }),
            &test_ctx(),
        )
        .await
        .unwrap();

    let alice = ctx("m-alice");
    let update = TaskUpdateTool::new(Arc::clone(&alice));
    let err = update
        .execute_text(
            json!({ "id": "bob-owned-start-attempt", "status": "in_progress" }),
            &test_ctx(),
        )
        .await
        .expect_err("member cannot start another member's task");
    match err {
        ToolError::InvalidParams(msg) => assert!(msg.contains("owning member")),
        other => panic!("expected InvalidParams, got {other:?}"),
    }
}

#[tokio::test]
async fn task_update_shared_agent_member_can_start_own_task() {
    let _sandbox = task_tools_sandbox();
    let coord = shared_sde_ctx(None);
    let create = TaskCreateTool::new(Arc::clone(&coord));
    create
        .execute_text(
            json!({
                "id": "shared-member-owned-start",
                "subject": "Shared member owned start",
                "owner_member_id": "sde-planner"
            }),
            &test_ctx(),
        )
        .await
        .unwrap();

    let planner = shared_sde_ctx(Some("sde-planner"));
    let update = TaskUpdateTool::new(Arc::clone(&planner));
    let res = update
        .execute_text(
            json!({ "id": "shared-member-owned-start", "status": "in_progress" }),
            &test_ctx(),
        )
        .await
        .expect("shared-agent member starts own task");
    let value: Value = serde_json::from_str(&res).unwrap();
    assert_eq!(value["task"]["status"].as_str().unwrap(), "in_progress");
    assert_eq!(value["task"]["owner"].as_str().unwrap(), "sde-planner");
}

#[tokio::test]
async fn task_update_member_can_start_with_explicit_owner_member_id() {
    let _sandbox = task_tools_sandbox();
    let coord = ctx(COORDINATOR_MEMBER_ID);
    let create = TaskCreateTool::new(Arc::clone(&coord));
    create
        .execute_text(
            json!({ "id": "alice-start", "subject": "Alice start" }),
            &test_ctx(),
        )
        .await
        .unwrap();

    let alice = ctx("m-alice");
    let update = TaskUpdateTool::new(Arc::clone(&alice));
    let res = update
        .execute_text(
            json!({
                "id": "alice-start",
                "owner_member_id": "m-alice",
                "status": "in_progress"
            }),
            &test_ctx(),
        )
        .await
        .expect("member task_update starts explicit member-owned task");
    let value: Value = serde_json::from_str(&res).unwrap();
    assert_eq!(value["task"]["status"].as_str().unwrap(), "in_progress");
    assert_eq!(value["task"]["owner"].as_str().unwrap(), "m-alice");
}

#[tokio::test]
async fn task_update_reassign_dispatches_inbox() {
    let _sandbox = task_tools_sandbox();
    let ctx = ctx(COORDINATOR_MEMBER_ID);
    let create = TaskCreateTool::new(Arc::clone(&ctx));
    let res = create
        .execute_text(
            json!({ "subject": "S4", "owner_member_id": "m-alice" }),
            &test_ctx(),
        )
        .await
        .unwrap();
    let task_id = serde_json::from_str::<Value>(&res).unwrap()["task"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let update = TaskUpdateTool::new(Arc::clone(&ctx));
    let res = update
        .execute_text(
            json!({ "id": task_id, "owner_member_id": "m-bob" }),
            &test_ctx(),
        )
        .await
        .unwrap();
    let value: Value = serde_json::from_str(&res).unwrap();
    assert!(value["owner_changed"].as_bool().unwrap());
    assert!(value["task_assigned_dispatched"].as_bool().unwrap());
    let bob_inbox = AgentInboxStore::list_unread_for_member("m-bob", "run-tools-1").unwrap();
    assert_eq!(bob_inbox.len(), 1);
}

#[tokio::test]
async fn task_create_blocked_assigned_task_does_not_dispatch_until_unblocked() {
    let _sandbox = task_tools_sandbox();
    let ctx = ctx(COORDINATOR_MEMBER_ID);
    let create = TaskCreateTool::new(Arc::clone(&ctx));
    create
        .execute_text(
            json!({ "id": "blocker-task", "subject": "Blocker" }),
            &test_ctx(),
        )
        .await
        .unwrap();
    let blocked = create
        .execute_text(
            json!({
                "id": "blocked-task",
                "subject": "Blocked work",
                "owner_member_id": "m-alice",
                "blocked_by": ["blocker-task"]
            }),
            &test_ctx(),
        )
        .await
        .unwrap();
    let blocked_value: Value = serde_json::from_str(&blocked).unwrap();
    assert!(!blocked_value["task_assigned_dispatched"].as_bool().unwrap());
    let alice_before = AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1").unwrap();
    assert!(alice_before.is_empty());

    let update = TaskUpdateTool::new(Arc::clone(&ctx));
    let completed = update
        .execute_text(
            json!({ "id": "blocker-task", "status": "completed" }),
            &test_ctx(),
        )
        .await
        .unwrap();
    let completed_value: Value = serde_json::from_str(&completed).unwrap();
    assert_eq!(
        completed_value["unblocked_task_assigned_ids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["blocked-task"]
    );
    let alice_after = AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1").unwrap();
    assert_eq!(alice_after.len(), 1);
}

#[tokio::test]
async fn task_update_clearing_blockers_on_assigned_pending_dispatches_once() {
    let _sandbox = task_tools_sandbox();
    let ctx = ctx(COORDINATOR_MEMBER_ID);
    let create = TaskCreateTool::new(Arc::clone(&ctx));
    create
        .execute_text(
            json!({ "id": "manual-blocker", "subject": "Manual blocker" }),
            &test_ctx(),
        )
        .await
        .unwrap();
    create
        .execute_text(
            json!({
                "id": "manually-unblocked",
                "subject": "Manual unblock",
                "owner_member_id": "m-alice",
                "blocked_by": ["manual-blocker"]
            }),
            &test_ctx(),
        )
        .await
        .unwrap();
    assert!(
        AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1")
            .unwrap()
            .is_empty()
    );

    let update = TaskUpdateTool::new(Arc::clone(&ctx));
    let res = update
        .execute_text(
            json!({ "id": "manually-unblocked", "blocked_by": [] }),
            &test_ctx(),
        )
        .await
        .unwrap();
    let value: Value = serde_json::from_str(&res).unwrap();
    assert!(value["task_assigned_dispatched"].as_bool().unwrap());
    assert_eq!(
        AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1")
            .unwrap()
            .len(),
        1
    );

    let repeat = update
        .execute_text(
            json!({ "id": "manually-unblocked", "description": "metadata update" }),
            &test_ctx(),
        )
        .await
        .unwrap();
    let repeat_value: Value = serde_json::from_str(&repeat).unwrap();
    assert!(!repeat_value["task_assigned_dispatched"].as_bool().unwrap());
    assert_eq!(
        AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1")
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn task_update_unassign_does_not_dispatch_inbox() {
    let _sandbox = task_tools_sandbox();
    let ctx = ctx(COORDINATOR_MEMBER_ID);
    let create = TaskCreateTool::new(Arc::clone(&ctx));
    let res = create
        .execute_text(
            json!({ "subject": "S5", "owner_member_id": "m-alice" }),
            &test_ctx(),
        )
        .await
        .unwrap();
    let task_id = serde_json::from_str::<Value>(&res).unwrap()["task"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let before = AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1")
        .unwrap()
        .len();

    let update = TaskUpdateTool::new(Arc::clone(&ctx));
    let res = update
        .execute_text(
            json!({ "id": task_id, "owner_member_id": null }),
            &test_ctx(),
        )
        .await
        .unwrap();
    let value: Value = serde_json::from_str(&res).unwrap();
    assert!(value["owner_changed"].as_bool().unwrap());
    assert!(!value["task_assigned_dispatched"].as_bool().unwrap());
    let after = AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1")
        .unwrap()
        .len();
    assert_eq!(before, after);
}

#[tokio::test]
async fn task_update_status_deleted_removes_row() {
    let _sandbox = task_tools_sandbox();
    let ctx = ctx(COORDINATOR_MEMBER_ID);
    let create = TaskCreateTool::new(Arc::clone(&ctx));
    let res = create
        .execute_text(json!({ "subject": "S6" }), &test_ctx())
        .await
        .unwrap();
    let task_id = serde_json::from_str::<Value>(&res).unwrap()["task"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let update = TaskUpdateTool::new(Arc::clone(&ctx));
    let res = update
        .execute_text(json!({ "id": task_id, "status": "deleted" }), &test_ctx())
        .await
        .unwrap();
    let value: Value = serde_json::from_str(&res).unwrap();
    assert!(value["deleted"].as_bool().unwrap());
    assert!(AgentOrgTaskStore::get("run-tools-1", &task_id)
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn task_list_filters_by_owner_and_mine() {
    let _sandbox = task_tools_sandbox();
    let coord = ctx(COORDINATOR_MEMBER_ID);
    let create = TaskCreateTool::new(Arc::clone(&coord));
    for (subject, owner) in [("L1", Some("m-alice")), ("L2", Some("m-bob")), ("L3", None)] {
        let mut req = json!({ "subject": subject });
        if let Some(o) = owner {
            req["owner_member_id"] = json!(o);
        }
        create.execute_text(req, &test_ctx()).await.unwrap();
    }
    let coord_list = TaskListTool::new(Arc::clone(&coord));
    let res = coord_list
        .execute_text(json!({}), &test_ctx())
        .await
        .unwrap();
    let value: Value = serde_json::from_str(&res).unwrap();
    assert_eq!(value["total"].as_u64().unwrap(), 3);
    let res = coord_list
        .execute_text(json!({ "owner_member_id": "m-alice" }), &test_ctx())
        .await
        .unwrap();
    let value: Value = serde_json::from_str(&res).unwrap();
    assert_eq!(value["total"].as_u64().unwrap(), 1);
    // Alice only sees her tasks via mine_only.
    let alice = ctx("m-alice");
    let alice_list = TaskListTool::new(alice);
    let res = alice_list
        .execute_text(json!({ "mine_only": true }), &test_ctx())
        .await
        .unwrap();
    let value: Value = serde_json::from_str(&res).unwrap();
    assert_eq!(value["total"].as_u64().unwrap(), 1);
}

#[tokio::test]
async fn task_get_returns_full_row() {
    let _sandbox = task_tools_sandbox();
    let ctx = ctx(COORDINATOR_MEMBER_ID);
    let create = TaskCreateTool::new(Arc::clone(&ctx));
    let res = create
        .execute_text(
            json!({ "subject": "G1", "description": "details" }),
            &test_ctx(),
        )
        .await
        .unwrap();
    let task_id = serde_json::from_str::<Value>(&res).unwrap()["task"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let get = TaskGetTool::new(Arc::clone(&ctx));
    let res = get
        .execute_text(json!({ "id": task_id }), &test_ctx())
        .await
        .unwrap();
    let value: Value = serde_json::from_str(&res).unwrap();
    assert_eq!(value["task"]["subject"], "G1");
    assert_eq!(value["task"]["description"], "details");
}

use database::db::get_connection;

use super::*;

fn make_params(org_run_id: &str, id: &str, subject: &str) -> CreateTaskParams {
    CreateTaskParams {
        id: id.into(),
        org_run_id: org_run_id.into(),
        subject: subject.into(),
        description: String::new(),
        active_form: None,
        owner: None,
        status: TaskStatus::Pending,
        blocks: Vec::new(),
        blocked_by: Vec::new(),
        metadata: None,
    }
}

fn task_store_sandbox() -> test_helpers::test_env::SandboxGuard {
    let sandbox = test_helpers::test_env::sandbox();
    let conn = get_connection().expect("test sqlite connection");
    crate::coordination::agent_inbox::init_schema(&conn).expect("agent inbox schema");
    init_schema(&conn).expect("agent team tasks schema");
    sandbox
}

#[test]
fn task_status_wire_round_trip() {
    for status in [
        TaskStatus::Pending,
        TaskStatus::InProgress,
        TaskStatus::Completed,
    ] {
        assert_eq!(TaskStatus::from_wire(status.as_wire()).unwrap(), status);
    }
    assert!(TaskStatus::from_wire("garbage").is_err());
}

#[test]
fn create_get_round_trip() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    let task_id = new_task_id();

    let mut params = make_params(&run_id, &task_id, "Write tests");
    params.description = "all the tests".into();
    params.active_form = Some("Writing tests".into());
    params.metadata = Some(serde_json::json!({"priority": "high"}));
    let created = AgentOrgTaskStore::create(params).unwrap();

    let fetched = AgentOrgTaskStore::get(&run_id, &task_id).unwrap().unwrap();
    assert_eq!(fetched.id, task_id);
    assert_eq!(fetched.subject, "Write tests");
    assert_eq!(fetched.description, "all the tests");
    assert_eq!(fetched.active_form.as_deref(), Some("Writing tests"));
    assert_eq!(fetched.status, TaskStatus::Pending);
    assert!(fetched.owner.is_none());
    assert_eq!(
        fetched.metadata.as_ref().and_then(|m| m.get("priority")),
        Some(&serde_json::Value::String("high".into()))
    );
    assert_eq!(created.created_at, fetched.created_at);
}

#[test]
fn create_rejects_blank_subject_and_id() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());

    let mut bad = make_params(&run_id, "task-1", "");
    bad.subject = "   ".into();
    assert!(AgentOrgTaskStore::create(bad).is_err());

    let bad_id = make_params(&run_id, "   ", "ok");
    assert!(AgentOrgTaskStore::create(bad_id).is_err());
}

#[test]
fn create_rejects_in_progress_without_owner() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    let mut params = make_params(&run_id, "task-1", "ownerless running");
    params.status = TaskStatus::InProgress;

    let err = AgentOrgTaskStore::create(params).unwrap_err();
    assert!(
        err.contains("in_progress task must have an owner"),
        "got {err}"
    );
}

#[test]
fn update_rejects_ownerless_in_progress_state() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    AgentOrgTaskStore::create(make_params(&run_id, "task-1", "claim me")).unwrap();

    let err = AgentOrgTaskStore::update(
        &run_id,
        "task-1",
        UpdateTaskPatch {
            status: Some(TaskStatus::InProgress),
            owner: Some(None),
            ..Default::default()
        },
    )
    .unwrap_err();
    assert!(
        err.contains("in_progress task must have an owner"),
        "got {err}"
    );
}

#[test]
fn list_scopes_by_run_id() {
    let _sandbox = task_store_sandbox();
    let run_a = format!("run-{}", uuid::Uuid::new_v4());
    let run_b = format!("run-{}", uuid::Uuid::new_v4());

    AgentOrgTaskStore::create(make_params(&run_a, "a-1", "one")).unwrap();
    AgentOrgTaskStore::create(make_params(&run_a, "a-2", "two")).unwrap();
    AgentOrgTaskStore::create(make_params(&run_b, "b-1", "other")).unwrap();

    let listed_a = AgentOrgTaskStore::list(&run_a).unwrap();
    assert_eq!(listed_a.len(), 2);
    assert!(listed_a.iter().all(|t| t.org_run_id == run_a));

    let listed_b = AgentOrgTaskStore::list(&run_b).unwrap();
    assert_eq!(listed_b.len(), 1);
    assert_eq!(listed_b[0].id, "b-1");
}

#[test]
fn update_applies_patch_and_clears_owner() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    let mut params = make_params(&run_id, "t-1", "draft subject");
    params.owner = Some("member-alpha".into());
    params.status = TaskStatus::InProgress;
    AgentOrgTaskStore::create(params).unwrap();

    let updated = AgentOrgTaskStore::update(
        &run_id,
        "t-1",
        UpdateTaskPatch {
            subject: Some("final subject".into()),
            description: Some("filled in".into()),
            status: Some(TaskStatus::Completed),
            owner: Some(None),
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(updated.subject, "final subject");
    assert_eq!(updated.description, "filled in");
    assert_eq!(updated.status, TaskStatus::Completed);
    assert!(updated.owner.is_none());

    // updated_at must have advanced (or at least be present and different
    // shape — we can't assert strict > because RFC3339 strings may match
    // when the test runs faster than 1s; presence + rewrite is enough).
    assert!(!updated.updated_at.is_empty());
}

#[test]
fn update_missing_returns_error() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    let err =
        AgentOrgTaskStore::update(&run_id, "missing", UpdateTaskPatch::default()).unwrap_err();
    assert!(err.contains("task_not_found"), "got {err}");
}

#[test]
fn create_rejects_self_dependency_cycle() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    let mut params = make_params(&run_id, "self", "self cycle");
    params.blocked_by = vec!["self".into()];

    let err = AgentOrgTaskStore::create(params).unwrap_err();
    assert!(err.contains(TASK_DEPENDENCY_CYCLE_ERROR), "got {err}");
}

#[test]
fn update_rejects_dependency_cycle_across_blocks_and_blocked_by() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    let mut first = make_params(&run_id, "first", "first");
    first.blocks = vec!["second".into()];
    AgentOrgTaskStore::create(first).unwrap();
    AgentOrgTaskStore::create(make_params(&run_id, "second", "second")).unwrap();

    let err = AgentOrgTaskStore::update(
        &run_id,
        "second",
        UpdateTaskPatch {
            blocks: Some(vec!["first".into()]),
            ..Default::default()
        },
    )
    .unwrap_err();
    assert!(err.contains(TASK_DEPENDENCY_CYCLE_ERROR), "got {err}");

    let second = AgentOrgTaskStore::get(&run_id, "second").unwrap().unwrap();
    assert!(second.blocks.is_empty());
}

#[test]
fn dependency_cycle_validation_is_scoped_by_run() {
    let _sandbox = task_store_sandbox();
    let run_a = format!("run-a-{}", uuid::Uuid::new_v4());
    let run_b = format!("run-b-{}", uuid::Uuid::new_v4());

    let mut first = make_params(&run_a, "first", "first");
    first.blocks = vec!["second".into()];
    AgentOrgTaskStore::create(first).unwrap();

    let mut second = make_params(&run_b, "second", "second");
    second.blocked_by = vec!["first".into()];
    AgentOrgTaskStore::create(second).unwrap();
}

#[test]
fn delete_removes_row() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    AgentOrgTaskStore::create(make_params(&run_id, "t-1", "to delete")).unwrap();

    assert!(AgentOrgTaskStore::delete(&run_id, "t-1").unwrap());
    assert!(AgentOrgTaskStore::get(&run_id, "t-1").unwrap().is_none());
    assert!(!AgentOrgTaskStore::delete(&run_id, "t-1").unwrap());
}

#[test]
fn try_claim_happy_path_sets_owner_and_in_progress() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    AgentOrgTaskStore::create(make_params(&run_id, "t-1", "claim me")).unwrap();

    let claimed =
        AgentOrgTaskStore::try_claim(&run_id, "t-1", "member-alpha", ClaimOptions::default())
            .unwrap();
    assert_eq!(claimed.owner.as_deref(), Some("member-alpha"));
    assert_eq!(claimed.status, TaskStatus::InProgress);
}

#[test]
fn requeue_in_progress_for_owner_keeps_owner_and_releases_status() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    AgentOrgTaskStore::create(make_params(&run_id, "t-1", "claim me")).unwrap();
    AgentOrgTaskStore::try_claim(&run_id, "t-1", "member-alpha", ClaimOptions::default()).unwrap();

    let requeued = AgentOrgTaskStore::requeue_in_progress_for_owner(&run_id, "member-alpha")
        .expect("requeue in-progress work");

    assert_eq!(requeued.len(), 1);
    assert_eq!(requeued[0].owner.as_deref(), Some("member-alpha"));
    assert_eq!(requeued[0].status, TaskStatus::Pending);
    let stored = AgentOrgTaskStore::get(&run_id, "t-1").unwrap().unwrap();
    assert_eq!(stored.owner.as_deref(), Some("member-alpha"));
    assert_eq!(stored.status, TaskStatus::Pending);
}

#[test]
fn task_history_records_create_claim_update_and_release() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    AgentOrgTaskStore::create(make_params(&run_id, "t-1", "history")).unwrap();
    AgentOrgTaskStore::try_claim(&run_id, "t-1", "member-alpha", ClaimOptions::default()).unwrap();
    AgentOrgTaskStore::update(
        &run_id,
        "t-1",
        UpdateTaskPatch {
            status: Some(TaskStatus::Completed),
            ..Default::default()
        },
    )
    .unwrap();
    AgentOrgTaskStore::update(
        &run_id,
        "t-1",
        UpdateTaskPatch {
            status: Some(TaskStatus::InProgress),
            owner: Some(Some("member-alpha".to_string())),
            ..Default::default()
        },
    )
    .unwrap();
    AgentOrgTaskStore::unassign_for_owner(&run_id, "member-alpha").unwrap();

    let history = AgentOrgTaskStore::list_history(&run_id).unwrap();
    let event_types: Vec<&str> = history
        .iter()
        .map(|event| event.event_type.as_str())
        .collect();
    assert_eq!(
        event_types,
        vec![
            TASK_EVENT_CREATED,
            TASK_EVENT_CLAIMED,
            TASK_EVENT_UPDATED,
            TASK_EVENT_UPDATED,
            TASK_EVENT_RELEASED
        ]
    );
    let claimed = &history[1];
    assert_eq!(claimed.previous_owner, None);
    assert_eq!(claimed.next_owner.as_deref(), Some("member-alpha"));
    assert_eq!(claimed.previous_status, Some(TaskStatus::Pending));
    assert_eq!(claimed.next_status, Some(TaskStatus::InProgress));
    let released = history.last().unwrap();
    assert_eq!(released.previous_owner.as_deref(), Some("member-alpha"));
    assert_eq!(released.next_owner, None);
    assert_eq!(released.next_status, Some(TaskStatus::Pending));
}

#[test]
fn try_claim_returns_task_not_found() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    let err =
        AgentOrgTaskStore::try_claim(&run_id, "missing", "member-alpha", ClaimOptions::default())
            .unwrap_err();
    assert_eq!(err, ClaimError::TaskNotFound);
}

#[test]
fn try_claim_already_claimed_by_other_member() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    AgentOrgTaskStore::create(make_params(&run_id, "t-1", "claim me")).unwrap();
    AgentOrgTaskStore::try_claim(&run_id, "t-1", "member-alpha", ClaimOptions::default()).unwrap();

    let err = AgentOrgTaskStore::try_claim(&run_id, "t-1", "member-beta", ClaimOptions::default())
        .unwrap_err();
    match err {
        ClaimError::AlreadyClaimed { current_owner } => {
            assert_eq!(current_owner, "member-alpha");
        }
        other => panic!("expected AlreadyClaimed, got {other:?}"),
    }
}

#[test]
fn try_claim_idempotent_for_current_owner() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    AgentOrgTaskStore::create(make_params(&run_id, "t-1", "claim me")).unwrap();
    AgentOrgTaskStore::try_claim(&run_id, "t-1", "member-alpha", ClaimOptions::default()).unwrap();
    let again =
        AgentOrgTaskStore::try_claim(&run_id, "t-1", "member-alpha", ClaimOptions::default())
            .unwrap();
    assert_eq!(again.owner.as_deref(), Some("member-alpha"));
    assert_eq!(again.status, TaskStatus::InProgress);
}

#[test]
fn try_claim_already_resolved_takes_priority_over_ownership() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    let mut params = make_params(&run_id, "t-1", "done");
    params.owner = Some("member-alpha".into());
    params.status = TaskStatus::Completed;
    AgentOrgTaskStore::create(params).unwrap();

    let err = AgentOrgTaskStore::try_claim(&run_id, "t-1", "member-alpha", ClaimOptions::default())
        .unwrap_err();
    match err {
        ClaimError::AlreadyResolved { status } => {
            assert_eq!(status, TaskStatus::Completed);
        }
        other => panic!("expected AlreadyResolved, got {other:?}"),
    }
}

#[test]
fn try_claim_blocked_lists_unresolved_blockers() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    AgentOrgTaskStore::create(make_params(&run_id, "blocker-1", "first")).unwrap();
    let mut blocker_completed = make_params(&run_id, "blocker-2", "second");
    blocker_completed.status = TaskStatus::Completed;
    AgentOrgTaskStore::create(blocker_completed).unwrap();
    let mut dependent = make_params(&run_id, "dep", "depends");
    dependent.blocked_by = vec!["blocker-1".into(), "blocker-2".into()];
    AgentOrgTaskStore::create(dependent).unwrap();

    let err = AgentOrgTaskStore::try_claim(&run_id, "dep", "member-alpha", ClaimOptions::default())
        .unwrap_err();
    match err {
        ClaimError::Blocked { by_task_ids } => {
            assert_eq!(by_task_ids, vec!["blocker-1".to_string()]);
        }
        other => panic!("expected Blocked, got {other:?}"),
    }
}

#[test]
fn try_claim_member_busy_only_when_option_enabled() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    AgentOrgTaskStore::create(make_params(&run_id, "t-1", "first")).unwrap();
    AgentOrgTaskStore::create(make_params(&run_id, "t-2", "second")).unwrap();

    AgentOrgTaskStore::try_claim(&run_id, "t-1", "member-alpha", ClaimOptions::default()).unwrap();

    // With default options the second claim succeeds.
    let _ok = AgentOrgTaskStore::try_claim(&run_id, "t-2", "member-alpha", ClaimOptions::default())
        .unwrap();

    // Reset t-2 (unassign + pending) so we can rerun with the strict flag.
    AgentOrgTaskStore::update(
        &run_id,
        "t-2",
        UpdateTaskPatch {
            owner: Some(None),
            status: Some(TaskStatus::Pending),
            ..Default::default()
        },
    )
    .unwrap();

    let err = AgentOrgTaskStore::try_claim(
        &run_id,
        "t-2",
        "member-alpha",
        ClaimOptions {
            check_member_busy: true,
        },
    )
    .unwrap_err();
    match err {
        ClaimError::MemberBusy { busy_with } => assert_eq!(busy_with, "t-1"),
        other => panic!("expected MemberBusy, got {other:?}"),
    }
}

#[test]
fn find_available_skips_owned_blocked_and_resolved() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());

    // Owned (in progress)
    let mut owned = make_params(&run_id, "owned", "in flight");
    owned.owner = Some("member-alpha".into());
    owned.status = TaskStatus::InProgress;
    AgentOrgTaskStore::create(owned).unwrap();

    // Completed
    let mut done = make_params(&run_id, "done", "done");
    done.status = TaskStatus::Completed;
    AgentOrgTaskStore::create(done).unwrap();

    // Blocked by an unresolved blocker
    AgentOrgTaskStore::create(make_params(&run_id, "blocker", "first")).unwrap();
    let mut blocked = make_params(&run_id, "blocked", "wait");
    blocked.blocked_by = vec!["blocker".into()];
    AgentOrgTaskStore::create(blocked).unwrap();

    // Available
    AgentOrgTaskStore::create(make_params(&run_id, "free", "ready")).unwrap();

    let picked = AgentOrgTaskStore::find_available(&run_id).unwrap().unwrap();
    // `blocker` is the first unclaimed pending in insertion order.
    assert_eq!(picked.id, "blocker");

    // Claim blocker, complete it, and then `free` must surface.
    let _ =
        AgentOrgTaskStore::try_claim(&run_id, "blocker", "member-alpha", ClaimOptions::default())
            .unwrap();
    AgentOrgTaskStore::update(
        &run_id,
        "blocker",
        UpdateTaskPatch {
            status: Some(TaskStatus::Completed),
            ..Default::default()
        },
    )
    .unwrap();

    let next = AgentOrgTaskStore::find_available(&run_id).unwrap().unwrap();
    // Once `blocker` is completed, both `blocked` and `free` are ready;
    // insertion order makes `blocked` win.
    assert_eq!(next.id, "blocked");
}

#[test]
fn concurrent_claim_only_one_winner() {
    // Race two threads on the same task. SQLite IMMEDIATE transactions
    // serialise them; the loser must observe AlreadyClaimed.
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    AgentOrgTaskStore::create(make_params(&run_id, "race", "contested")).unwrap();

    let run_id_clone = run_id.clone();
    let handle = std::thread::spawn(move || {
        AgentOrgTaskStore::try_claim(
            &run_id_clone,
            "race",
            "member-thread",
            ClaimOptions::default(),
        )
    });
    let main_result =
        AgentOrgTaskStore::try_claim(&run_id, "race", "member-main", ClaimOptions::default());
    let thread_result = handle.join().expect("thread join");

    let mut successes = 0;
    let mut already_claimed = 0;
    for result in [main_result, thread_result] {
        match result {
            Ok(task) => {
                successes += 1;
                assert!(matches!(task.status, TaskStatus::InProgress));
                assert!(matches!(
                    task.owner.as_deref(),
                    Some("member-thread") | Some("member-main")
                ));
            }
            Err(ClaimError::AlreadyClaimed { .. }) => already_claimed += 1,
            Err(other) => panic!("unexpected race outcome: {other:?}"),
        }
    }
    assert_eq!(successes, 1, "exactly one claimer should win");
    assert_eq!(already_claimed, 1, "the other should see AlreadyClaimed");

    let stored = AgentOrgTaskStore::get(&run_id, "race").unwrap().unwrap();
    assert!(matches!(stored.status, TaskStatus::InProgress));
    assert!(matches!(
        stored.owner.as_deref(),
        Some("member-thread") | Some("member-main")
    ));

    let claim_events = AgentOrgTaskStore::list_history(&run_id)
        .unwrap()
        .into_iter()
        .filter(|event| event.event_type == TASK_EVENT_CLAIMED)
        .collect::<Vec<_>>();
    assert_eq!(claim_events.len(), 1, "only the winning claim is persisted");
    assert_eq!(claim_events[0].next_owner, stored.owner);
}

#[test]
fn enqueue_task_assigned_writes_inbox_row() {
    use crate::core::coordination::agent_inbox::{AgentInboxStore, AgentMessage};

    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());

    let mut params = make_params(&run_id, "task-1", "Pagination");
    params.description = "Cursor-based".into();
    params.owner = Some("member-alice".into());
    params.status = TaskStatus::InProgress;
    let task = AgentOrgTaskStore::create(params).unwrap();

    let row_id = enqueue_task_assigned_to(
        &task,
        "alice-agent",
        "member-alice",
        "coord-agent",
        Some("coordinator"),
        "Coordinator",
    )
    .unwrap();
    assert!(row_id > 0);

    let pending =
        AgentInboxStore::list_unread_for_member("member-alice", &run_id).expect("list_unread");
    assert_eq!(pending.len(), 1, "one TaskAssigned row should be pending");
    let row = &pending[0];
    assert_eq!(row.payload_kind, "task_assigned");
    assert_eq!(row.sender_agent_id, "coord-agent");
    assert_eq!(row.sender_member_id.as_deref(), Some("coordinator"));
    assert_eq!(row.recipient_agent_id, "alice-agent");
    assert_eq!(row.org_run_id.as_deref(), Some(run_id.as_str()));

    let decoded = row.decode_payload().expect("decode");
    match decoded {
        AgentMessage::TaskAssigned {
            task_id,
            subject,
            description,
            assigned_by,
        } => {
            assert_eq!(task_id, "task-1");
            assert_eq!(subject, "Pagination");
            assert_eq!(description, "Cursor-based");
            assert_eq!(assigned_by, "Coordinator");
        }
        other => panic!("expected TaskAssigned, got {other:?}"),
    }
}

#[test]
fn enqueue_task_assigned_rejects_unowned_task() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    let task = AgentOrgTaskStore::create(make_params(&run_id, "task-2", "subj")).unwrap();
    // No owner set → enqueue must fail with a structured error so the
    // caller (task tools / autonomous claim) can surface it back to
    // the LLM rather than silently dropping the row.
    let err = enqueue_task_assigned_to(
        &task,
        "worker-agent",
        "member-worker",
        "_system",
        None,
        "system",
    )
    .unwrap_err();
    assert!(err.contains("unowned"), "{err}");
}

#[test]
fn enqueue_task_assigned_self_claim_uses_system_sender() {
    use crate::core::coordination::agent_inbox::{AgentInboxStore, SYSTEM_SENDER_ID};

    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());

    AgentOrgTaskStore::create(make_params(&run_id, "task-self", "Refactor")).unwrap();
    let claimed = AgentOrgTaskStore::try_claim(
        &run_id,
        "task-self",
        "member-alice",
        ClaimOptions::default(),
    )
    .unwrap();

    // Autonomous self-claim path: sender is the system, even though
    // the recipient = claimant. Self-claim notifications route
    // through the system inbox writer rather than the worker
    // writing into its own mailbox.
    enqueue_task_assigned_to(
        &claimed,
        "alice-agent",
        "member-alice",
        SYSTEM_SENDER_ID,
        None,
        "system",
    )
    .unwrap();

    let pending = AgentInboxStore::list_unread_for_member("member-alice", &run_id).unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].sender_agent_id, SYSTEM_SENDER_ID);
}

#[test]
fn unassign_for_owner_clears_owner_and_resets_status() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());

    AgentOrgTaskStore::create(make_params(&run_id, "t1", "S1")).unwrap();
    AgentOrgTaskStore::create(make_params(&run_id, "t2", "S2")).unwrap();
    AgentOrgTaskStore::create(make_params(&run_id, "t3", "S3")).unwrap();
    AgentOrgTaskStore::try_claim(&run_id, "t1", "alice", ClaimOptions::default()).unwrap();
    AgentOrgTaskStore::try_claim(&run_id, "t2", "alice", ClaimOptions::default()).unwrap();
    // Mark t2 completed; unassign should leave it alone.
    AgentOrgTaskStore::update(
        &run_id,
        "t2",
        UpdateTaskPatch {
            status: Some(TaskStatus::Completed),
            ..Default::default()
        },
    )
    .unwrap();
    // t3 owned by bob — must not be touched.
    AgentOrgTaskStore::try_claim(&run_id, "t3", "bob", ClaimOptions::default()).unwrap();

    let unassigned = AgentOrgTaskStore::unassign_for_owner(&run_id, "alice").unwrap();
    assert_eq!(unassigned.len(), 1);
    assert_eq!(unassigned[0].id, "t1");
    assert!(unassigned[0].owner.is_none());
    assert_eq!(unassigned[0].status, TaskStatus::Pending);

    // t2 stays completed + owned, t3 stays owned by bob.
    let t2 = AgentOrgTaskStore::get(&run_id, "t2").unwrap().unwrap();
    assert_eq!(t2.status, TaskStatus::Completed);
    assert_eq!(t2.owner.as_deref(), Some("alice"));
    let t3 = AgentOrgTaskStore::get(&run_id, "t3").unwrap().unwrap();
    assert_eq!(t3.owner.as_deref(), Some("bob"));
}

#[test]
fn has_open_task_for_owner_excludes_completed() {
    let _sandbox = task_store_sandbox();
    let run_id = format!("run-{}", uuid::Uuid::new_v4());
    assert!(!AgentOrgTaskStore::has_open_task_for_owner(&run_id, "alice").unwrap());

    AgentOrgTaskStore::create(make_params(&run_id, "h1", "S1")).unwrap();
    AgentOrgTaskStore::try_claim(&run_id, "h1", "alice", ClaimOptions::default()).unwrap();
    assert!(AgentOrgTaskStore::has_open_task_for_owner(&run_id, "alice").unwrap());

    AgentOrgTaskStore::update(
        &run_id,
        "h1",
        UpdateTaskPatch {
            status: Some(TaskStatus::Completed),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(!AgentOrgTaskStore::has_open_task_for_owner(&run_id, "alice").unwrap());
}

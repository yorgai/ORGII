use std::collections::{HashMap, HashSet};

use super::{Task, TASK_DEPENDENCY_CYCLE_ERROR};

pub(super) fn validate_dependency_graph_after_upsert(
    existing_tasks: &[Task],
    org_run_id: &str,
    task_id: &str,
    blocks: &[String],
    blocked_by: &[String],
) -> Result<(), String> {
    if blocks.iter().any(|id| id == task_id) || blocked_by.iter().any(|id| id == task_id) {
        return Err(format!(
            "{TASK_DEPENDENCY_CYCLE_ERROR}: task '{task_id}' cannot depend on itself"
        ));
    }

    let mut graph: HashMap<String, Vec<String>> = HashMap::new();
    let mut candidate_seen = false;
    for task in existing_tasks {
        if task.org_run_id != org_run_id {
            continue;
        }
        let (current_blocks, current_blocked_by) = if task.id == task_id {
            candidate_seen = true;
            (blocks, blocked_by)
        } else {
            (task.blocks.as_slice(), task.blocked_by.as_slice())
        };
        add_dependency_edges(&mut graph, &task.id, current_blocks, current_blocked_by);
    }
    if !candidate_seen {
        add_dependency_edges(&mut graph, task_id, blocks, blocked_by);
    }

    reject_dependency_cycle(&graph)
}

pub(super) fn add_dependency_edges(
    graph: &mut HashMap<String, Vec<String>>,
    task_id: &str,
    blocks: &[String],
    blocked_by: &[String],
) {
    graph.entry(task_id.to_string()).or_default();
    for blocker_id in blocked_by {
        graph
            .entry(task_id.to_string())
            .or_default()
            .push(blocker_id.clone());
        graph.entry(blocker_id.clone()).or_default();
    }
    for downstream_id in blocks {
        graph
            .entry(downstream_id.clone())
            .or_default()
            .push(task_id.to_string());
        graph.entry(task_id.to_string()).or_default();
    }
}

pub(super) fn reject_dependency_cycle(graph: &HashMap<String, Vec<String>>) -> Result<(), String> {
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    let mut stack = Vec::new();
    for node in graph.keys() {
        visit_dependency_node(graph, node, &mut visiting, &mut visited, &mut stack)?;
    }
    Ok(())
}

pub(super) fn visit_dependency_node(
    graph: &HashMap<String, Vec<String>>,
    node: &str,
    visiting: &mut HashSet<String>,
    visited: &mut HashSet<String>,
    stack: &mut Vec<String>,
) -> Result<(), String> {
    if visited.contains(node) {
        return Ok(());
    }
    if visiting.contains(node) {
        let start = stack.iter().position(|item| item == node).unwrap_or(0);
        let mut cycle = stack[start..].to_vec();
        cycle.push(node.to_string());
        return Err(format!(
            "{TASK_DEPENDENCY_CYCLE_ERROR}: {}",
            cycle.join(" -> ")
        ));
    }

    visiting.insert(node.to_string());
    stack.push(node.to_string());
    if let Some(next_nodes) = graph.get(node) {
        for next_node in next_nodes {
            visit_dependency_node(graph, next_node, visiting, visited, stack)?;
        }
    }
    stack.pop();
    visiting.remove(node);
    visited.insert(node.to_string());
    Ok(())
}

pub(super) fn blockers_resolved(all: &[Task], blocked_by: &[String]) -> bool {
    if blocked_by.is_empty() {
        return true;
    }
    for blocker_id in blocked_by {
        let resolved = all
            .iter()
            .find(|task| &task.id == blocker_id)
            .map(|task| task.status.is_resolved())
            .unwrap_or(false);
        if !resolved {
            return false;
        }
    }
    true
}

pub(super) fn unresolved_blockers(all: &[Task], blocked_by: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for blocker_id in blocked_by {
        let resolved = all
            .iter()
            .find(|task| &task.id == blocker_id)
            .map(|task| task.status.is_resolved())
            .unwrap_or(false);
        if !resolved {
            out.push(blocker_id.clone());
        }
    }
    out
}

pub(super) fn find_busy_task(
    all: &[Task],
    owner_member_id: &str,
    except_task_id: &str,
) -> Option<String> {
    for task in all {
        if task.id == except_task_id {
            continue;
        }
        if task.status.is_resolved() {
            continue;
        }
        if task.owner.as_deref() == Some(owner_member_id) {
            return Some(task.id.clone());
        }
    }
    None
}

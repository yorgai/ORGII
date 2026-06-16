//! Shell command and await_output extractors.

use super::git_artifacts::{parse_git_artifacts, GitArtifactParseInput};
use super::helpers::{get_failure_data, get_success_data, obj_f64, obj_i64, obj_str, safe_str};
use crate::agent_sessions::event_pipeline::extractors::types::*;

pub(super) fn extract_shell(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedShellData {
    let result_map = result.cloned().unwrap_or_default();
    let success = get_success_data(&result_map);
    let failure = get_failure_data(&result_map);
    let is_failure = !failure.is_empty() && success.is_empty();

    let command_data = if !success.is_empty() {
        &success
    } else {
        &failure
    };

    let command = obj_str(command_data, "command")
        .or_else(|| args.and_then(|a| obj_str(a, "command")))
        .or_else(|| result.and_then(|r| obj_str(r, "command")))
        .unwrap_or_default();

    let stdout =
        obj_str(command_data, "stdout").or_else(|| result.and_then(|r| obj_str(r, "stdout")));
    let stderr =
        obj_str(command_data, "stderr").or_else(|| result.and_then(|r| obj_str(r, "stderr")));
    let interleaved = obj_str(command_data, "interleavedOutput")
        .or_else(|| obj_str(command_data, "interleaved_output"));
    let stream_output = args.and_then(|a| obj_str(a, "streamOutput"));

    let output = interleaved
        .or(stdout)
        .or(stderr)
        .or(stream_output)
        .or_else(|| result.and_then(|r| r.get("output").and_then(safe_str)))
        .or_else(|| result.and_then(|r| obj_str(r, "observation")));

    let exit_code = obj_i64(command_data, "exitCode")
        .or_else(|| obj_i64(command_data, "exit_code"))
        .or_else(|| result.and_then(|r| obj_i64(r, "exit_code")));

    let execution_time =
        obj_f64(command_data, "executionTime").or_else(|| obj_f64(command_data, "execution_time"));

    let cwd = args.and_then(|a| obj_str(a, "cwd"));

    let description = args.and_then(|a| obj_str(a, "description"));
    let kill_handle = args.and_then(|a| obj_str(a, "kill_handle"));
    let action = args.and_then(|a| match a.get("action") {
        Some(serde_json::Value::String(s)) => Some(s.clone()),
        _ => None,
    });
    let stream_output_owned = args.and_then(|a| obj_str(a, "streamOutput"));
    let shell_pid = args.and_then(|a| obj_i64(a, "shellPid"));
    let shell_process_status = args.and_then(|a| obj_str(a, "shellProcessStatus"));
    let shell_log_path = args.and_then(|a| obj_str(a, "shellLogPath"));

    let git_artifacts = {
        let artifacts = parse_git_artifacts(GitArtifactParseInput {
            command: &command,
            output: output.as_deref(),
            exit_code,
        });
        if artifacts.is_empty() {
            None
        } else {
            Some(artifacts)
        }
    };

    ExtractedShellData {
        command,
        action,
        kill_handle,
        description,
        output,
        stream_output: stream_output_owned,
        exit_code,
        cwd,
        execution_time,
        is_failure,
        shell_pid,
        shell_process_status,
        shell_log_path,
        git_artifacts,
    }
}

pub(super) fn extract_await(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedAwaitData {
    let handle = args.and_then(|a| obj_str(a, "handle").or_else(|| obj_str(a, "pid")));
    let block_until_ms = args.and_then(|a| obj_i64(a, "block_until_ms"));

    let result_text = match result {
        Some(r) => match r.get("output") {
            Some(serde_json::Value::String(s)) => Some(s.clone()),
            _ => obj_str(r, "output").or_else(|| obj_str(r, "text")),
        },
        None => None,
    };

    ExtractedAwaitData {
        handle,
        block_until_ms,
        result_text,
    }
}

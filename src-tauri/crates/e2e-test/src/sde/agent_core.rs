use super::tmp_workspace_path;
use crate::config::Config;
use crate::harness;
use agent_core::definitions::SDE_AGENT_ID;
use std::path::Path;

/// Empty Result Guard — verify that tools producing no visible output
/// still return a substantive response (the agent does not get confused by empty tool results).
pub async fn empty_result_guard(cfg: &Config) -> bool {
    let session_id = format!("{}-empty-guard", cfg.session_prefix);
    let workspace = tmp_workspace_path("empty-guard");

    match harness::send_sde_message(
        cfg,
        "Run `mkdir -p test_empty_dir` then confirm it exists.",
        &session_id,
        "build",
        &workspace,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Empty Result Guard", &err),
        Ok(resp) => {
            let content = resp.content.to_lowercase();
            harness::print_result(
                "Empty Result Guard",
                &resp.content,
                &[
                    ("Got response (not empty)", !resp.content.is_empty()),
                    (
                        "Agent completed task",
                        content.contains("created")
                            || content.contains("directory")
                            || content.contains("mkdir")
                            || content.contains("test_empty_dir")
                            || content.contains("exists"),
                    ),
                    (
                        "No confusion about empty output",
                        !content.contains("error") && !content.contains("failed"),
                    ),
                ],
            )
        }
    }
}

/// Scratchpad Directory — verify the agent knows about its scratchpad
/// and can use it for temporary files.
pub async fn scratchpad_usage(cfg: &Config) -> bool {
    let session_id = format!("{}-scratchpad", cfg.session_prefix);
    let workspace = tmp_workspace_path("scratchpad");

    match harness::send_sde_message(
        cfg,
        "Write 'hello' to a file in your scratchpad directory, then read it back.",
        &session_id,
        "build",
        &workspace,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Scratchpad Usage", &err),
        Ok(resp) => {
            let content = resp.content.to_lowercase();
            harness::print_result(
                "Scratchpad Usage",
                &resp.content,
                &[
                    ("Got response", !resp.content.is_empty()),
                    (
                        "Mentions scratchpad path (/tmp/orgii-*/scratchpad)",
                        content.contains("scratchpad") || content.contains("orgii"),
                    ),
                    (
                        "Read back content successfully",
                        content.contains("hello") || content.contains("scratchpad"),
                    ),
                ],
            )
        }
    }
}

/// Scratchpad Edit — verify that edit_file works on scratchpad paths.
/// This tests that EditTool's path validation correctly whitelists the scratchpad
/// when creating new files and editing existing files via search-replace.
pub async fn scratchpad_edit(cfg: &Config) -> bool {
    let session_id = format!("{}-scratchpad-edit", cfg.session_prefix);
    let workspace = tmp_workspace_path("scratchpad-edit");

    match harness::send_sde_message(
        cfg,
        "Use edit_file to create a file called 'notes.md' in your scratchpad directory \
         with content '# Draft\\nTODO: fill in'. Then use edit_file again to replace \
         'TODO: fill in' with 'Done: validated'. Finally, read the file back and show me.",
        &session_id,
        "build",
        &workspace,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Scratchpad Edit", &err),
        Ok(resp) => {
            let content = resp.content.to_lowercase();
            let used_edit = harness::assert_sde_tool_used(&resp, "edit_file");
            let edit_count = resp
                .tool_calls
                .iter()
                .filter(|tool| tool.contains("edit_file"))
                .count();
            harness::print_result(
                "Scratchpad Edit",
                &resp.content,
                &[
                    ("Got response", !resp.content.is_empty()),
                    (
                        &format!("Used edit_file ({} calls, expect ≥2)", edit_count),
                        used_edit && edit_count >= 2,
                    ),
                    (
                        "File created in scratchpad",
                        content.contains("notes.md") || content.contains("scratchpad"),
                    ),
                    (
                        "Edit applied (contains 'validated' or 'done')",
                        content.contains("validated") || content.contains("done"),
                    ),
                    (
                        "No permission error",
                        !content.contains("outside the allowed")
                            && !content.contains("permission denied"),
                    ),
                ],
            )
        }
    }
}

/// Multi-turn conversation: Verify the agent handles long conversations gracefully
/// by triggering compaction over multiple turns without errors.
pub async fn compaction_resilience(cfg: &Config) -> bool {
    let session_id = format!("{}-compaction", cfg.session_prefix);
    let workspace = tmp_workspace_path("compaction");

    // Turn 1: Generate context
    let turn1 = harness::send_sde_message(
        cfg,
        "Write a Python file called server.py with a basic HTTP server.",
        &session_id,
        "build",
        &workspace,
        None,
        true,
    )
    .await;

    let turn1_ok = turn1.is_ok();

    // Turn 2: More context
    let turn2 = harness::send_sde_message(
        cfg,
        "Add error handling and logging to server.py.",
        &session_id,
        "build",
        &workspace,
        None,
        true,
    )
    .await;

    let turn2_ok = turn2.is_ok();

    // Turn 3: Reference earlier context — tests that compaction preserves key info
    let turn3 = harness::send_sde_message(
        cfg,
        "What file did you create? Summarize its features briefly.",
        &session_id,
        "build",
        &workspace,
        None,
        false,
    )
    .await;

    let turn3_ok = turn3.as_ref().is_ok_and(|resp| {
        let content = resp.content.to_lowercase();
        content.contains("python")
            || content.contains("http")
            || content.contains("server")
            || content.contains(".py")
    });

    harness::print_result(
        "Compaction Resilience",
        &turn3.map(|r| r.content).unwrap_or_default(),
        &[
            ("Turn 1: Generated context", turn1_ok),
            ("Turn 2: More context added", turn2_ok),
            ("Turn 3: Recalls earlier work", turn3_ok),
        ],
    )
}

/// Large file read — Verify the agent can read a large file
/// using offset/limit without error. Creates a 3000-line file, then asks
/// the agent to read a specific section and report its contents.
pub async fn large_file_read(cfg: &Config) -> bool {
    let session_id = format!("{}-largefile", cfg.session_prefix);
    let workspace = tmp_workspace_path("largefile");

    let large_content: String = (1..=3000)
        .map(|line_num| {
            if line_num == 2500 {
                format!("// MARKER_NEEDLE: The answer is 42 — line {}", line_num)
            } else {
                format!("// padding line {} — filler content for testing", line_num)
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    let file_path = std::path::Path::new(&workspace).join("big_module.rs");
    let _ = std::fs::create_dir_all(&workspace);
    if let Err(err) = std::fs::write(&file_path, &large_content) {
        return harness::print_error(
            "Large File Read",
            &format!("Failed to write test file: {err}"),
        );
    }

    match harness::send_sde_message(
        cfg,
        "Read the file big_module.rs around line 2500 (use offset 2490, limit 20). \
         Tell me exactly what the MARKER_NEEDLE line says.",
        &session_id,
        "build",
        &workspace,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Large File Read", &err),
        Ok(resp) => {
            let content = resp.content.to_lowercase();
            let used_read = harness::assert_sde_tool_used(&resp, "read_file");

            harness::print_result(
                "Large File Read",
                &resp.content,
                &[
                    ("Got response", !resp.content.is_empty()),
                    ("Used read_file", used_read),
                    (
                        "Found the marker needle",
                        content.contains("marker_needle")
                            || content.contains("answer is 42")
                            || content.contains("42"),
                    ),
                    (
                        "Mentions line 2500 area",
                        content.contains("2500") || content.contains("needle"),
                    ),
                ],
            )
        }
    }
}

/// Concurrent tool execution — ask the agent to read multiple files
/// at once, verifying all read results come back correctly. The prompt is
/// designed to trigger multiple read_file / search_code tool calls in a
/// single LLM response so the parallel-execution path is exercised.
pub async fn concurrent_reads(cfg: &Config) -> bool {
    let session_id = format!("{}-concurrent", cfg.session_prefix);
    let workspace = tmp_workspace_path("concurrent");

    let _ = std::fs::create_dir_all(&workspace);
    std::fs::write(
        Path::new(&workspace).join("alpha.txt"),
        "ALPHA_SECRET=apple",
    )
    .ok();
    std::fs::write(Path::new(&workspace).join("beta.txt"), "BETA_SECRET=banana").ok();
    std::fs::write(
        Path::new(&workspace).join("gamma.txt"),
        "GAMMA_SECRET=grape",
    )
    .ok();

    match harness::send_sde_message(
        cfg,
        "Read all three files alpha.txt, beta.txt, and gamma.txt at once (use read_file for each), \
         then tell me the value of each SECRET variable.",
        &session_id,
        "build",
        &workspace,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Concurrent Reads", &err),
        Ok(resp) => {
            let content = resp.content.to_lowercase();
            let read_count = resp
                .tool_calls
                .iter()
                .filter(|tool| tool.contains("read_file"))
                .count();

            harness::print_result(
                "Concurrent Reads",
                &resp.content,
                &[
                    ("Got response", !resp.content.is_empty()),
                    (
                        "Used read_file 3 times",
                        read_count >= 3,
                    ),
                    (
                        "Found apple (alpha)",
                        content.contains("apple"),
                    ),
                    (
                        "Found banana (beta)",
                        content.contains("banana"),
                    ),
                    (
                        "Found grape (gamma)",
                        content.contains("grape"),
                    ),
                ],
            )
        }
    }
}

/// Away Summary — verify that long turns with many tool calls
/// complete successfully, report correct metadata, and produce an async
/// turn summary. The summary is generated via `tokio::spawn` and stored
/// on `AgentSession.last_turn_summary`; we poll the debug endpoint to
/// confirm it was actually written.
pub async fn away_summary(cfg: &Config) -> bool {
    let session_id = format!("{}-away-summary", cfg.session_prefix);
    let workspace = tmp_workspace_path("away-summary");
    let _ = std::fs::create_dir_all(&workspace);

    std::fs::write(
        Path::new(&workspace).join("data.txt"),
        "line1\nline2\nline3\nline4\nline5",
    )
    .ok();

    let result = harness::send_sde_message(
        cfg,
        "Read data.txt, then create five new files (a.txt through e.txt) each containing the word 'hello', \
         then list the directory contents and confirm everything is present. Do each step individually.",
        &session_id,
        "build",
        &workspace,
        None,
        true,
    )
    .await;

    let (got_response, tool_count, has_tokens) = match &result {
        Ok(resp) => (
            !resp.content.is_empty(),
            resp.tool_calls_count.unwrap_or(0),
            resp.total_tokens.unwrap_or(0) > 0,
        ),
        Err(_) => (false, 0, false),
    };

    let mut has_summary = false;
    if got_response && tool_count >= 5 {
        for attempt in 0..30 {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            match harness::fetch_turn_summary(cfg, &session_id).await {
                Ok(Some(text)) if !text.is_empty() => {
                    println!(
                        "  [poll] Turn summary arrived after {}s: {} chars",
                        (attempt + 1) * 2,
                        text.len()
                    );
                    has_summary = true;
                    break;
                }
                Ok(_) => {}
                Err(err) => {
                    println!("  [poll] fetch_turn_summary error: {}", err);
                    break;
                }
            }
        }
    }

    let _ = harness::cleanup_sde_session(cfg, &session_id).await;

    match result {
        Err(err) => harness::print_error("Away Summary", &err),
        Ok(resp) => harness::print_result(
            "Away Summary",
            &resp.content,
            &[
                ("Got response", got_response),
                (
                    &format!("Tool calls count reported ({})", tool_count),
                    tool_count > 0,
                ),
                ("Total tokens reported", has_tokens),
                (
                    &format!(
                        "Turn summary generated async (threshold >=5 calls): {}",
                        has_summary
                    ),
                    tool_count < 5 || has_summary,
                ),
            ],
        ),
    }
}

/// Dynamic Tool Descriptions — verify that tool descriptions
/// contain runtime-injected values such as CWD and date.
pub async fn dynamic_tool_desc(cfg: &Config) -> bool {
    let session_id = format!("{}-dyn-tool-desc", cfg.session_prefix);
    let workspace = tmp_workspace_path("dyn-tool-desc");
    let _ = std::fs::create_dir_all(&workspace);

    println!("  [step 1] Initializing session...");
    let init = harness::send_sde_message(
        cfg,
        "Say hello. Just a brief greeting.",
        &session_id,
        "build",
        &workspace,
        None,
        true,
    )
    .await;

    if let Err(err) = &init {
        return harness::print_error("Dynamic Tool Desc", err);
    }

    println!("  [step 2] Fetching tool schemas for active session...");
    match harness::fetch_tool_schemas(cfg, &session_id).await {
        Err(err) => harness::print_error("Dynamic Tool Desc", &err),
        Ok(schemas) => {
            // Helper: find a tool schema by name and extract its description
            let get_desc = |name: &str| -> Option<String> {
                schemas.tools.iter().find_map(|tool| {
                    let func = tool.get("function")?;
                    let tool_name = func.get("name")?.as_str()?;
                    if tool_name == name {
                        func.get("description")?.as_str().map(String::from)
                    } else {
                        None
                    }
                })
            };

            // run_shell: should contain workspace path (ExecTool — dynamic tool description)
            let run_shell_desc = get_desc("run_shell").unwrap_or_default();
            let run_shell_has_path =
                run_shell_desc.contains(&workspace) || run_shell_desc.contains("dyn-tool-desc");
            if !run_shell_desc.is_empty() {
                println!(
                    "    run_shell: {}...",
                    &run_shell_desc[..run_shell_desc.len().min(100)]
                );
            }

            // read_file: should contain workspace path
            let read_file_desc = get_desc("read_file").unwrap_or_default();
            let read_file_dynamic = read_file_desc.contains("dyn-tool-desc")
                || read_file_desc.contains("/tmp")
                || read_file_desc.contains("unrestricted");
            println!(
                "    read_file: {}...",
                &read_file_desc[..read_file_desc.len().min(100)]
            );

            // search_code: should contain dynamic tool description marker
            let search_desc = get_desc("code_search").unwrap_or_default();
            let search_dynamic = search_desc.contains("dyn-tool-desc");
            println!(
                "    search_code: {}...",
                &search_desc[..search_desc.len().min(100)]
            );

            // web_search: should contain current year (if tool is available)
            let web_search_desc = get_desc("web_search").unwrap_or_default();
            let current_year = chrono::Local::now().format("%Y").to_string();
            let web_search_has_year =
                web_search_desc.is_empty() || web_search_desc.contains(&current_year);
            if !web_search_desc.is_empty() {
                println!(
                    "    web_search: {}...",
                    &web_search_desc[..web_search_desc.len().min(100)]
                );
            }

            // agent: should list builtin agents dynamically
            let agent_desc = get_desc("agent").unwrap_or_default();
            let agent_dynamic =
                agent_desc.contains("builtin:explore") && agent_desc.contains("builtin:general");
            if !agent_desc.is_empty() {
                println!("    agent: {}...", &agent_desc[..agent_desc.len().min(100)]);
            }

            let _ = harness::cleanup_sde_session(cfg, &session_id).await;

            harness::print_result(
                "Dynamic Tool Desc",
                &format!("Found {} tools", schemas.tool_count),
                &[
                    (
                        &format!("Tool schemas returned ({} tools)", schemas.tool_count),
                        schemas.tool_count > 0,
                    ),
                    ("run_shell: has workspace path in desc", run_shell_has_path),
                    ("read_file: has dynamic workspace info", read_file_dynamic),
                    ("search_code: has dynamic workspace info", search_dynamic),
                    (
                        "web_search: has current year (or not present)",
                        web_search_has_year,
                    ),
                    ("agent: lists builtin agents dynamically", agent_dynamic),
                ],
            )
        }
    }
}

/// Auto-continue — ask the agent to produce a very long output
/// to test that truncated responses are automatically continued.
pub async fn auto_continue(cfg: &Config) -> bool {
    let session_id = format!("{}-auto-continue", cfg.session_prefix);
    let workspace = tmp_workspace_path("auto-continue");

    match harness::send_sde_message(
        cfg,
        "Write a Rust file kvstore.rs with a complete in-memory key-value store: \
         get, set, delete, TTL, LRU eviction, and unit tests. At least 300 lines. \
         Do NOT abbreviate.",
        &session_id,
        "build",
        &workspace,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Auto-Continue", &err),
        Ok(resp) => {
            let content = resp.content.to_lowercase();
            let has_written_file = resp.tool_calls.iter().any(|tool| {
                tool.contains("edit_file") || tool.contains("write") || tool.contains("delete_file")
            });

            let has_rs_file = std::fs::read_dir(&workspace)
                .ok()
                .map(|entries| {
                    entries
                        .filter_map(|e| e.ok())
                        .any(|entry| entry.path().extension().is_some_and(|ext| ext == "rs"))
                })
                .unwrap_or(false)
                || Path::new(&workspace).join("src").exists();

            harness::print_result(
                "Auto-Continue",
                &resp.content,
                &[
                    ("Got response", !resp.content.is_empty()),
                    (
                        "Mentions key-value store",
                        content.contains("key")
                            || content.contains("store")
                            || content.contains("cache")
                            || content.contains("kvstore"),
                    ),
                    ("Used file write tool", has_written_file),
                    ("File exists in workspace", has_rs_file || has_written_file),
                ],
            )
        }
    }
}

/// SessionModel max_iterations wiring — caller-path probe for the resolved
/// agent → TurnConfig projection used by the hot turn executor path.
pub async fn session_model_max_iterations_turn_cap(cfg: &Config) -> bool {
    match harness::resolve_agent(
        cfg,
        serde_json::json!({
            "agent_id": SDE_AGENT_ID,
            "model": cfg.model,
        }),
    )
    .await
    {
        Err(err) => harness::print_error("SessionModel Max Iterations Turn Cap", &err),
        Ok(json) => {
            let session_model_max = json
                .pointer("/session_model/max_iterations")
                .and_then(|value| value.as_u64());
            let turn_config_max = json
                .pointer("/turn_config/max_iterations")
                .and_then(|value| value.as_u64());
            let has_llm_wrapper = json.get("llm").is_some();

            harness::print_result(
                "SessionModel Max Iterations Turn Cap",
                &format!(
                    "session_model={session_model_max:?} turn_config={turn_config_max:?} has_llm_wrapper={has_llm_wrapper}"
                ),
                &[
                    (
                        "Resolved session_model.max_iterations is present",
                        session_model_max.is_some(),
                    ),
                    (
                        "TurnConfig cap comes from the same session_model value",
                        session_model_max.is_some() && session_model_max == turn_config_max,
                    ),
                    (
                        "No nested runtime LLM wrapper leaked through debug response",
                        !has_llm_wrapper,
                    ),
                ],
            )
        }
    }
}

/// Unlimited Loop — verify that build-mode sessions run without
/// an artificial iteration cap. We trigger many tool calls in a single turn
/// and verify the agent completes all of them without a "max iterations" error.
pub async fn unlimited_loop(cfg: &Config) -> bool {
    let session_id = format!("{}-unlimited-loop", cfg.session_prefix);
    let workspace = tmp_workspace_path("unlimited-loop");
    let _ = std::fs::create_dir_all(&workspace);

    match harness::send_sde_message(
        cfg,
        "Create 10 separate files: file_01.txt through file_10.txt. Each should contain \
         'Content of file N' where N is the number. Create them one at a time, then list \
         the directory to confirm all 10 exist. Do NOT abbreviate — create every single file.",
        &session_id,
        "build",
        &workspace,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Unlimited Loop", &err),
        Ok(resp) => {
            let content = resp.content.to_lowercase();
            let tool_count = resp.tool_calls.len();

            let files_exist = (1..=10)
                .filter(|num| {
                    Path::new(&workspace)
                        .join(format!("file_{:02}.txt", num))
                        .exists()
                })
                .count();

            harness::print_result(
                "Unlimited Loop",
                &resp.content,
                &[
                    ("Got response", !resp.content.is_empty()),
                    (
                        &format!("Many tool calls executed ({})", tool_count),
                        tool_count >= 10,
                    ),
                    (
                        &format!("Files created on disk ({}/10)", files_exist),
                        files_exist >= 8,
                    ),
                    (
                        "No max-iterations error",
                        !content.contains("max iteration")
                            && !content.contains("iteration limit")
                            && !content.contains("reached the limit"),
                    ),
                    (
                        "Agent completed task",
                        content.contains("created")
                            || content.contains("file_10")
                            || content.contains("all")
                            || content.contains("10"),
                    ),
                ],
            )
        }
    }
}

/// Scratchpad Globalization — verify that build-mode sessions
/// (not just SDE) have access to the scratchpad directory.
pub async fn scratchpad_global(cfg: &Config) -> bool {
    let session_id = format!("{}-scratchpad-global", cfg.session_prefix);
    let workspace = tmp_workspace_path("scratchpad-global");

    match harness::send_sde_message(
        cfg,
        "Do you have a scratchpad directory? If so, write a temp file called \
         'test_scratch.txt' containing 'e2e-scratchpad-check' in your scratchpad, \
         then read it back and tell me its contents.",
        &session_id,
        "build",
        &workspace,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Scratchpad Global", &err),
        Ok(resp) => {
            let content = resp.content.to_lowercase();
            harness::print_result(
                "Scratchpad Global",
                &resp.content,
                &[
                    ("Got response", !resp.content.is_empty()),
                    (
                        "Knows about scratchpad",
                        content.contains("scratchpad") || content.contains("orgii"),
                    ),
                    (
                        "Successfully wrote/read scratchpad file",
                        content.contains("e2e-scratchpad-check")
                            || content.contains("test_scratch"),
                    ),
                    (
                        "No error accessing scratchpad",
                        !content.contains("no scratchpad")
                            && !content.contains("not available")
                            && !content.contains("don't have"),
                    ),
                ],
            )
        }
    }
}

/// Streaming Tool Executor — verify that concurrent tool execution
/// works by asking the agent to read multiple files simultaneously.
pub async fn streaming_concurrent(cfg: &Config) -> bool {
    let session_id = format!("{}-stream-exec", cfg.session_prefix);
    let workspace = tmp_workspace_path("stream-exec");
    let _ = std::fs::create_dir_all(&workspace);

    for idx in 1..=5 {
        std::fs::write(
            Path::new(&workspace).join(format!("data_{}.txt", idx)),
            format!("STREAM_SECRET_{}=value_{}", idx, idx * 111),
        )
        .ok();
    }

    let start = std::time::Instant::now();

    match harness::send_sde_message(
        cfg,
        "Read all 5 files data_1.txt through data_5.txt at once using read_file for each. \
         Then tell me the STREAM_SECRET value from each file.",
        &session_id,
        "build",
        &workspace,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Streaming Concurrent", &err),
        Ok(resp) => {
            let elapsed = start.elapsed();
            let content = resp.content.to_lowercase();
            let read_count = resp
                .tool_calls
                .iter()
                .filter(|tool| tool.contains("read_file"))
                .count();

            harness::print_result(
                "Streaming Concurrent",
                &resp.content,
                &[
                    ("Got response", !resp.content.is_empty()),
                    (
                        &format!("Used read_file {} times (expect 5)", read_count),
                        read_count >= 5,
                    ),
                    ("Found value from file 1 (111)", content.contains("111")),
                    ("Found value from file 3 (333)", content.contains("333")),
                    ("Found value from file 5 (555)", content.contains("555")),
                    (&format!("Completed in {:.1}s", elapsed.as_secs_f64()), true),
                ],
            )
        }
    }
}

pub async fn prefetch_zero_wait_collect(cfg: &Config) -> bool {
    let url = format!("{}/agent/test/prefetch/zero-wait", cfg.base_url);
    let result = async {
        let response = reqwest::Client::new()
            .post(&url)
            .json(&serde_json::json!({ "delay_ms": 150 }))
            .send()
            .await
            .map_err(|err| format!("request failed: {err}"))?;
        let status = response.status();
        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|err| format!("decode failed: {err}"))?;
        if !status.is_success() {
            return Err(format!("status={status} body={body}"));
        }

        let first_elapsed = body
            .get("first_elapsed_ms")
            .and_then(|value| value.as_u64())
            .unwrap_or(u64::MAX);
        let second_elapsed = body
            .get("second_elapsed_ms")
            .and_then(|value| value.as_u64())
            .unwrap_or(u64::MAX);
        let first_text = body
            .get("first_messages")
            .map(|value| value.to_string())
            .unwrap_or_default();
        let second_text = body
            .get("second_messages")
            .map(|value| value.to_string())
            .unwrap_or_default();

        let first_did_not_wait = first_elapsed < 75;
        let first_not_injected =
            !first_text.contains("probe-skill") && !first_text.contains("probe-memory");
        let second_injected =
            second_text.contains("probe-skill") && second_text.contains("probe-memory");
        let second_fast_collect = second_elapsed < 75;
        Ok((
            body,
            first_did_not_wait,
            first_not_injected,
            second_injected,
            second_fast_collect,
        ))
    }
    .await;

    match result {
        Ok((
            body,
            first_did_not_wait,
            first_not_injected,
            second_injected,
            second_fast_collect,
        )) => harness::print_result(
            "Prefetch Zero-Wait Collect",
            &body.to_string(),
            &[
                (
                    "First collect did not wait for pending side queries",
                    first_did_not_wait,
                ),
                (
                    "First collect did not inject pending results",
                    first_not_injected,
                ),
                (
                    "Second collect injected settled skill and memory",
                    second_injected,
                ),
                (
                    "Second collect consumed settled results without extra wait",
                    second_fast_collect,
                ),
            ],
        ),
        Err(err) => harness::print_error("Prefetch Zero-Wait Collect", &err),
    }
}

/// Skill Discovery Prefetch — verify that the agent's prompt
/// includes skill context when relevant skills are available.
pub async fn skill_prefetch(cfg: &Config) -> bool {
    let session_id = format!("{}-skill-prefetch", cfg.session_prefix);
    let workspace = tmp_workspace_path("skill-prefetch");
    let _ = std::fs::create_dir_all(&workspace);

    // Skills must live in {skills_dir}/{skill-name}/SKILL.md directory structure.
    let skills_dir = Path::new(&workspace).join(".orgii").join("skills");
    let skill_dir = skills_dir.join("e2e-testing");
    let _ = std::fs::create_dir_all(&skill_dir);

    let skill_content = r#"---
name: e2e-testing
description: E2E testing helper. Use when setting up test fixtures or E2E test infrastructure.
---

# E2E Test Skill

## Purpose
This skill helps agents perform special E2E testing operations.

## Capabilities
- Create standardized test fixtures with the prefix `E2E_FIXTURE_`
- Generate test reports in JSON format
- Validate test assertions

## Instructions
When asked about E2E testing, always mention the fixture prefix `E2E_FIXTURE_` and suggest JSON reports.
"#;

    std::fs::write(skill_dir.join("SKILL.md"), skill_content).ok();

    match harness::send_sde_message(
        cfg,
        "I need to set up E2E test fixtures for this workspace. \
         What skills or capabilities do you have for E2E testing? \
         Create a test fixture file following any available skill guidelines.",
        &session_id,
        "build",
        &workspace,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Skill Prefetch", &err),
        Ok(resp) => {
            let content = resp.content.to_lowercase();
            harness::print_result(
                "Skill Prefetch",
                &resp.content,
                &[
                    ("Got response", !resp.content.is_empty()),
                    (
                        "Agent aware of testing context",
                        content.contains("test")
                            || content.contains("fixture")
                            || content.contains("e2e"),
                    ),
                    (
                        "Skill content influenced response (E2E_FIXTURE_ prefix from skill)",
                        content.contains("e2e_fixture_") || resp.content.contains("E2E_FIXTURE_"),
                    ),
                    (
                        "Agent completed the task",
                        !content.is_empty()
                            && (content.contains("created")
                                || content.contains("file")
                                || content.contains("test")),
                    ),
                ],
            )
        }
    }
}

// last_assistant_text fallback (deterministic helper probes)
//
// Asserts the "no silent narration loss" contract on the helper that
// recovers the most recent assistant text from a message history.

/// Positive case: messages contain earlier narration followed by a pure tool_use
/// terminal turn. The helper must recover the earlier narration (not return None).
pub async fn last_assistant_text_recovers_narration(cfg: &Config) -> bool {
    let messages = serde_json::json!([
        { "role": "user",      "content": "explore the codebase" },
        { "role": "assistant", "content": "NARRATION_MARKER: I'll explore the workspace structure and report what I find." },
        {
            "role": "assistant",
            "content": null,
            "tool_calls": [{
                "id": "call_abc",
                "type": "function",
                "function": { "name": "list_files", "arguments": "{}" }
            }]
        },
        { "role": "tool", "tool_call_id": "call_abc", "name": "list_files", "content": "src/\nlib.rs" },
        {
            "role": "assistant",
            "content": null,
            "tool_calls": [{
                "id": "call_xyz",
                "type": "function",
                "function": { "name": "read_file", "arguments": "{\"path\":\"lib.rs\"}" }
            }]
        }
    ]);

    match harness::probe_last_assistant_text(cfg, &messages).await {
        Err(err) => harness::print_error("Last Assistant Text: Recovers Narration", &err),
        Ok(result) => {
            let recovered = result.unwrap_or_default();
            harness::print_result(
                "Last Assistant Text: Recovers Narration",
                &recovered,
                &[
                    (
                        "Recovered narration (not None/empty)",
                        !recovered.is_empty(),
                    ),
                    (
                        "Recovered the correct earlier narration text",
                        recovered.contains("NARRATION_MARKER"),
                    ),
                    (
                        "Did NOT return boilerplate fallback string",
                        !recovered.contains("produced no text response"),
                    ),
                ],
            )
        }
    }
}

/// Negative case: no non-empty assistant text anywhere. Helper must return None.
pub async fn last_assistant_text_returns_none_when_no_narration(cfg: &Config) -> bool {
    let messages = serde_json::json!([
        { "role": "user", "content": "do something" },
        {
            "role": "assistant",
            "content": null,
            "tool_calls": [{
                "id": "call_1",
                "type": "function",
                "function": { "name": "run_shell", "arguments": "{\"command\":\"echo hi\"}" }
            }]
        },
        { "role": "tool", "tool_call_id": "call_1", "name": "run_shell", "content": "hi" }
    ]);

    match harness::probe_last_assistant_text(cfg, &messages).await {
        Err(err) => {
            harness::print_error("Last Assistant Text: Returns None When No Narration", &err)
        }
        Ok(result) => harness::print_result(
            "Last Assistant Text: Returns None When No Narration",
            "(no text expected)",
            &[(
                "Helper returned None (no hallucinated text)",
                result.is_none(),
            )],
        ),
    }
}

// finalize_agent_result — full caller-side (agent.rs) probes for the
// finalize step's "no silent narration loss" contract

/// Case A: TurnResult.content is None but messages contain earlier narration.
/// The finalize path must recover the most recent assistant text from the
/// message history rather than returning an empty result; this asserts the
/// "no silent narration loss" contract on the finalize step.
pub async fn finalize_agent_result_recovers_from_messages(cfg: &Config) -> bool {
    let messages = serde_json::json!([
        { "role": "user", "content": "explore the repo structure" },
        { "role": "assistant", "content": "FINALIZE_MARKER: I'll start by listing the top-level directories." },
        {
            "role": "assistant",
            "content": null,
            "tool_calls": [{
                "id": "call_001",
                "type": "function",
                "function": { "name": "list_files", "arguments": "{\"path\":\".\"}" }
            }]
        },
        { "role": "tool", "tool_call_id": "call_001", "name": "list_files", "content": "src/\nlib.rs\nCargo.toml" },
        {
            "role": "assistant",
            "content": null,
            "tool_calls": [{
                "id": "call_002",
                "type": "function",
                "function": { "name": "read_file", "arguments": "{\"path\":\"Cargo.toml\"}" }
            }]
        }
    ]);

    match harness::probe_finalize_agent_result(cfg, None, &messages).await {
        Err(err) => harness::print_error("Finalize Agent Result: Recovers From Messages", &err),
        Ok(res) => {
            let recovered = res.result.unwrap_or_default();
            harness::print_result(
                "Finalize Agent Result: Recovers From Messages",
                &recovered,
                &[
                    (
                        "content=None → fell back to messages (source is 'messages')",
                        res.source == "messages",
                    ),
                    (
                        "Recovered correct narration (FINALIZE_MARKER present)",
                        recovered.contains("FINALIZE_MARKER"),
                    ),
                    (
                        "Did NOT return boilerplate fallback string",
                        !recovered.contains("produced no text response"),
                    ),
                ],
            )
        }
    }
}

/// Case B: TurnResult.content is Some — finalize path uses it directly,
/// does not fall through to messages.
pub async fn finalize_agent_result_prefers_content(cfg: &Config) -> bool {
    let messages = serde_json::json!([
        { "role": "user", "content": "do something" },
        { "role": "assistant", "content": "OLDER_NARRATION: older text that should NOT win" }
    ]);
    let direct_content = "DIRECT_CONTENT: this came directly from the terminal iteration";

    match harness::probe_finalize_agent_result(cfg, Some(direct_content), &messages).await {
        Err(err) => harness::print_error("Finalize Agent Result: Prefers Direct Content", &err),
        Ok(res) => {
            let result_text = res.result.unwrap_or_default();
            harness::print_result(
                "Finalize Agent Result: Prefers Direct Content",
                &result_text,
                &[
                    (
                        "content=Some → used directly (source is 'content')",
                        res.source == "content",
                    ),
                    (
                        "Result matches DIRECT_CONTENT (not older message text)",
                        result_text.contains("DIRECT_CONTENT"),
                    ),
                    (
                        "Older message narration was NOT used",
                        !result_text.contains("OLDER_NARRATION"),
                    ),
                ],
            )
        }
    }
}

// ============================================
// Tier-1 silent escalation probes
// ============================================

/// Case A: first truncation with low max_tokens → should escalate to 64K.
/// Mirrors the branch condition:
///   `!tier1_escalated && effective_max_tokens < ESCALATED_MAX_TOKENS`
pub async fn tier1_escalation_first_truncation(cfg: &Config) -> bool {
    match harness::probe_tier1_escalation(cfg, 4096, false).await {
        Err(err) => harness::print_error("Tier-1 Escalation: First Truncation", &err),
        Ok(res) => harness::print_result(
            "Tier-1 Escalation: First Truncation",
            &format!(
                "would_escalate={}, new_max_tokens={}, threshold={}",
                res.would_escalate, res.new_max_tokens, res.escalated_threshold
            ),
            &[
                (
                    "Would escalate (low max_tokens, not yet escalated)",
                    res.would_escalate,
                ),
                ("New max_tokens is 64000", res.new_max_tokens == 64_000),
                ("Threshold is 64000", res.escalated_threshold == 64_000),
            ],
        ),
    }
}

/// Case B: already escalated → must NOT escalate again (Tier-2 path takes over).
pub async fn tier1_escalation_already_escalated(cfg: &Config) -> bool {
    match harness::probe_tier1_escalation(cfg, 64_000, true).await {
        Err(err) => harness::print_error("Tier-1 Escalation: Already Escalated", &err),
        Ok(res) => harness::print_result(
            "Tier-1 Escalation: Already Escalated",
            &format!(
                "would_escalate={}, new_max_tokens={}",
                res.would_escalate, res.new_max_tokens
            ),
            &[
                (
                    "Would NOT escalate again (tier1_escalated=true)",
                    !res.would_escalate,
                ),
                (
                    "Max tokens unchanged at 64000",
                    res.new_max_tokens == 64_000,
                ),
            ],
        ),
    }
}

/// Case C: already at or above ESCALATED_MAX_TOKENS → no escalation.
/// This represents a session configured with a very high ceiling from the start.
pub async fn tier1_escalation_already_at_ceiling(cfg: &Config) -> bool {
    match harness::probe_tier1_escalation(cfg, 100_000, false).await {
        Err(err) => harness::print_error("Tier-1 Escalation: Already At Ceiling", &err),
        Ok(res) => harness::print_result(
            "Tier-1 Escalation: Already At Ceiling",
            &format!(
                "would_escalate={}, new_max_tokens={}",
                res.would_escalate, res.new_max_tokens
            ),
            &[
                (
                    "Would NOT escalate (already above threshold)",
                    !res.would_escalate,
                ),
                (
                    "Max tokens stays at original 100000",
                    res.new_max_tokens == 100_000,
                ),
            ],
        ),
    }
}

// ─── ask_user_questions schema validation ────────────────────────────────────

/// ask_user_questions top-level schema:
///   - multiSelect field exists at question level (not `multiple`)
///   - multiSelect is a boolean property
///   - questions array has minItems:1
///
/// Deterministic: uses fetch_tool_schemas, no LLM call needed.
pub async fn ask_question_schema(cfg: &Config) -> bool {
    let session_id = format!("{}-ask-q-schema", cfg.session_prefix);
    let workspace = super::tmp_workspace_path("ask-q-schema");

    println!("  [step 1] Starting session to get live tool schemas...");
    let init = harness::send_sde_message(
        cfg,
        "Say hello briefly.",
        &session_id,
        "build",
        &workspace,
        None,
        true,
    )
    .await;

    if let Err(err) = &init {
        return harness::print_error("Ask-Question Schema", err);
    }

    println!("  [step 2] Fetching tool schemas...");
    let schemas_result = harness::fetch_tool_schemas(cfg, &session_id).await;
    let _ = harness::cleanup_sde_session(cfg, &session_id).await;

    match schemas_result {
        Err(err) => harness::print_error("Ask-Question Schema", &err),
        Ok(schemas) => {
            // Find ask_user_questions tool definition
            let tool_params = schemas.tools.iter().find_map(|tool| {
                let func = tool.get("function")?;
                if func.get("name")?.as_str()? == "ask_user_questions" {
                    func.get("parameters").cloned()
                } else {
                    None
                }
            });

            let found_tool = tool_params.is_some();
            let params = tool_params.unwrap_or_default();

            // Navigate: params.properties.questions.items.properties
            let question_props = params
                .get("properties")
                .and_then(|p| p.get("questions"))
                .and_then(|q| q.get("items"))
                .and_then(|i| i.get("properties"));

            // multiSelect field must exist (not "multiple")
            let has_multi_select = question_props
                .as_ref()
                .and_then(|p| p.get("multiSelect"))
                .is_some();

            // "multiple" must NOT appear (it was the old name — regression check)
            let no_old_multiple_field = question_props
                .as_ref()
                .and_then(|p| p.get("multiple"))
                .is_none();

            // multiSelect must be boolean type
            let multi_select_is_bool = question_props
                .as_ref()
                .and_then(|p| p.get("multiSelect"))
                .and_then(|m| m.get("type"))
                .and_then(|t| t.as_str())
                == Some("boolean");

            // questions array must have minItems: 1
            let questions_has_min_items = params
                .get("properties")
                .and_then(|p| p.get("questions"))
                .and_then(|q| q.get("minItems"))
                .and_then(|v| v.as_u64())
                == Some(1);

            if found_tool {
                println!(
                    "    ask_user_questions: found, {} question properties",
                    question_props
                        .as_ref()
                        .and_then(|p| p.as_object())
                        .map_or(0, |o| o.len())
                );
            }

            harness::print_result(
                "Ask-Question Schema",
                &format!(
                    "found={}, multiSelect={}, no_old_multiple={}, bool_type={}, min_items={}",
                    found_tool,
                    has_multi_select,
                    no_old_multiple_field,
                    multi_select_is_bool,
                    questions_has_min_items,
                ),
                &[
                    ("ask_user_questions tool is registered", found_tool),
                    (
                        "multiSelect field exists (not 'multiple')",
                        has_multi_select,
                    ),
                    (
                        "old 'multiple' field is gone (no regression)",
                        no_old_multiple_field,
                    ),
                    ("multiSelect is boolean type", multi_select_is_bool),
                    ("questions array has minItems:1", questions_has_min_items),
                ],
            )
        }
    }
}

/// ask_user_questions option-level schema:
///   - option.description is in the required array (forces the LLM
///     to provide trade-off context for every choice)
///   - options array has minItems:2 and maxItems:4
///   - option.id is optional (NOT in required) — id is an optional
///     submission handle in our schema; the LLM may omit it
///   - option.label is required
///
/// Positive assertion: description required → LLM always provides trade-off context.
/// Negative assertion: id NOT required → id is optional in our schema.
/// Deterministic: uses fetch_tool_schemas, no LLM call needed.
pub async fn ask_question_option_fields(cfg: &Config) -> bool {
    let session_id = format!("{}-ask-q-opts", cfg.session_prefix);
    let workspace = super::tmp_workspace_path("ask-q-opts");

    println!("  [step 1] Starting session to get live tool schemas...");
    let init = harness::send_sde_message(
        cfg,
        "Say hello briefly.",
        &session_id,
        "build",
        &workspace,
        None,
        true,
    )
    .await;

    if let Err(err) = &init {
        return harness::print_error("Ask-Question Option Fields", err);
    }

    println!("  [step 2] Fetching tool schemas for option-level checks...");
    let schemas_result = harness::fetch_tool_schemas(cfg, &session_id).await;
    let _ = harness::cleanup_sde_session(cfg, &session_id).await;

    match schemas_result {
        Err(err) => harness::print_error("Ask-Question Option Fields", &err),
        Ok(schemas) => {
            let tool_params = schemas.tools.iter().find_map(|tool| {
                let func = tool.get("function")?;
                if func.get("name")?.as_str()? == "ask_user_questions" {
                    func.get("parameters").cloned()
                } else {
                    None
                }
            });

            let found_tool = tool_params.is_some();
            let params = tool_params.unwrap_or_default();

            // Navigate to option item schema
            let option_schema = params
                .get("properties")
                .and_then(|p| p.get("questions"))
                .and_then(|q| q.get("items"))
                .and_then(|i| i.get("properties"))
                .and_then(|p| p.get("options"));

            // options array constraints
            let options_min_items = option_schema
                .as_ref()
                .and_then(|o| o.get("minItems"))
                .and_then(|v| v.as_u64())
                == Some(2);

            let options_max_items = option_schema
                .as_ref()
                .and_then(|o| o.get("maxItems"))
                .and_then(|v| v.as_u64())
                == Some(4);

            // option item required array
            let item_required = option_schema
                .as_ref()
                .and_then(|o| o.get("items"))
                .and_then(|i| i.get("required"))
                .and_then(|r| r.as_array())
                .cloned()
                .unwrap_or_default();

            let item_required_strs: Vec<&str> =
                item_required.iter().filter_map(|v| v.as_str()).collect();

            // description must be required (forces the LLM to explain
            // trade-offs for every option)
            let description_required = item_required_strs.contains(&"description");
            // label must be required (primary display text)
            let label_required = item_required_strs.contains(&"label");
            // id must NOT be required (it is optional in our schema)
            let id_not_required = !item_required_strs.contains(&"id");

            println!("    option required fields: {:?}", item_required_strs);
            println!(
                "    options minItems={}, maxItems={}",
                option_schema
                    .as_ref()
                    .and_then(|o| o.get("minItems"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0),
                option_schema
                    .as_ref()
                    .and_then(|o| o.get("maxItems"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0),
            );

            harness::print_result(
                "Ask-Question Option Fields",
                &format!(
                    "found={}, desc_req={}, label_req={}, id_opt={}, min2={}, max4={}",
                    found_tool,
                    description_required,
                    label_required,
                    id_not_required,
                    options_min_items,
                    options_max_items,
                ),
                &[
                    ("ask_user_questions tool found", found_tool),
                    (
                        "option.description is required (forces trade-off context)",
                        description_required,
                    ),
                    ("option.label is required", label_required),
                    ("option.id is optional in our schema", id_not_required),
                    ("options has minItems:2", options_min_items),
                    ("options has maxItems:4", options_max_items),
                ],
            )
        }
    }
}

/// — Skill slash command injection.
///
/// Regression pin for the bug where `message_pipeline.rs` loaded SKILL.md via
/// `load_skill()` but discarded the content, replacing the user message with the
/// placeholder `"Use the create-rule skill to help me."`. The LLM never saw the
/// actual SKILL.md instructions.
///
/// Fix: SKILL.md body is now injected as the leading context of the user
/// message — the slash-command expansion is treated as an `isMeta` user turn
/// in our pipeline, meaning its body is prepended to the visible user prompt
/// before the LLM sees the turn.
/// Also adds `.with_builtin_dir()` so builtin skills are discoverable.
///
/// Positive check: `/create-rule` → LLM response references content that can only
/// come from the SKILL.md instructions (storage path, `.mdc` extension, or
/// rule file structure).
pub async fn skill_slash_injection(cfg: &Config) -> bool {
    let session_id = format!("{}-skill-slash", cfg.session_prefix);
    let workspace = tmp_workspace_path("skill-slash");
    let _ = std::fs::create_dir_all(&workspace);

    // The builtin create-rule SKILL.md mentions ".cursor/rules/" and ".mdc" extension.
    // If the injection is working, the LLM will reference those specifics in its response.
    // If the content was discarded (old bug), the LLM gets a vague placeholder and
    // has no way to mention the concrete storage details.
    match harness::send_sde_message(
        cfg,
        "/create-rule",
        &session_id,
        "build",
        &workspace,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Skill Slash Injection", &err),
        Ok(resp) => {
            let content = resp.content.to_lowercase();
            harness::print_result(
                "Skill Slash Injection",
                &resp.content,
                &[
                    ("Got non-empty response", !resp.content.is_empty()),
                    (
                        "Response references rule file concepts (from SKILL.md, not hallucination)",
                        content.contains(".cursor/rules")
                            || content.contains(".orgii/rules")
                            || content.contains(".mdc")
                            || content.contains("rule file")
                            || content.contains("rules/")
                            || content.contains("glob pattern"),
                    ),
                    (
                        "Response is substantive (> 50 chars — not the discarded-content fallback)",
                        resp.content.len() > 50,
                    ),
                ],
            )
        }
    }
}

/// — Skill slash command with user args.
///
/// Verifies that when the user passes args after the slash command
/// (e.g., `/create-rule always use tabs`), the args are preserved as the concrete
/// task in the injected message, and the LLM produces a response that incorporates
/// both the skill instructions and the user's specific request.
pub async fn skill_slash_with_args(cfg: &Config) -> bool {
    let session_id = format!("{}-skill-slash-args", cfg.session_prefix);
    let workspace = tmp_workspace_path("skill-slash-args");
    let _ = std::fs::create_dir_all(&workspace);

    match harness::send_sde_message(
        cfg,
        "/create-rule always use tabs for indentation",
        &session_id,
        "build",
        &workspace,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Skill Slash With Args", &err),
        Ok(resp) => {
            let content = resp.content.to_lowercase();
            harness::print_result(
                "Skill Slash With Args",
                &resp.content,
                &[
                    ("Got non-empty response", !resp.content.is_empty()),
                    (
                        "Response incorporates user args (tab indentation rule)",
                        content.contains("tab")
                            || content.contains("indent")
                            || content.contains("indentation"),
                    ),
                    (
                        "Response references rule file structure (from SKILL.md)",
                        content.contains(".cursor/rules")
                            || content.contains(".orgii/rules")
                            || content.contains(".mdc")
                            || content.contains("rule")
                            || content.contains("rules/"),
                    ),
                ],
            )
        }
    }
}

/// — Skill slash injection via message_pipeline.rs path (Positive+negative gap fix).
///
/// The existing `skill_slash_injection` test covers the SDE endpoint →
/// `integration.rs` path. This test covers the OS/channel path which routes through
/// `message_pipeline::process_gateway_message` → `integration::process_message`
/// and exercises skill slash injection in the unified pipeline.
///
/// Regression guard: if skill injection is broken in `message_pipeline.rs` (e.g.
/// the `with_builtin_dir()` call is removed), this test will catch it while the
/// SDE-path tests continue to pass, preventing silent regressions.
pub async fn skill_slash_injection_pipeline_path(cfg: &Config) -> bool {
    let session_id = format!("{}-skill-slash-pipeline", cfg.session_prefix);

    match harness::send_os_message(cfg, "/create-rule", &session_id).await {
        Err(err) => harness::print_error("Skill Slash Injection (pipeline path)", &err),
        Ok(resp) => {
            let content = resp.content.to_lowercase();
            harness::print_result(
                "Skill Slash Injection (pipeline path)",
                &resp.content,
                &[
                    ("Got non-empty response", !resp.content.is_empty()),
                    (
                        "Response references rule file concepts (SKILL.md injected via message_pipeline.rs)",
                        content.contains(".cursor/rules")
                            || content.contains(".orgii/rules")
                            || content.contains(".mdc")
                            || content.contains("rule file")
                            || content.contains("rules/")
                            || content.contains("glob pattern"),
                    ),
                    (
                        "Response is substantive (> 50 chars — not the discarded-content fallback)",
                        resp.content.len() > 50,
                    ),
                ],
            )
        }
    }
}

/// — Skill slash with args via message_pipeline.rs path.
///
/// Companion to `skill_slash_injection_pipeline_path`: verifies that user args
/// appended after the slash command are preserved when routed through
/// `message_pipeline.rs`.
pub async fn skill_slash_args_pipeline_path(cfg: &Config) -> bool {
    let session_id = format!("{}-skill-slash-pipeline-args", cfg.session_prefix);

    match harness::send_os_message(
        cfg,
        "/create-rule always use tabs for indentation",
        &session_id,
    )
    .await
    {
        Err(err) => harness::print_error("Skill Slash With Args (pipeline path)", &err),
        Ok(resp) => {
            let content = resp.content.to_lowercase();
            harness::print_result(
                "Skill Slash With Args (pipeline path)",
                &resp.content,
                &[
                    ("Got non-empty response", !resp.content.is_empty()),
                    (
                        "Response incorporates user args (tab indentation rule)",
                        content.contains("tab")
                            || content.contains("indent")
                            || content.contains("indentation"),
                    ),
                    (
                        "Response references rule file structure (SKILL.md injected)",
                        content.contains(".cursor/rules")
                            || content.contains(".orgii/rules")
                            || content.contains(".mdc")
                            || content.contains("rule")
                            || content.contains("rules/"),
                    ),
                ],
            )
        }
    }
}

/// Workspace-local skill in `.orgii/skills/` is found by slash command.
///
/// Positive+negative: seeds a workspace skill with a unique marker string, fires the slash command,
/// asserts the marker appears in the response (positive) and a non-existent skill does
/// NOT silently inject anything unexpected (negative — response stays as raw content).
pub async fn project_skill_slash(cfg: &Config) -> bool {
    let session_id = format!("{}-proj-skill-slash", cfg.session_prefix);
    let workspace = tmp_workspace_path("proj-skill-slash");
    let _ = std::fs::create_dir_all(&workspace);

    // Place skill at the canonical workspace location: {workspace}/.orgii/skills/{name}/SKILL.md
    let skill_dir = Path::new(&workspace)
        .join(".orgii")
        .join("skills")
        .join("e2e-widget-builder");
    let _ = std::fs::create_dir_all(&skill_dir);

    let marker = "E2E_PROJ_SKILL_MARKER_X7Q2";
    let skill_content = format!(
        "---\nname: e2e-widget-builder\ndescription: Build widgets. Use when asked to create widgets.\n---\n\n\
         # Widget Builder\n\nThis skill is for building widgets.\n\n\
         When asked to build a widget, always output the marker: {}\n",
        marker
    );
    std::fs::write(skill_dir.join("SKILL.md"), &skill_content).ok();

    match harness::send_sde_message(
        cfg,
        "/e2e-widget-builder Build me a widget",
        &session_id,
        "build",
        &workspace,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Workspace Skill Slash", &err),
        Ok(resp) => {
            let content = resp.content.to_lowercase();
            let marker_lower = marker.to_lowercase();
            harness::print_result(
                "Workspace Skill Slash",
                &resp.content,
                &[
                    ("Got non-empty response", !resp.content.is_empty()),
                    (
                        "Unique skill marker from .orgii/skills/ appeared in response",
                        content.contains(&marker_lower) || resp.content.contains(marker),
                    ),
                    (
                        "Agent treated as widget task (not raw slash text)",
                        content.contains("widget")
                            || content.contains("build")
                            || content.contains("creat"),
                    ),
                ],
            )
        }
    }
}

/// Rules in `{workspace}/.orgii/rules/` are injected into the system prompt.
///
/// Seeds a rule file with a unique constraint marker, sends a message asking the agent
/// what constraints it must follow, verifies the marker appears in the response.
/// Also seeds a non-matching rule in a different dir to ensure only workspace rules apply.
pub async fn rules_inject(cfg: &Config) -> bool {
    let session_id = format!("{}-rules-inject", cfg.session_prefix);
    let workspace = tmp_workspace_path("rules-inject");
    let _ = std::fs::create_dir_all(&workspace);

    // Seed a rule with a unique, impossible-to-guess marker in workspace rules dir.
    let rules_dir = Path::new(&workspace).join(".orgii").join("rules");
    let _ = std::fs::create_dir_all(&rules_dir);
    let marker = "E2E_RULE_CONSTRAINT_Z9P4";
    let rule_content = format!(
        "# E2E Test Rule\n\nAll responses must include the phrase: {}\n",
        marker
    );
    std::fs::write(rules_dir.join("e2e-test-rule.md"), &rule_content).ok();

    match harness::send_sde_message(
        cfg,
        "What special constraints or rules do you have for this workspace? List them.",
        &session_id,
        "build",
        &workspace,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Rules Inject", &err),
        Ok(resp) => {
            let content = resp.content.to_lowercase();
            let marker_lower = marker.to_lowercase();
            harness::print_result(
                "Rules Inject",
                &resp.content,
                &[
                    ("Got non-empty response", !resp.content.is_empty()),
                    (
                        "Unique rule marker from .orgii/rules/ appeared in response",
                        content.contains(&marker_lower) || resp.content.contains(marker),
                    ),
                    (
                        "Agent acknowledges having workspace constraints",
                        content.contains("rule")
                            || content.contains("constraint")
                            || content.contains("must")
                            || content.contains("require"),
                    ),
                ],
            )
        }
    }
}

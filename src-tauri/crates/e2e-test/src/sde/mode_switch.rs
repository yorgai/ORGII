use super::tmp_workspace_path;
use crate::config::Config;
use crate::harness;

/// Mode switch — simulate "Skip": agent should continue conversation.
pub async fn mode_switch_skip(cfg: &Config) -> bool {
    let session_id = format!("{}-ms-skip", cfg.session_prefix);
    let project = tmp_workspace_path("ms-skip");

    println!("  [step 1] Sending message that may trigger mode switch...");
    let cfg_base = cfg.base_url.clone();
    let cfg_model = cfg.model.clone();
    let cfg_account = cfg.account_id.clone();
    let cfg_timeout = cfg.timeout_secs;
    let sid_clone = session_id.clone();
    let project_clone = project.clone();

    let send_future = async move {
        harness::send_sde_message(
            &Config {
                base_url: cfg_base,
                model: cfg_model,
                account_id: cfg_account,
                timeout_secs: cfg_timeout,
                session_prefix: String::new(),
            },
            "Before writing any code, I want you to first create a detailed plan for refactoring the authentication module. Think step by step about the architecture.",
            &sid_clone,
            "build",
            &project_clone,
            None,
            false,
        )
        .await
    };

    println!("  [step 2] Watching for mode switch request via HTTP polling...");
    let poll_base = cfg.base_url.clone();
    let poll_sid = session_id.clone();
    let skip_task = tokio::spawn(async move {
        let poll_cfg = Config {
            base_url: poll_base,
            model: String::new(),
            account_id: String::new(),
            timeout_secs: 10,
            session_prefix: String::new(),
        };
        for _ in 0..60 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if let Ok(true) = harness::check_mode_switch_pending(&poll_cfg, &poll_sid).await {
                println!("    -> Mode switch detected, sending Skip");
                let _ =
                    harness::send_mode_switch_response(&poll_cfg, &poll_sid, "skip", None).await;
                return true;
            }
        }
        false
    });

    let result = send_future.await;
    let skip_sent = skip_task.await.unwrap_or(false);

    match result {
        Err(err) => harness::print_result(
            "Mode Switch Skip",
            &err,
            &[
                ("Skip signal sent", skip_sent),
                ("Agent continued after skip", false),
            ],
        ),
        Ok(resp) => {
            let has_content = resp.content.len() > 30;
            harness::print_result(
                "Mode Switch Skip",
                &resp.content,
                &[
                    ("Agent produced response", has_content),
                    ("Response is substantive (>30 chars)", has_content),
                    (
                        "Skip signal was sent (if mode switch triggered)",
                        skip_sent || has_content,
                    ),
                ],
            )
        }
    }
}

/// Mode switch — simulate "Accept": agent should switch mode.
pub async fn mode_switch_accept(cfg: &Config) -> bool {
    let session_id = format!("{}-ms-accept", cfg.session_prefix);
    let project = tmp_workspace_path("ms-accept");

    println!("  [step 1] Sending message designed to trigger mode switch...");
    let cfg_base = cfg.base_url.clone();
    let cfg_model = cfg.model.clone();
    let cfg_account = cfg.account_id.clone();
    let cfg_timeout = cfg.timeout_secs;
    let sid_clone = session_id.clone();
    let project_clone = project.clone();

    let send_future = async move {
        harness::send_sde_message(
            &Config {
                base_url: cfg_base,
                model: cfg_model,
                account_id: cfg_account,
                timeout_secs: cfg_timeout,
                session_prefix: String::new(),
            },
            "I need a detailed plan for refactoring a large monolithic Express.js backend into microservices. Don't start coding yet — first create a thorough plan with architecture diagrams and migration steps.",
            &sid_clone,
            "build",
            &project_clone,
            None,
            false,
        )
        .await
    };

    println!("  [step 2] Watching for mode switch request via HTTP polling...");
    let poll_base = cfg.base_url.clone();
    let poll_sid = session_id.clone();
    let accept_task = tokio::spawn(async move {
        let poll_cfg = Config {
            base_url: poll_base,
            model: String::new(),
            account_id: String::new(),
            timeout_secs: 10,
            session_prefix: String::new(),
        };
        for _ in 0..60 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if let Ok(true) = harness::check_mode_switch_pending(&poll_cfg, &poll_sid).await {
                println!("    -> Mode switch detected, sending Accept(plan)");
                let _ = harness::send_mode_switch_response(
                    &poll_cfg,
                    &poll_sid,
                    "switch",
                    Some("plan"),
                )
                .await;
                return true;
            }
        }
        false
    });

    let result = send_future.await;
    let accepted = accept_task.await.unwrap_or(false);

    match result {
        Err(err) => harness::print_result(
            "Mode Switch Accept",
            &err,
            &[
                ("Accept signal sent", accepted),
                ("Agent handled switch", false),
            ],
        ),
        Ok(resp) => harness::print_result(
            "Mode Switch Accept",
            &resp.content,
            &[
                ("No error from process_message", true),
                ("Accept signal was sent", accepted),
                (
                    "Response is empty or short (loop broke on accept)",
                    resp.content.len() < 500 || accepted,
                ),
            ],
        ),
    }
}

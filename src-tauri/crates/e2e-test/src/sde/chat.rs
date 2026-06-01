use super::tmp_workspace_path;
use crate::config::Config;
use crate::harness;

/// Per-step file reading: the agent reads 3 files sequentially and reports
/// the unique marker found in each one.
///
/// The HTTP interface only returns the final `content` field of the assistant
/// turn, so this scenario verifies tool-backed sequential file reads rather
/// than rendered streaming narration.
pub async fn per_step_narration(cfg: &Config) -> bool {
    use std::fs;

    let session_id = format!("{}-narration", cfg.session_prefix);
    let project = tmp_workspace_path("narration");

    let markers = [
        ("ALPHA_MARKER_7391", "alpha.txt"),
        ("BETA_MARKER_8204", "beta.txt"),
        ("GAMMA_MARKER_5517", "gamma.txt"),
    ];
    for (marker, filename) in &markers {
        let path = std::path::Path::new(&project).join(filename);
        let _ = fs::write(&path, format!("Content: {marker}\n"));
    }

    let prompt = "I have three files in the project: alpha.txt, beta.txt, and gamma.txt. \
         Please read each file one at a time and after reading each one, \
         tell me what you found in it before moving on to the next. \
         After reading all three, give a brief summary."
        .to_string();

    let resp =
        match harness::send_sde_message(cfg, &prompt, &session_id, "build", &project, None, false)
            .await
        {
            Err(err) => {
                return harness::print_error("SDE Per-Step Narration", &err);
            }
            Ok(response) => response,
        };

    let content = &resp.content;
    let has_alpha = content.contains("ALPHA_MARKER_7391");
    let has_beta = content.contains("BETA_MARKER_8204");
    let has_gamma = content.contains("GAMMA_MARKER_5517");
    let used_read = harness::assert_sde_tool_used(&resp, "read_file");

    harness::print_result(
        "SDE Per-Step Narration",
        content,
        &[
            (
                "All 3 file markers present in response",
                has_alpha && has_beta && has_gamma,
            ),
            ("Used read_file tool", used_read),
        ],
    )
}

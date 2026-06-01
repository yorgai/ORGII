use crate::tools::impls::web::browser_cli_tool::BrowserCliTool;
use crate::tools::names as tool_names;
use shared_state::{AgentBrowserConfig, BrowserAutomationProvider};

const DESCRIPTION: &str = r#"Control a real Chrome browser through Vercel's `agent-browser` CLI.

Pass the CLI subcommand in `command`; ORGII adds the executable, `--session orgii`, `--json`, and real-Chrome environment automatically.

Examples:
- `open https://example.com`
- `snapshot`
- `screenshot /tmp/page.png`
- `close`

Use this when you need browser automation with Vercel `agent-browser` semantics. The Playwright CLI tool is hidden when this provider is selected."#;

pub fn new(config: AgentBrowserConfig) -> BrowserCliTool {
    BrowserCliTool::new(
        tool_names::CONTROL_BROWSER_WITH_AGENT_BROWSER,
        "Agent Browser CLI",
        DESCRIPTION,
        BrowserAutomationProvider::AgentBrowser,
        config,
    )
}

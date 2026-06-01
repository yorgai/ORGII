use crate::tools::impls::web::browser_cli_tool::BrowserCliTool;
use crate::tools::names as tool_names;
use shared_state::{AgentBrowserConfig, BrowserAutomationProvider};

const DESCRIPTION: &str = r#"Control a browser through `playwright-cli`.

Pass the CLI subcommand in `command`; ORGII adds the executable and `-s=orgii` session flag automatically. In development, ORGII can run the local `playwright-cli.js` with Node when no path is configured.

Examples:
- `open https://example.com`
- `snapshot`
- `screenshot /tmp/page.png`
- `close`

Use this when you need browser automation with Playwright CLI semantics. The Vercel Agent Browser tool is hidden when this provider is selected."#;

pub fn new(config: AgentBrowserConfig) -> BrowserCliTool {
    BrowserCliTool::new(
        tool_names::CONTROL_BROWSER_WITH_PLAYWRIGHT,
        "Playwright CLI",
        DESCRIPTION,
        BrowserAutomationProvider::Playwright,
        config,
    )
}

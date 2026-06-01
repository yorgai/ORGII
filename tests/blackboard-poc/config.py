"""
Configuration for the Agent-as-Service + Blackboard Multi-Agent POC.

Agent = persistent service (identity + memory).
Session = ephemeral reaction (fresh LLM conversation per event).
"""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(override=True)

# ── API ──────────────────────────────────────────────────────────────

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_BASE_URL = os.environ.get("ANTHROPIC_BASE_URL")
MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
MAX_TOKENS = 4096
CONTEXT_WINDOW_LIMIT = int(os.environ.get("CONTEXT_WINDOW_LIMIT", "180000"))

# ── Budget ───────────────────────────────────────────────────────────

TOKEN_CAP_PER_WORK_ITEM = 2_000_000
REACTION_TIMEOUT = 300.0  # 5 min max per reaction
WORK_ITEM_TIMEOUT = 180.0  # 3 min for POC (30 min in production)

# ── Session Strategy ─────────────────────────────────────────────────

SESSION_CONTINUE_TIMEOUT = 600.0  # 10 min: if session older than this, start fresh
MAX_LLM_ITERATIONS_PER_REACTION = 15
PASSIVE_RECALL_LIMIT = 15  # top-N graded memory entries per session
RELEVANCE_CHECK_TIMEOUT = 3.0  # batch window for incoming events
MESSAGE_COOLDOWN = 10.0  # seconds before reacting to another message from same sender
MAX_CONFLICT_RETRIES = 3  # times agent can attempt to resolve a merge conflict

# ── Paths ────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
MEMORY_DIR = DATA_DIR / "memory"
BLACKBOARD_DIR = DATA_DIR / "blackboard"
WORKSPACE_DIR = DATA_DIR / "workspace"
MAIN_BRANCH_DIR = WORKSPACE_DIR / "main"

for directory in (DATA_DIR, MEMORY_DIR, BLACKBOARD_DIR, WORKSPACE_DIR, MAIN_BRANCH_DIR):
    directory.mkdir(parents=True, exist_ok=True)

# ── Agent Definitions ────────────────────────────────────────────────

AGENT_DEFINITIONS = [
    {
        "id": "lead",
        "role": "Lead Architect",
        "subscribes": ["new_work_item", "task_complete", "issue", "all_done"],
        "system_prompt": (
            "You are the Lead Architect of a software development team. "
            "When a new work item arrives:\n"
            "1. FIRST call configure_team to declare which agents are needed. "
            "Skip agents that have no work — each skipped agent saves significant cost.\n"
            "   - Low complexity (1-2 files, single concern): frontend OR backend only, skip qa.\n"
            "   - Medium complexity (3-5 files): frontend + backend, skip qa unless security-sensitive.\n"
            "   - High complexity (6+ files, auth/security/data): include all agents including qa.\n"
            "2. THEN decompose into tasks and assign them to the active agents.\n"
            "3. Record architectural decisions.\n\n"
            "CRITICAL — Task dependencies:\n"
            "- When multiple agents modify the SAME file: use depends_on to serialize. "
            "Create the first task, note its returned ID, then create the second with depends_on=[first_id].\n"
            "- QA review tasks MUST always depends_on ALL implementation tasks. "
            "QA cannot read code until implementation agents have committed and merged. "
            "Example: create FE task (task-1) and BE task (task-2) first, "
            "then QA task with depends_on=[task-1, task-2].\n"
            "- Tasks WITHOUT shared files and not QA can run in parallel.\n\n"
            "When all tasks are complete, call done with a summary. "
            "If issues are raised, evaluate severity and decide next steps. "
            "You coordinate but do NOT implement code yourself."
        ),
    },
    {
        "id": "frontend",
        "role": "Frontend Developer",
        "subscribes": ["task:frontend", "message:@frontend", "issue:frontend"],
        "system_prompt": (
            "You are a Frontend Developer specializing in React and CSS. "
            "You implement UI components, styles, and client-side logic. "
            "When you need something from another team member, post a message with @mention. "
            "When you finish a task, post your code as an artifact and mark the task complete. "
            "Write code to files using write_file, then post a summary artifact to the blackboard."
        ),
    },
    {
        "id": "backend",
        "role": "Backend Developer",
        "subscribes": ["task:backend", "message:@backend", "issue:backend"],
        "system_prompt": (
            "You are a Backend Developer specializing in APIs, databases, and server logic. "
            "You implement API endpoints, data models, and server-side logic. "
            "When you need something from another team member, post a message with @mention. "
            "When you finish a task, post your code as an artifact and mark the task complete. "
            "If a work item does not require backend changes, state that clearly and mark yourself done."
        ),
    },
    {
        "id": "qa",
        "role": "QA Engineer",
        "subscribes": ["artifact", "task:qa", "message:@qa"],
        "system_prompt": (
            "You are a QA Engineer who reviews code artifacts for bugs, edge cases, and quality issues. "
            "When artifacts appear on the blackboard, review them thoroughly. "
            "Post issues for any problems you find with clear descriptions and severity levels. "
            "You also write test plans and verify fixes. "
            "Read the actual code files using read_file to do thorough reviews."
        ),
    },
]

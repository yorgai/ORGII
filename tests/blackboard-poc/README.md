# Agent-as-Service + Blackboard Multi-Agent POC

Proof-of-concept for the multi-agent architecture described in
`Documentation/Agent/multi-agent/index--0315.md`.

**Key insight:** Agent = persistent service (identity + memory). Session = ephemeral
reaction (fresh LLM conversation per event).

## What This Demonstrates

1. **Agent-as-Service** — Agents are persistent services, but each reaction creates a
   fresh LLM session. No token accumulation across reactions.
2. **Shared Repo Memory** — Single memory store shared by all agents. Auto-captured from
   code actions (write_file, post_artifact). Citation-validated, graded passive recall.
3. **Blackboard Event Bus** — All communication through shared state. Loose coupling,
   full audit trail, natural parallelism.
4. **Token Budget** — Cumulative token cap per work item. When reached, in-flight
   reactions finish naturally, remaining tasks are parked.
5. **Worktree Isolation** (simulated) — Each agent works in its own directory (simulating
   git worktrees). Code sharing through commit + merge to main.
6. **Blackboard Compaction** — Completed entries compressed for context injection.
   Active entries stay full. Decisions always full.
7. **Session Continuation** — Direct replies/follow-ups continue existing session within
   timeout. Everything else starts fresh.

## Architecture

```
Orchestrator (lifecycle only)
  │ posts work item
  ▼
Blackboard (shared state + event bus)
  ├── tasks, artifacts, messages, decisions, issues
  │
  ├── Lead Service  ──→ Fresh Session ──→ Worktree (lead/)
  ├── Frontend Service ──→ Fresh Session ──→ Worktree (frontend/)
  ├── Backend Service  ──→ Fresh Session ──→ Worktree (backend/)
  └── QA Service     ──→ Fresh Session ──→ Worktree (qa/)
                                               │
                                          commit + merge
                                               ▼
                                          Main Branch (main/)
                                               │
                                     Repo Memory (shared)
```

## Setup

```bash
cd tests/blackboard-poc
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your API key and endpoint
```

## Run

```bash
# Full run with LLM API
python run.py

# Dry-run tests (no API calls)
python test_dry_run.py
```

## What Happens

1. Orchestrator boots 4 agent services (Lead, Frontend, Backend, QA)
2. Shared repo memory loaded from disk (carries knowledge across runs)
3. Work Item 1 posted: "Add dark mode toggle"
   - Agents create fresh sessions per event (no conversation accumulation)
   - Lead decomposes → tasks assigned via blackboard
   - Frontend/Backend implement in their worktrees → commit + merge to main
   - QA reviews artifacts, files issues
   - Token usage tracked cumulatively
4. Work Item 2 posted: "Add system preference detection"
   - Agents use repo memory from WI-1 (passive recall at session start)
   - Backend self-determines "no backend changes needed" (from memory)
5. Repo memory saved to disk for future runs

## Files

| File              | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `config.py`       | API config, budget, agent definitions, paths                  |
| `blackboard.py`   | Shared state + event bus with IDs, compaction, token tracking |
| `agent.py`        | Persistent agent service with fresh sessions per event        |
| `memory.py`       | Shared repo memory with auto-capture and graded recall        |
| `tools.py`        | Anthropic tool schemas + handlers with auto-capture           |
| `orchestrator.py` | Lifecycle manager with token budget enforcement               |
| `run.py`          | Entry point                                                   |
| `test_dry_run.py` | 9 tests covering all architecture components                  |

## Key Differences from Previous POC

| Aspect         | Previous (Always-On)      | Current (Agent-as-Service)   |
| -------------- | ------------------------- | ---------------------------- |
| Conversation   | Accumulates across events | Fresh per event              |
| Memory         | Per-agent, manual store   | Shared repo, auto-captured   |
| Token cost     | Grows unbounded           | Bounded per reaction         |
| Context bridge | Conversation history      | Repo memory + blackboard     |
| File isolation | Shared workspace          | Worktree per agent           |
| Budget         | None                      | Token cap per work item      |
| Entry IDs      | None                      | UUID on all entries          |
| Compaction     | None                      | Completed entries compressed |
| Delegation     | None                      | spawn_sub_agent (sync)       |

## Data Directory

```
data/
├── memory/
│   └── repo_memory.json    # Shared repo memory (all agents)
├── blackboard/
│   ├── 01-dark-mode.json   # Blackboard snapshot for WI-1
│   └── 02-system-preference.json
└── workspace/
    ├── main/               # Main branch (merge target)
    ├── lead/               # Lead's worktree
    ├── frontend/           # Frontend's worktree
    ├── backend/            # Backend's worktree
    └── qa/                 # QA's worktree
```

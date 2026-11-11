# orca-teamagent-harness-kit

[한국어](README.md) | **English**

**A Claude Code plugin that installs an Orca-based multi-agent harness into a new project in one step.**

It packages a role hierarchy (front desk, coordinator, team lead, team member) and the rules that hierarchy follows (waiting, approval, model assignment, verification, documentation) as skills, hooks, scripts, and templates. The plugin exposes a single skill, `setup`. The files it installs live under `template/`, mirroring the paths they take in the target project.

> **Base environment: Orca + Superpowers + TeamAgent Harness**
>
> This kit assumes all three are used together. It does not work if any one is missing.
>
> | Component | Role |
> | --- | --- |
> | **Orca** | Worker execution and orchestration (terminals, runs, tasks, messages) |
> | **Superpowers** | Design and planning skills (`brainstorming`, `writing-plans`) |
> | **TeamAgent Harness** (this kit) | Role hierarchy, rules, hooks, scripts, templates |

> **Note:** The installed skills, agent definitions, and `AGENTS.md` are written in Korean.

```
User
  │
Front desk (user session)          requirements interview and approvals, request triage, final report
  ├── planner                      design doc, implementation plan, DAG
  └── Coordinator (own terminal)   starts workers, collects results, updates the ledger, commits and opens the PR
        ├── Team lead ── Team member ×N
        ├── Team lead ── Team member ×N
        └── Verification lead ── QA, code review
```

## Quick Start

```sh
# 1. Install the plugin
claude plugin marketplace add topspeedz/orca-teamagent-harness-kit
claude plugin install orca-teamagent-harness-kit@orca-teamagent

# 2. Open Claude Code at the root of the target project and run
/orca-teamagent-harness-kit:setup
```

Once setup finishes, send work to the front desk session. You pick teams in step 7 of `setup` and can add more by hand later ([Adding a team](#adding-a-team)).

## Features

**Multi-Team Agent**

The team agent structure is based on [revfactory/harness](https://github.com/revfactory/harness). The difference is the number of teams.

| | revfactory/harness | This kit |
| --- | --- | --- |
| Approach | Single team | **Multi-Team Agent** |
| Structure | One agent team does the work | Several teams sit under the coordinator, each with a team lead and team members |
| Coordination | Coordinated inside the team | The coordinator uses a DAG to order and parallelize work across teams |

- Teams with different roles, such as product, development, verification, and harness, work together inside one phase.
- Each team has its own team skill. The team lead splits the team's tasks and supervises its members.
- Step 7 of `setup` recommends teams from past work and creates the ones you pick. You can also add teams from templates by hand later.

**Role hierarchy and size-based routing**

- The hierarchy goes two levels below the coordinator. Team members do not start workers, and workers do not commit.
- Requests are routed by size. The front desk handles small edits itself. For 1–2 tasks the coordinator starts workers directly. For 3 or more it starts a team lead. Large requests with unclear requirements start from the requirements interview.

**A fixed phase workflow**

```
1 Interview → 2 Design ✋ → 3 Plan ✋ → 4 Backlog sync → 5 Execution → 6 Close-out → 7 Harness retro → 8 Commit and PR ✋
```

- ✋ marks a user approval gate. Design and plan approvals come with a DAG swimlane diagram and a waterfall diagram.
- The planner writes the design doc and implementation plan in the format of the superpowers `brainstorming` and `writing-plans` skills.
- The retro is never skipped. If there is no evidence for a change, it records the measurements and "no change".

**Built-in roles**

| Team | Agent | Responsibility |
| --- | --- | --- |
| (shared) | `planner` | Design doc, implementation plan, DAG |
| Product | `product-manager` | Backlog, acceptance criteria, close-out |
| Verification | `qa-inspector` | Verification by running the product |
| Verification | `code-reviewer` | Code review (read-only) |
| Harness | `harness-engineer` | End-of-phase retro and harness improvements |

Domain teams such as development or design are not included. Step 7 of `setup` recommends them from past work and creates the ones you pick, or you add them from templates by hand.

**Hooks and scripts that enforce the rules**

| Component | What it does |
| --- | --- |
| `approval-gate` hook | Blocks commands that need user approval (deploy, push, and so on) in non-interactive sessions and tells the worker to escalate with `ask`. A force push always needs approval, whatever the project lists: it is not blocked outright, the user is asked |
| `orca-wait-gate` hook | Blocks any `check --wait` that violates the wait contract (started with a shell `&`, missing `--timeout-ms` or `--types`, or chained to other commands in one background line) |
| `compact-gate` hook | Defers automatic context compaction to the next turn boundary while the coordinator is in the middle of consecutive tool calls |
| `worker-intake-context` hook | Injects the worker rules into context when a worker starts |
| `secret-gate` hook | Blocks Playwright MCP calls that carry cookies, tokens or passwords, or that try to read cookies, so those values never land in the conversation log |
| `orca-launch.mjs` | Looks up the model assignment table, starts the worker, and sets the tab title in the form `[BL-0012] qa-inspector : opus/medium - verify checkout flow`. It also registers the coordinator's Tasks in Orca with their dependencies, and provides subcommands to list ready Tasks, hold a Task behind a decision gate, handle a failed verdict, and retry |
| `model-selection.mjs` | Validates the model assignment table (unknown agents, duplicate rows, unsupported combinations) |
| `report-check.mjs` | Evaluates the `## 검증` (verification) section of a worker report and checks that the Task's artifact files exist |
| `wait-contract-check.mjs` | Checks that the wait contract embedded in three skills matches its source file |
| `coordinator-settings.mjs` | Reads the allowlist and generates the coordinator-only settings file |
| `browser/launch.cjs`, `browser/probe-fps.cjs` | A launcher and a GPU probe for work that stays outside Playwright MCP: screenshot batches, 3D and WebGL measurement, and checks that need a login. Secrets are read only from a dotenv file and masked in logs |

Scripts and hooks use Node built-in modules only and ship with their own self-test (`*.check.mjs`). The browser launcher is the one exception: it uses Playwright (the project's copy, or the one Playwright MCP has already downloaded).

## Why use it

**Lower token usage for the coordinator**

- The coordinator runs with a dedicated settings file that enables the minimum set of plugins and skills. You choose what stays enabled in `.claude/coordinator.keep.json`.
- The coordinator does not wake up on every heartbeat. It waits with a single background job, and the five-line wait contract and a hook enforce this.
- The coordinator does not read full worker reports or rerun worker tests. It only checks the result of the report evaluation script.
- The coordinator starts as a fresh session after the plan is approved, so skills loaded during design do not stay in its context.

**Orca enforces Task order and decision holds**

- The coordinator registers the plan's Tasks, with their dependencies, in its own execution Run. Orca refuses to start a Task until the Tasks it depends on have finished.
- A Task that needs a user decision is held behind a gate and released once the decision arrives. If a Task it depends on is still unfinished, the script puts it back to waiting.
- When a worker reports success but its report fails the verdict, the script marks that Task failed, re-holds the Tasks that depend on it, and retries the same Task.
- Orca is the source of Task state. The ledger records only what Orca does not hold: the applied model, retry causes, questions, and report paths.
- A team lead does not create its own Run. Team members join the coordinator's execution Run, and one wait delivers both the members' reports and the coordinator's answers to the lead.

**Model and effort managed in one table**

- Each agent and task type has one row in `docs/harness/model-selection.md`. The planner does not pick models. It only assigns a task type.
- The launch script compares the assignment line in the spec, the table, and the arguments it was given, and refuses to start on a mismatch. An exception is allowed only when the user's instruction is recorded verbatim as the reason.

**Verification converges**

- Only High findings and unmet completion criteria get fixed. Medium and below go to the inbox.
- A recheck only confirms whether that defect still reproduces. A High finding first seen during a recheck still counts as open. The fix loop runs at most twice. If a High finding remains after that and a third round would be needed, the run stops and asks the user.
- The agent that implemented a change does not approve it. Implementation tasks write the test first (TDD).
- End-of-run QA runs as one worker per area, at the same time, and browser QA does too. Two lines in `.claude/settings.json` (`PLAYWRIGHT_MCP_ISOLATED`, `PLAYWRIGHT_MCP_HEADLESS`) give each worker its own browser.
- Those two lines apply to every session in the project. To use a visible browser that keeps its profile (logins) in a session you open yourself, including the front desk, start it with `claude --settings .claude/front-desk.settings.json`.

**Approval gates cannot be bypassed**

- In interactive sessions `permissions.ask` prompts the user. In non-interactive sessions the hook blocks the command. Both apply regardless of permission mode.
- The template does not choose teams or models for you. Open decisions go to a "user decision required" list in the document.

**Documentation stays under control**

- The working directory is `_workspace/<team>/<phase>/` and is excluded through `.gitignore`. File names follow one format: `NN_<agent>_<artifact>_v1.md`.
- No rule is written in two places. The wait contract, the model assignment table, and the team roster each have a single source of truth.

**Claude and Codex side by side**

- Shared rules live in one `AGENTS.md`. `CLAUDE.md` imports `@AGENTS.md`, and the Codex skills are pointers to the Claude originals.
- If you do not use Codex, setup leaves the Codex files out.

**Safe to rerun (idempotent)**

- The `setup` skill skips files with identical content. For existing files that differ, it shows a diff and overwrites only the ones you approve. Files you edited after installation are not overwritten.
- `.claude/settings.json` and `.gitignore` are merged, not overwritten.

## Requirements

### Base environment (required)

**Orca + Superpowers + TeamAgent Harness** is the base environment. Orca runs the workers, Superpowers provides the format for design and planning, and this kit adds the team structure and rules on top.

| Component | Details |
| --- | --- |
| **Orca** | Tested with CLI 1.4.255. The reference for run procedures is the guide from `orca skills get orchestration` |
| **Superpowers** | Claude Code plugin. The `brainstorming` and `writing-plans` skills are required |
| **TeamAgent Harness** | This plugin. Installed into a project with the `setup` skill |

### Other requirements

| Item | Details |
| --- | --- |
| Claude Code | Used to install the plugin and run the `setup` skill |
| Node | Runs the scripts and hooks. No extra packages to install |
| git | If the target project is not a git repository, the `setup` skill tells you and asks whether to continue |
| OS | Tested only on Windows with Git Bash |
| Codex | Needed only if you use it alongside Claude. You choose during setup |

- By default the coordinator runs on a 1M context window model (`opus`). The compaction start point of 350,000 and the ceiling of 500,000 assume that window.
- The permission mode of workers started with `worker-start` cannot be set with a command option. It follows Orca's "new agent tab" setting.
- The `setup` skill reports missing requirements. It does not install them for you.

## Installation

Register the GitHub repository as a marketplace and install.

```sh
claude plugin marketplace add topspeedz/orca-teamagent-harness-kit
claude plugin install orca-teamagent-harness-kit@orca-teamagent
```

Or clone the repository and register the local directory as a marketplace. Only this method has been tested.

```sh
git clone https://github.com/topspeedz/orca-teamagent-harness-kit.git
claude plugin marketplace add "<path to the cloned directory>"
claude plugin install orca-teamagent-harness-kit@orca-teamagent
```

## Usage

### 1. Run the `setup` skill

Open Claude Code at the root of the target project and run `/orca-teamagent-harness-kit:setup`. The skill runs in nine steps.

1. **Environment check**: git, Orca, Node, superpowers, the DAG swimlane and waterfall diagram skills, Codex, and existing instruction files (`AGENTS.md`, `CLAUDE.md`).
2. **Five questions**: whether to use Codex, which commands need user approval, the permission mode of the coordinator terminal, the planner's effort, and which plugins and skills stay enabled for the coordinator.
3. **Install**: skips files with identical content. For existing files that differ, shows a diff and overwrites only the approved ones.
4. **Generate settings**: updates the allowlist `.claude/coordinator.keep.json` and generates the coordinator settings file.
5. **Verify**: runs the installed self-tests, the model assignment table check, and the wait contract check.
6. **Foundation design**: runs the project's verification commands and records only the passing ones in the instructions, then sets forbidden commands (`permissions.deny`), document routing, and a token baseline.
7. **Team composition**: analyzes past session records and existing pipelines, recommends teams and team members with the evidence, then creates the team skills, agents, and role skills the user picks and adds them to the team roster and the model assignment table.
8. **Model table**: shows every row of the model assignment table on a survey page (Artifact) and writes only the values the user saved.
9. **Report**: installed files, skipped files, failed checks, foundation design results, teams created, and next steps.

In a project that does not use Orca, only steps 1, 6, and 9 run (the template is not installed).

Rerunning it adds only the missing files and runs verification again. You can also call the script directly.

```sh
node "<plugin directory>/skills/setup/scripts/setup.mjs" inspect --target .
node "<plugin directory>/skills/setup/scripts/setup.mjs" install --target . --answers <answers file> [--approve <path,...>]
node "<plugin directory>/skills/setup/scripts/setup.mjs" verify --target .
```

### 2. Configure the project

- Fill in the commands and tech stack sections of `AGENTS.md`. List only commands you have actually run.
- Adjust the model assignment table `docs/harness/model-selection.md`. The values it ships with are defaults.
- Teams are composed in step 7 of `setup`. The template has no implementation team, so if you created none in that step you cannot run implementation tasks.

### Adding a team

Step 7 of the `setup` skill analyzes past work, recommends teams, and creates the ones you pick. To add one by hand later, follow these steps.

1. Copy the team skill template `docs/harness/templates/team-skill.md` to `.claude/skills/team-<name>/SKILL.md` and fill it in.
2. Copy the agent template `docs/harness/templates/agent.md` to `.claude/agents/<name>.md` and fill it in.
3. Add a row for the team to the roster `docs/harness/team-org.md`.
4. Add rows for the new agent to the model assignment table `docs/harness/model-selection.md` and validate with `node .claude/scripts/model-selection.mjs check`.

The roster defines what a team is. The team skill defines how it works.

A completed example is in `examples/dev-team`: a team of one `developer` that works with `node --test` in a dependency-free Node project. The `setup` skill does not install this directory. To use it, follow the steps in that directory's `README.md`.

### 3. Send work

Requests to the front desk (your regular Claude Code session) are routed by the size rules in `AGENTS.md`.

| Request | Route |
| --- | --- |
| A simple question or a small edit to one file | The front desk handles it directly |
| A small, well-defined job (1–2 tasks for one team) | The coordinator starts workers directly, without a team lead |
| 3 or more tasks for one team, or splitting the work needs domain judgment | The coordinator starts a team lead, and the team lead starts team members |
| A large request with unclear requirements | The full workflow starting from the requirements interview (`plan-orchestrate` skill) |

## Installed files

```
AGENTS.md, CLAUDE.md             shared instructions and routing
.claude/
  agents/                        5 built-in agents
  skills/                        coordinator, team-lead, plan-orchestrate, phase-planning,
                                 backlog-management, qa-verification, change-review, harness-retro,
                                 team-product, team-qa, team-harness, dag-swimlane, waterfall-timeline
  hooks/                         approval, waiting, context compaction, worker rule injection,
                                 browser secret blocking
  scripts/                       worker launch, model assignment table, report evaluation,
                                 wait contract check, coordinator settings, browser launcher
  settings.json                  hook registration, permissions, and the two env lines for parallel
                                 browsers (merged into an existing file)
  front-desk.settings.json       turns those two env lines off in a session you open yourself
  coordinator.keep.json          allowlist of plugins and skills enabled for the coordinator
docs/
  backlog.md, backlog-archive.md
  harness/                       model assignment table, team roster, changelog, 8 templates
.agents/skills/                  pointers for Codex (only when Codex is selected)
```

## Untested environments

- macOS, Linux
- PowerShell without Git Bash
- Orca versions other than 1.4.255
- Installation through the GitHub marketplace instead of a local directory

## Development

```sh
claude plugin validate .                                  # plugin manifest
claude plugin validate .claude-plugin/marketplace.json    # marketplace manifest
```

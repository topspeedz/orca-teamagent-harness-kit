# orca-teamagent-harness-kit

[한국어](README.md) | **English**

**A Claude Code plugin that installs an Orca-based multi-agent harness into a new project in one step.**

Before execution approval, the front desk assigns planning work to the PM and Planner. After approval, the coordinator starts execution teams and its direct reports. The plugin provides `setup` for installation and `agent-author` for team composition. Project files live under `template/` and optional Codex files under `template-codex/`.

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
  ├── Operations team (no lead)
  │     ├── product-manager        PRD, SRS, backlog, plan review
  │     └── planner                requirements review, technical design, plan and DAG
  └── Coordinator (after execution approval)
        ├── Execution lead ── members     verification and project-specific teams
        ├── doc-steward                   checks document consistency after QA when the ledger has live-document rows
        └── harness-engineer              runs the retro after the document check when its conditions are met
```

## Quick Start

```sh
# 1. Install the plugin
claude plugin marketplace add topspeedz/orca-teamagent-harness-kit
claude plugin install orca-teamagent-harness-kit@orca-teamagent

# 2. Open Claude Code at the root of the target project and run
/orca-teamagent-harness-kit:setup
```

Once setup finishes, send work to the front desk session. Pick teams in step 7 of `setup` and use `agent-author` to add teams or members later ([Adding a team](#adding-a-team)).

## Features

**Multi-Team Agent**

The team agent structure is based on [revfactory/harness](https://github.com/revfactory/harness). The difference is the number of teams. The product team's methods (requirements, decomposition and complexity, RICE, planning review) are taken from [revfactory/harness-100's 46-product-manager](https://github.com/revfactory/harness-100/tree/main/ko/46-product-manager) (Apache-2.0) and rewritten for this kit's rules.

| | revfactory/harness | This kit |
| --- | --- | --- |
| Approach | Single team | **Multi-Team Agent** |
| Structure | One agent team does the work | A leadless operations team, execution teams with leads, and roles reporting directly to the coordinator |
| Coordination | Coordinated inside the team | The coordinator uses a DAG to order and parallelize work across teams |

- The PM and Planner are peers on the operations team. The front desk starts each worker, and they hand work over through the brief and their reports.
- Execution leads use their team skill to divide approved Tasks and supervise members. A lead can ask the Planner to break down a Task that needs detailed design.
- Step 7 of `setup` recommends teams from past work and creates the ones you pick. You can also add teams from templates by hand later.

**Role hierarchy and size-based routing**

- The hierarchy goes two levels below the coordinator. Team members do not start workers, and workers do not commit.
- The coordinator assigns an approved execution team's Tasks directly to its members. Having several Tasks does not call for a lead; only a Task the plan left to be split inside the team goes through one. When the agent that would lead is OFF, assignments to the team wait.

**Phase workflow and approvals**

```
New requirements · named backlog IDs · delegated phase → design and plan → execution approval → execution and QA → close-out → retro → commit and PR approval
```

- For new requirements, the PM writes the PRD, SRS and backlog items. If `plan-orchestrate`'s conditions are met, the Planner checks coverage and feasibility. The user confirms coverage and the batch before design starts. Named backlog IDs go straight to the Planner. Both routes require design and execution-plan approval.
- For a delegated phase, the PM selects the goal and items and gives the Planner the rationale. The user reviews the batch and estimated diagrams together at execution approval. Before execution the DAG shows pending Tasks and the waterfall shows T+ estimates. After approval, progress comes from the same Run.
- The planner writes the design doc and implementation plan in the format of the superpowers `brainstorming` and `writing-plans` skills.
- The retro runs when the measurement table shows a failure or a retry, the fix round reached 2, or five phases have passed since the last retro. Otherwise it is closed with `skip`, and the coordinator leaves the measurement table every time. If it runs and there is no evidence for a change, it records the measurements and "no change". The coordinator skill defines the conditions.
- During close-out, designated authors update their product documents. `doc-steward` checks them against the code and tests, maintains the index and links, and returns content defects to the author.

**Built-in roles**

| Team | Agent | Responsibility |
| --- | --- | --- |
| Operations | `product-manager` | Writes the PRD, SRS and acceptance criteria, organizes and prioritizes backlog items, selects a batch, reviews the plan and closes completed items |
| Operations | `planner` | Reviews requirements and produces the technical design, execution plan and DAG |
| Direct report | `doc-steward` | When the ledger's `## 라이브 문서 확인` has rows, checks product documents after QA and maintains their index and links |
| Verification | `qa-inspector` | Verification by running the product |
| Verification | `code-reviewer` | Code review (read-only) |
| Direct report | `harness-engineer` | When its conditions are met, runs the retro after document checks and makes changes supported by the findings |

Domain teams such as development or design are not included. Step 7 of `setup` recommends them from past work and creates the ones you pick, or you add them from templates by hand.

**Hooks and scripts that enforce the rules**

| Component | What it does |
| --- | --- |
| `approval-gate` hook | Blocks commands that need user approval (deploy, push, and so on) in non-interactive sessions and tells the worker to escalate with `ask`. A force push always needs approval, whatever the project lists: it is not blocked outright, the user is asked |
| `orca-wait-gate` hook | Blocks a `check --wait` run directly instead of through `orca-launch.mjs wait` when it is started with a shell `&`, lacks `--timeout-ms` or `--types`, or is chained to other commands in one background line |
| `compact-gate` hook | Defers automatic context compaction to the next turn boundary while the coordinator is in the middle of consecutive tool calls |
| `worker-intake-context` hook | Injects the worker rules into context when a worker starts |
| `secret-gate` hook | Blocks Playwright MCP calls that carry cookies, tokens or passwords, or that try to read cookies, so those values never land in the conversation log |
| `orca-launch.mjs` | Starts workers in the execution Run with the approved Task assignments and shows the role, model and effort in each tab. Supports dependency registration, ready Tasks, decision gates, failure handling and retries. The `skip` command closes a Task whose node has `conditional: true`, or a fix or recheck Task in `rounds`, without running a worker |
| `tree-snapshot.mjs` | Snapshots the whole working folder as a tree without touching the real index or working tree (`take`) and lists the files that changed between two trees (`diff`) |
| `defect-ledger.mjs` | Copies the report's `## 결함` table into the ledger's `## 결함 원장`. A High row with no evidence is recorded as Medium, and an existing row is never rewritten |
| `model-selection.mjs` | Validates the model assignment table (unknown agents, duplicate rows, unsupported combinations) |
| `report-check.mjs` | Evaluates the `## 검증` (verification) section of a worker report and checks that the Task's artifact files exist |
| `coordinator-settings.mjs` | Reads the allowlist and generates the coordinator-only settings file |
| `browser/launch.cjs`, `browser/probe-fps.cjs` | A launcher and a GPU probe for work that stays outside Playwright MCP: screenshot batches, 3D and WebGL measurement, and checks that need a login. Secrets are read only from a dotenv file and masked in logs |

Scripts and hooks use Node built-in modules only and ship with their own self-test (`*.check.mjs`). The browser launcher is the one exception: it uses Playwright (the project's copy, or the one Playwright MCP has already downloaded).

## Why use it

**Lower token usage for the coordinator**

- The coordinator runs with a dedicated settings file that enables the minimum set of plugins and skills. You choose what stays enabled in `.claude/coordinator.keep.json`.
- The coordinator does not wake up on heartbeats, redeliveries or timeouts. It waits with one background `orca-launch.mjs wait`, which ends only when there is mail to act on. Settling a `worker_done` (the four checks, failing the Task, the defect ledger, the snapshot) is one `orca-launch.mjs settle` command.
- The coordinator does not read full worker reports or rerun worker tests. It only checks the result of the report evaluation script.
- The coordinator starts as a fresh session after the plan is approved, so skills loaded during design do not stay in its context.

**Orca enforces Task order and decision holds**

- The coordinator registers the plan's Tasks, with their dependencies, in its own execution Run. Orca refuses to start a Task until the Tasks it depends on have finished.
- A Task that needs a user decision is held behind a gate and released once the decision arrives. If a Task it depends on is still unfinished, the script puts it back to waiting.
- When a worker reports success but its report fails the verdict, the script marks that Task failed, re-holds the Tasks that depend on it, and retries the same Task.
- Orca is the source of Task state. The ledger records only what Orca does not hold: the applied model, retry causes, questions, and report paths.
- A team lead does not create its own Run. Team members join the coordinator's execution Run, and one wait delivers both the members' reports and the coordinator's answers to the lead.

**Model and effort managed in one table**

- The PM records backlog evidence for complexity, uncertainty, impact and verification. The Planner scores each Task and team member, consulting Haiku only when competing interpretations could change the assignment. On the DAG, users can lock a model and effort or delegate reassessment just before launch. The coordinator and team leads apply the approved runtime and model mapping. [Routing rubric and Astra ultra mapping](template/docs/harness/model-selection.md)
- Editing the table changes the next plan. Changing a Task in the current Run requires an updated assignment and DAG and renewed approval.

**Verification converges**

- Only High findings and unmet completion criteria get fixed. Medium and below go to the inbox.
- The end-of-run code review first runs the checks that need no browser (syntax, types, lint, unit tests) once on the combined code.
- Each fix leaves a reproduction test per defect, and right after the fixes the coordinator runs the final test, which checks them. A recheck is run only for a defect that has no reproduction test, and it only confirms whether that defect still reproduces. A High finding first seen during a recheck still counts as open. The fix loop runs at most twice. If a High finding remains after that and a third round would be needed, the run stops and asks the user.
- The agent that implemented a change does not approve it. Implementation tasks write the test first (TDD).
- End-of-run QA runs as one worker per area, at the same time, and browser QA does too. Two lines in `.claude/settings.json` (`PLAYWRIGHT_MCP_ISOLATED`, `PLAYWRIGHT_MCP_HEADLESS`) give each worker its own browser.
- Those two lines apply to every session in the project. To use a visible browser that keeps its profile (logins) in a session you open yourself, including the front desk, start it with `claude --settings .claude/front-desk.settings.json`.
- Verification that needs a resource only one worker can use at a time (a GPU, Blender MCP) is not split. Implementation Tasks finish on simple code tests that run without that resource, and one Task runs the resource-using verification once, after all implementation is done.

**Approval gates cannot be bypassed**

- In interactive sessions `permissions.ask` prompts the user. In non-interactive sessions the hook blocks the command. Both apply regardless of permission mode.
- The template does not choose teams or models for you. Open decisions go to a "user decision required" list in the document.

**Documentation stays under control**

- The working directory is `_workspace/<team>/<phase>/` and is excluded through `.gitignore`. File names follow one format: `NN_<agent>_<artifact>_v1.md`.
- No rule is written in two places. The model assignment table and the team roster each have a single source of truth, and steps that need no judgment (waiting, settling) live in scripts rather than in instructions.
- Team reports preserve the work history. Each designated author writes and maintains their assigned live document or section. The PM writes the PRD and SRS. `doc-steward` maintains the index and checks consistency. For a document without an owner, the user can create a role, defer the assignment or mark it inapplicable.
- On a fresh install, setup uses the 12 forms under `docs/harness/templates/product-docs/` to prepare 13 drafts covering the codebase map and the twelve numbered folders. Existing canonical paths in the index and edited documents are preserved.

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
5. **Verify**: runs the installed self-tests and the model assignment table check.
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

After setup, use `/orca-teamagent-harness-kit:agent-author` to add an independent role, a member of an existing team or a whole execution team. The skill checks existing roles and original sources, proposes specialist decisions, collaborators and unassigned documents or sections, then records the approved scope in the role definitions and roster and updates the relevant team skill and model rows. [Team composition skill](skills/agent-author/SKILL.md)

To add a team by hand, follow these steps.

1. Copy the team skill template `docs/harness/templates/team-skill.md` to `.claude/skills/team-<name>/SKILL.md` and fill it in.
2. Copy the agent template `docs/harness/templates/agent.md` to `.claude/agents/<name>.md` and fill it in.
3. Add a row for the team to the roster `docs/harness/team-org.md`.
4. Add task-type rows to `docs/harness/model-selection.md`. Run `node .claude/scripts/model-selection.mjs check` and `node .claude/scripts/agent-definition.mjs --agent <name>` for each new role.

If the project uses Codex, add a matching team skill pointer and run `node "<plugin directory>/skills/setup/scripts/setup.mjs" sync-agent --target . --agent <name>` for each new role.

A completed example is in `examples/dev-team`: a team of one `developer` that works with `node --test` in a dependency-free Node project. The `setup` skill does not install this directory. To use it, follow the steps in that directory's `README.md`.

### 3. Send work

Requests to the front desk (your regular Claude Code session) are routed by the size rules in `AGENTS.md`.

| Request | Route |
| --- | --- |
| A simple question or a small edit to one file | The front desk handles it directly |
| New requirements | The PM creates backlog items and the Planner reviews the requirements |
| Named backlog IDs / delegated phase | Named IDs go directly to the Planner. For a delegated phase, the PM selects a batch |
| Approved execution-team work | The coordinator assigns members directly. Only a Task the plan left to be split inside the team goes through the lead. With the lead agent OFF, the team's assignments wait. |

## Installed files

```
AGENTS.md, CLAUDE.md             shared instructions and routing
.claude/
  agents/                        6 built-in agents
  skills/                        coordinator, team-lead, plan-orchestrate, phase-planning,
                                 backlog-management, qa-verification, change-review, harness-retro,
                                 docs-management, requirements-write, product-review, team-qa,
                                 dag-swimlane, waterfall-timeline
  hooks/                         approval, waiting, context compaction, worker rule injection,
                                 browser secret blocking
  scripts/                       worker launch, wait and settle, model assignment table,
                                 report evaluation, coordinator settings, browser launcher
  settings.json                  hook registration, permissions, and the two env lines for parallel
                                 browsers (merged into an existing file)
  front-desk.settings.json       turns those two env lines off in a session you open yourself
  coordinator.keep.json          allowlist of plugins and skills enabled for the coordinator
docs/
  backlog.md, backlog-archive.md
  DOCUMENTATION_INDEX.md         index of product docs
  CODEBASE_MAP.md, 01-… to 12-…  13 drafts prepared by setup
  harness/                       model table, team roster, changelog, harness templates
    templates/product-docs/      12 live-document forms
.agents/skills/                  pointers for Codex (only when Codex is selected)
```

After installing the plugin, run `/orca-teamagent-harness-kit:agent-toggle` in the target project to open the agent toggles and live team chart. [Skill guide](skills/agent-toggle/SKILL.md)

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

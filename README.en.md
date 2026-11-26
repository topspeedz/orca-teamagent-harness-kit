# orca-teamagent-harness-kit

[한국어](README.md) | **English**

**A Claude Code plugin that installs an Orca-based multi-agent harness into a new project in one step.**

Before execution approval, the front desk gives planning to one `product-manager` session. After approval, the coordinator assigns the plan's Tasks directly to knowledge-unit agents. The plugin provides `setup` for installation and `agent-author` for composing agents and skills. Project files live under `template/` and optional Codex files under `template-codex/`.

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
  ├── product-manager              PM: requirements, backlog, design, plan (skills)
  └── Coordinator (after execution approval)
        ├── research               research, split across in-session subagents
        ├── frontend               UX · UI · development · test code (skills)
        ├── backend                database · backend · performance · security (skills)
        ├── verifier               code review · QA (unit tests, browser checks) (skills)
        ├── doc-steward            checks document consistency after QA when the ledger has live-document rows
        └── harness-engineer       runs the retro after the document check when its conditions are met
```

## Quick Start

```sh
# 1. Install the plugin
claude plugin marketplace add topspeedz/orca-teamagent-harness-kit
claude plugin install orca-teamagent-harness-kit@orca-teamagent

# 2. Open Claude Code at the root of the target project and run
/orca-teamagent-harness-kit:setup
```

Once setup finishes, send work to the front desk session. Pick the skills to add to agents and any new agents in step 7 of `setup`, and use `agent-author` to add them later ([Adding agents and skills](#adding-agents-and-skills)).

## Features

**Knowledge-unit agents**

Instead of agents split finely by job title with a managing layer above them, the kit has one agent for each unit whose knowledge has to be shared. Expertise comes from the skills an agent reads when it needs them, not from more agents. The basis is Anthropic's [When to fold subagents into your main agent loop](https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop) (2026-10-22): giving each team or problem type its own subagent turns the agent structure into a copy of the org chart, and one agent with skills often gave better quality than a subagent design, at lower cost and latency. The PM's methods (requirements, decomposition and complexity, RICE, planning review) are taken from [revfactory/harness-100's 46-product-manager](https://github.com/revfactory/harness-100/tree/main/ko/46-product-manager) (Apache-2.0) and rewritten for this kit's rules.

- Planning is one `product-manager` session: requirements, requirements review, backlog items, design, plan, and checking the plan against the acceptance criteria happen in the same context.
- One building agent (`frontend` or `backend`) takes a backlog item from start to finish: detailed design, implementation and test code in the same context. There are two handoffs: from the plan to the building agent, and from the building agent to `verifier`.
- `verifier` keeps code review by reading (`change-review`) and verification by running (`qa-verification`) as separate skills. It does not inherit the builder's judgment.
- `research` splits a question into independent sub-questions, hands them to in-session subagents in parallel, and returns one report with checked sources. Only `research` fans work out.
- The default is to add a skill to an existing agent. A new agent is created only when one of three criteria is true: putting the work into an existing agent was seen to bloat its context and hurt performance; the work runs in parallel with other work and its context can be thrown away when it ends; or its tools or instructions conflict with an existing agent's. A different job title is not a reason.

**Role hierarchy and size-based routing**

- There are no teams. The agents under the coordinator are all on one level and do not start Orca workers, and workers do not commit.
- The coordinator assigns an approved plan's Tasks directly to agents in the roster (`docs/harness/agents.md`). The same agent can run as several workers, one per unit of work whose edit scopes do not overlap. When an agent is OFF, its assignments wait.

**Phase workflow and approvals**

```
New requirements · named backlog IDs · delegated phase → design and plan → execution approval → execution and QA → close-out → retro → commit and PR approval
```

- For new requirements, the PM writes the PRD, SRS and backlog items and checks coverage and feasibility in the same session. The user confirms coverage and the batch, then the same session continues into design and planning. Named backlog IDs go straight to the PM's design. Both routes require design and execution-plan approval.
- For a delegated phase, the PM selects the goal, items and rationale and continues to the plan in the same session. The user reviews the batch and estimated diagrams together at execution approval. Before execution the DAG shows pending Tasks and the waterfall shows T+ estimates. After approval, progress comes from the same Run.
- The PM writes the design doc and implementation plan in the format of the superpowers `brainstorming` and `writing-plans` skills. When the design needs sources gathered for a question, the front desk starts `research` before the design.
- The retro runs when the measurement table shows a failure or a retry, the fix round reached 2, or five phases have passed since the last retro. Otherwise it is closed with `skip`, and the coordinator leaves the measurement table every time. If it runs and there is no evidence for a change, it records the measurements and "no change". The coordinator skill defines the conditions.
- An agent that changes a product fact updates the documents it owns in the same Task. `doc-steward` checks them against the code and tests, maintains the index and links, and returns content defects to the owning agent.

**Built-in roles**

| Agent | Responsibility | Skills |
| --- | --- | --- |
| `product-manager` | Writes and reviews requirements, the PRD and SRS; organizes, prioritizes and batches backlog items; writes the design, plan and DAG; checks the plan; closes completed items | `requirements-write`, `backlog-management`, `product-review`, `phase-planning`, `plan-orchestrate`, `docs-management` |
| `research` | Read-only research. Hands sub-questions to in-session subagents in parallel and returns one research report | `research`, `docs-management` |
| `frontend` | UX and UI design, frontend development and test code for a screen | `frontend-ux`, `frontend-ui`, `frontend-dev`, `frontend-test`, `docs-management` |
| `backend` | Database, backend development, performance, security | `backend-db`, `backend-dev`, `backend-performance`, `backend-security`, `docs-management` |
| `verifier` | Mid-run change review (reading), end verification per area (reading and running), rechecks | `change-review`, `qa-verification`, `docs-management` |
| `doc-steward` | When the ledger's `## 라이브 문서 확인` has rows, checks product documents after QA and maintains their index and links | `docs-management` |
| `harness-engineer` | When its conditions are met, runs the retro after document checks and makes changes supported by the findings | `harness-retro`, `docs-management` |

The roster's source is `docs/harness/agents.md`. The eight `frontend` and `backend` skills are installed as names and frames only. Step 7 of `setup` fills them through `agent-author`'s "fill skill bodies" from the project's technology and past work, and sets the two agents' edit scopes at the same time.

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
| `test-ledger.mjs` | Copies the JSON result of the full test run (vitest, jest) into the latest-result column of the test case ledger and switches `구현됨`/`검증됨` in the traceability matrix. A case missing from the run keeps its result and is listed |
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
- Workers do not create their own Run. Every worker after execution approval joins the coordinator's execution Run.

**Model and effort managed in one table**

- Scores belong to Tasks, not agents. The PM records backlog evidence for complexity, uncertainty, impact and verification, and the plan gives each Task C, U, R and V values with reasons. `model-routing.mjs plan` computes the model and effort, consulting Haiku only when competing interpretations could change the assignment. On the DAG, users can lock a model and effort or delegate reassessment just before launch. The coordinator applies the approved runtime and model mapping.
- A Task on a formula row of the model table (model `복잡도`) does not launch without scores. The launch script refuses instead of falling back to a default. A worker started outside the plan (such as `research` before the design) passes its scores with `--assessment`.
- The PM's planning session launches with the one model and effort chosen in `setup` (default fable/xhigh), and the same session uses it from requirements through the plan. [Routing rubric and Astra ultra mapping](template/docs/harness/model-selection.md)
- Editing the table changes the next plan. Changing a Task in the current Run requires an updated assignment and DAG and renewed approval.

**Verification converges**

- Only High findings and unmet completion criteria get fixed. Medium and below go to the inbox.
- When implementation is done, the coordinator runs the full test suite once. Failures go to a test-update Task for the agent that wrote the code, and end verification does not rerun the full suite.
- Each fix leaves a reproduction test per defect, and right after the fixes the coordinator runs the final test, which checks them. A recheck is run only for a defect that has no reproduction test, and it only confirms whether that defect still reproduces. A High finding first seen during a recheck still counts as open. The fix loop runs at most twice. If a High finding remains after that and a third round would be needed, the run stops and asks the user.
- The agent that implemented a change does not approve it. Implementation tasks write the test first (TDD).
- End verification is one `verifier` Task per area that both reads the code and runs it, and the per-area workers run at the same time. Browser verification does too. Two lines in `.claude/settings.json` (`PLAYWRIGHT_MCP_ISOLATED`, `PLAYWRIGHT_MCP_HEADLESS`) give each worker its own browser.
- Those two lines apply to every session in the project. To use a visible browser that keeps its profile (logins) in a session you open yourself, including the front desk, start it with `claude --settings .claude/front-desk.settings.json`.
- Verification that needs a resource only one worker can use at a time (a GPU, Blender MCP) is not split. Implementation Tasks finish on simple code tests that run without that resource, and one Task runs the resource-using verification once, after all implementation is done.

**Approval gates cannot be bypassed**

- In interactive sessions `permissions.ask` prompts the user. In non-interactive sessions the hook blocks the command. Both apply regardless of permission mode.
- The template does not choose agents or models for you. Open decisions go to a "user decision required" list in the document.

**Documentation stays under control**

- The working directory is `_workspace/<work folder>/<phase>/` and is excluded through `.gitignore`. File names follow one format: `NN_<agent>_<artifact>_v1.md`.
- No rule is written in two places. The model assignment table and the agent roster each have a single source of truth, and steps that need no judgment (waiting, settling) live in scripts rather than in instructions.
- Work reports preserve the work history. The agent that owns a live document or section writes and maintains it. Every agent writes its own documents with `docs-management`, the PM writes the PRD and SRS, and `doc-steward` maintains the index and checks consistency. For a document without an owner, the user can create a role, defer the assignment or mark it inapplicable.
- On a fresh install, setup uses the 12 forms under `docs/harness/templates/product-docs/` to prepare 13 drafts covering the codebase map and the twelve numbered folders. Existing canonical paths in the index and edited documents are preserved.

**Claude and Codex side by side**

- Shared rules live in one `AGENTS.md`. `CLAUDE.md` imports `@AGENTS.md`, and the Codex skills are pointers to the Claude originals.
- If you do not use Codex, setup leaves the Codex files out.

**Safe to rerun (idempotent)**

- The `setup` skill skips files with identical content. For existing files that differ, it shows a diff and overwrites only the ones you approve. Files you edited after installation are not overwritten.
- `.claude/settings.json` and `.gitignore` are merged, not overwritten.

## Requirements

### Base environment (required)

**Orca + Superpowers + TeamAgent Harness** is the base environment. Orca runs the workers, Superpowers provides the format for design and planning, and this kit adds the agent structure and rules on top.

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
2. **Five questions**: whether to use Codex, which commands need user approval, the permission mode of the coordinator terminal, the PM's model and effort (default fable/xhigh), and which plugins and skills stay enabled for the coordinator.
3. **Install**: skips files with identical content. For existing files that differ, shows a diff and overwrites only the approved ones.
4. **Generate settings**: updates the allowlist `.claude/coordinator.keep.json` and generates the coordinator settings file.
5. **Verify**: runs the installed self-tests and the model assignment table check.
6. **Foundation design**: runs the project's verification commands and records only the passing ones in the instructions, then sets forbidden commands (`permissions.deny`), document routing, and a token baseline.
7. **Agent unit composition**: analyzes past session records and existing pipelines, recommends with the evidence the skills to add to existing agents, changes to a built-in agent's name, skills or edit scope, and new agents, then creates what the user picks and adds it to the agent roster and the model assignment table. Fills the bodies of frame-only skills. In a 0.5.1 project, moves the old roles first.
8. **Model table**: shows every row of the model assignment table on a survey page (Artifact) and writes only the values the user saved.
9. **Report**: installed files, skipped files, failed checks, foundation design results, skills added and agents created, and next steps.

In a project that does not use Orca, only steps 1, 6, and 9 run (the template is not installed).

Rerunning it adds only the missing files and runs verification again. For a project on 0.5.x, read [Upgrading from 0.5.x](#upgrading-from-05x) first. You can also call the script directly.

```sh
node "<plugin directory>/skills/setup/scripts/setup.mjs" inspect --target .
node "<plugin directory>/skills/setup/scripts/setup.mjs" install --target . --answers <answers file> [--approve <path,...>]
node "<plugin directory>/skills/setup/scripts/setup.mjs" verify --target .
```

### 2. Configure the project

- Fill in the commands and tech stack sections of `AGENTS.md`. List only commands you have actually run.
- Adjust the model assignment table `docs/harness/model-selection.md`. The values it ships with are defaults.
- The `frontend` and `backend` skills are installed as frames only. If you did not fill them in step 7 of `setup`, fill them later with `agent-author`. If the roster still shows `프로젝트가 정한다` (set by the project) as the two agents' edit scope, set the real paths then.

### Adding agents and skills

After setup, use `/orca-teamagent-harness-kit:agent-author` for three things: adding a skill to an existing agent (the default), filling the body of a frame-only skill, and creating a new agent (only when one of the three criteria is true). The skill checks existing roles and original sources and proposes specialist decisions, collaborators and unassigned documents or sections. It records the scope you choose in the role definitions, the roster and the model table. [Agent authoring skill](skills/agent-author/SKILL.md)

To add a skill by hand, follow these steps.

1. Copy the skill template `docs/harness/templates/skill.md` to `.claude/skills/<skill>/SKILL.md` and fill it in.
2. Put the same name in the agent's role file `.claude/agents/<agent>.md` (the `- 로드할 스킬:` line and the `## 작업 단위와 스킬` table) and in the skills column of the roster `docs/harness/agents.md`.
3. If a new unit of work appears, add a formula row (model `복잡도`) for it to `docs/harness/model-selection.md`.
4. Run `node .claude/scripts/agent-definition.mjs --agent <agent>` and `node .claude/scripts/model-selection.mjs check`.

For a new agent, copy the agent template `docs/harness/templates/agent.md` to `.claude/agents/<name>.md` and fill it in, add one roster row (`| 에이전트 | 맡는 단위 | 스킬 | 편집 범위 |`) and a formula row in the model table, then run the same two checks.

If the project uses Codex, add a pointer `.agents/skills/<skill>/SKILL.md` with the same name for each new skill, and run `node "<plugin directory>/skills/setup/scripts/setup.mjs" sync-agent --target . --agent <name>` for each role you changed.

A completed example is in `examples/dev-team`: in a dependency-free Node project that works with `node --test`, it fills the `frontend-dev` and `backend-dev` skills and sets the roster's edit scopes for `frontend` and `backend`. The `setup` skill does not install this directory. To use it, follow the steps in that directory's `README.md`.

### 3. Send work

Requests to the front desk (your regular Claude Code session) are routed by the size rules in `AGENTS.md`.

| Request | Route |
| --- | --- |
| A simple question or a small edit to one file | The front desk handles it directly |
| New requirements | The PM creates backlog items and reviews the requirements in the same session |
| Named backlog IDs / delegated phase | Named IDs go straight to the PM's design. For a delegated phase, the PM selects a batch |
| A Task in an approved plan | The coordinator assigns it directly to the Task's agent. With that agent OFF, the assignment waits |

## Installed files

```
AGENTS.md, CLAUDE.md             shared instructions and routing
.claude/
  agents/                        7 built-in agents
  skills/                        coordinator, plan-orchestrate, phase-planning, requirements-write,
                                 backlog-management, product-review, research, change-review,
                                 qa-verification, docs-management, harness-retro, dag-swimlane,
                                 waterfall-timeline, frontend-ux, frontend-ui, frontend-dev,
                                 frontend-test, backend-db, backend-dev, backend-performance,
                                 backend-security (frontend-* and backend-* are frames)
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
  harness/                       model table, agent roster, changelog, harness templates
    templates/product-docs/      12 live-document forms
.agents/skills/                  pointers for Codex (only when Codex is selected)
```

After installing the plugin, run `/orca-teamagent-harness-kit:agent-toggle` in the target project to open the agent toggles and live agent chart. [Skill guide](skills/agent-toggle/SKILL.md)

## Upgrading from 0.5.x

0.6.0 changes the roster format and is not compatible with 0.5.x. No code reads the old roster alongside the new one. Move a 0.5.x project to the new structure by rerunning `setup` and following `agent-author`'s "0.5.1 프로젝트 옮기기" (moving a 0.5.1 project).

1. **Finish a phase in progress on 0.5.1.** A newly started coordinator cannot continue a phase approved under 0.5.1: the launch stops with one of two messages. If the old DAG has a node with `members`, the review stops first with `<node ID>의 팀 내부 배정(members)은 없어졌습니다. 일마다 Task 하나로 나눠 다시 그리세요` (in-team assignment with `members` is gone; split the work into one Task each and redraw). Otherwise the approval record's hash differs and it stops with `현재 계획·DAG와 실행 승인 버전이 다름` (the current plan and DAG differ from the approved version). If you could not finish it, get the plan approved again after upgrading. Do not upgrade in the middle of a phase.
2. **Commit the working tree.** The move deletes project files. To roll back, return to that commit.
3. **Upgrade the plugin and rerun `setup`.** While `docs/harness/agents.md` is absent, that is, until you rerun `setup`, the scripts stop with `docs/harness/agents.md가 없고 옛 명단(team-org.md)만 있습니다. setup을 다시 돌려 새 구조로 옮기세요.` (only the old roster exists; rerun setup to move to the new structure). After the rerun they work even while `agent-author`'s move is still pending.
   - In the answers file, `planner.effort` is replaced by `pm.model` and `pm.effort` (default fable/xhigh). Install refuses the old key.
   - Setup deletes the retired files that the kit installed and the project did not edit (the `team-lead` and `team-qa` skills, `team-skill.md`, the `planner`, `code-reviewer` and `qa-inspector` roles and their Codex definitions). A retired file the project edited, or one missing from the install record, is listed as a conflict and deleted only when approved with `install --approve <path>`.
   - It installs the new roster `docs/harness/agents.md` and the new built-in agents. `docs/harness/team-org.md` stays.
   - Kit files whose content changed in 0.6.0 (scripts, skills, `AGENTS.md`, built-in role files and so on) are listed as conflicts even when the project did not edit them, and install ends with code 2. Review the diff and overwrite only the paths you approve with `install --approve <path,...>`. Until then those files stay at their 0.5.1 version.
   - A kit file the project edited after setup installed it (for example an old `product-manager.md`) is skipped as `사용자가 고침` (edited by the user) and is not overwritten, even with `--approve`. It stays at its 0.5.1 version, so port it by hand following step 5 of `agent-author`'s "0.5.1 프로젝트 옮기기". This covers the model table (rebuild `## 배정 표` from the 0.6.0 template rows and put in the PM values chosen in `setup`), `AGENTS.md` (replace its `## 하네스` section with the template's), edited built-in role files and an edited `docs/DOCUMENTATION_INDEX.md`. If the model table's PM row differs from the chosen values, the install output says so in `notices`, and until the port `verify` fails for each agent that has no rows in the model table. A built-in agent's role file that the project removed after setup installed it is not installed again; every other missing kit file is.
4. **Merge the roles the project created with `agent-author`'s move procedure.** Step 7 of `setup` calls it. For each role you get a recommendation to merge it into a knowledge unit or keep it separate, you choose, and its knowledge moves into that unit's skills. At the end it deletes the old role files, the old team skills, the toggled-off copies of old roles (`*.md.agent-toggle-off`) and `docs/harness/team-org.md`.

Changed commands and formats:

- A DAG node in the plan has no `members`. The launch script has no `--lead`, `--parent` or `--complexity`.
- A formula row of the model table launches only with scores. A worker started outside a Run (such as `research` before the design) passes them with `--assessment <JSON>`.
- A user-scope `agent-toggle` skill can be brought to this version with `integrations/agent-toggle/agent-toggle.patch`. Apply it with `git apply` in that skill's folder.

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

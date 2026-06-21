# Atomic Agents — GitHub Copilot plugin

A drop-in **GitHub Copilot** plugin (VS Code) for building, scaffolding, understanding, and auditing applications with the
[Atomic Agents](https://github.com/eigenwise/atomic-agents) Python framework. It mirrors the Claude Code plugin: the same
skills, now as Copilot **slash commands** you run in Copilot Chat.

> Every file in `.github/` here is **generated** from the canonical Claude Code plugin
> (`../claude-plugin/atomic-agents/`) by [`../tools/compile_copilot.mjs`](../tools/compile_copilot.mjs). One source of
> truth, two targets — don't hand-edit the generated files; edit the source and recompile.

## What you get

13 slash commands (type `/` in Copilot Chat) + always-on framework guidance:

| Command | Use it to |
|---|---|
| `/atomic-new-app` | Scaffold a new project from zero |
| `/atomic-create-schema` | Design a `BaseIOSchema` input/output pair |
| `/atomic-create-agent` | Build and wire an `AtomicAgent` |
| `/atomic-create-tool` | Build a `BaseTool` subclass |
| `/atomic-create-context-provider` | Inject dynamic data into the prompt |
| `/atomic-configure-provider` | Switch / wire an LLM provider |
| `/atomic-add-memory` | Wire `ChatHistory`, persistence, summarization |
| `/atomic-add-hooks` | Add error handling, retries, telemetry |
| `/atomic-orchestrate` | Route / chain / supervise multiple agents |
| `/atomic-test` | Scaffold pytest coverage (mocked providers) |
| `/atomic-explore` | Map an existing atomic-agents codebase |
| `/atomic-review` | Audit code for framework-specific defects |
| `/atomic-plan` | Generate an ADO Epic→Feature→Stories backlog for an agent |
| `/atomic-sync` | Link branches/PRs back to their ADO work items |
| `/atomic-framework` | Ask anything about the framework |

Plus:
- **`.github/copilot-instructions.md`** — always-on framework rules and the command index.
- **`.github/instructions/atomic-agents.instructions.md`** — invariants auto-applied when editing `**/*.py`.
- **`.github/references/`** — 11 deep-dive docs the commands link into on demand.

## Requirements

- VS Code with **GitHub Copilot** + **Copilot Chat**.
- Prompt files and custom instructions enabled: set `"chat.promptFiles": true` in VS Code settings (default on recent
  builds). Slash-command discovery for prompt files works in **Agent mode**.

## Install

### Option A — per-repo (most portable, zero install)

Copy the `.github/` folder from here into the root of your Atomic Agents project:

```bash
cp -R copilot/.github /path/to/your-project/.github     # or merge into an existing .github/
```

Reload VS Code. Open Copilot Chat, switch to **Agent** mode, type `/` and you'll see the `atomic-*` commands. The
`copilot-instructions.md` and `*.instructions.md` apply automatically.

> Merging into an existing `.github/`? These files don't collide with Actions/workflows — they live in `prompts/`,
> `instructions/`, `references/`, and the single `copilot-instructions.md`.

### Option B — user-wide (available in every repo)

Point VS Code at the prompt + instruction folders once, in your user `settings.json`:

```jsonc
{
  "chat.promptFilesLocations":      { "/abs/path/to/copilot/.github/prompts": true },
  "chat.instructionsFilesLocations":{ "/abs/path/to/copilot/.github/instructions": true }
}
```

Now the commands are available in every workspace without copying files. (The workspace-level
`copilot-instructions.md` only loads when present in that repo, so Option A still gives the richest in-repo context.)

## Regenerating

After editing any canonical skill, subagent, or reference under `../claude-plugin/atomic-agents/`:

```bash
node ../tools/compile_copilot.mjs
```

## Parity notes vs. Claude Code

- **Slash commands:** full parity — every Claude skill is a `/atomic-*` prompt file.
- **Auto-trigger:** Claude auto-loads skills by description match; Copilot commands are invoked explicitly. The
  `description` frontmatter is preserved so you still get the same "use when…" guidance.
- **Subagents (`/atomic-explore`, `/atomic-review`):** Copilot has no isolated sub-context, so these run in your current
  chat thread (each prompt flags this at the top). Same structured output; run them in a fresh chat for the cleanest pass.

Licensed MIT, same as upstream Atomic Agents.

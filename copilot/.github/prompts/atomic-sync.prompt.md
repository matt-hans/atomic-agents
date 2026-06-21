---
description: 'Link code back to its Azure DevOps work items — branches, pull requests, and CI builds to the User Stories planned by `/atomic-plan`. Passive and read-mostly: it never creates work items, only links and proposes state transitions. Use when the user asks to "link this PR to the story", "sync code to ADO", "connect the branch to work items", "trace this commit", or runs `/atomic-sync`.'
mode: 'agent'
---
# Sync code to Azure DevOps work items

The passive companion to `/atomic-plan`. Where `plan` is interactive and write-heavy, `sync` is fire-and-forget plumbing: it reads `.atomic/manifest.yaml` and links the code you just wrote back to the Stories that planned it. **It never creates or closes work items on its own** — it links artifacts and *proposes* state transitions for confirmation.

Requires the Azure DevOps MCP server connected and the repo hosted on (or mirrored to) ADO Repos. Full tool reference: `../references/ado-planning.md`.

## What it links

| Trigger | Action | ADO tool |
|---|---|---|
| Branch pushed | Link the branch to every Story whose `expectedPaths` it touches | `wit_add_artifact_link` (Branch) |
| PR opened | Link the PR to each affected Story | `wit_link_work_item_to_pull_request` |
| CI build ran | Link the build to the Feature | `wit_add_artifact_link` (Build) |
| Checks pass | **Propose** the Story → Resolved (never auto-transition) | `wit_update_work_items_batch` |

Affected Stories are computed as `PR diff paths ∩ manifest expectedPaths` — not hand-maintained.

## Workflow

1. Read `.atomic/manifest.yaml` for the Story→files→adoId mapping. If absent, tell the user to run `/atomic-plan` first; do nothing else.
2. Determine scope from the caller (branch name, PR id, or build id) — never guess; the caller provides it.
3. Resolve affected Stories by intersecting changed paths with each Story's `expectedPaths`.
4. Create the artifact links (idempotent — re-linking the same artifact is a no-op).
5. Map gate results to state **categories** (InProgress/Resolved), never literal state names, and **propose** the transition for confirmation.

**GitHub-mirrored repos:** when the remote is GitHub rather than ADO Repos, fall back to an `AB#<id>` commit-message trailer (which ADO auto-resolves) and say so — direct artifact links are unavailable.

## Scope discipline (MVP)

- MVP ships the `AB#<id>` commit-trailer path and PR linking; branch-diff intersection and CI-build links are the next step.
- Never transition a work item to a closed/done state without explicit confirmation.
- Never create a work item — that is exclusively `/atomic-plan`'s job.

## Anti-patterns

- Auto-closing Stories on merge without confirmation.
- Inventing scope (which branch/PR) instead of taking it from the caller.
- Hardcoding state names (`Resolved`) instead of resolving by state category per the project's process.

For the artifact-link tools and process-template rules, load `../references/ado-planning.md`.


---
description: 'Turn an agent idea into a tracked Azure DevOps backlog — Epic (application) → Feature (one AtomicAgent) → User Stories (one per component) with a standardized run-anywhere Definition of Done, previewed before anything is written. Use when the user asks to "plan an agent", "create ADO work items", "generate a backlog", "break this agent into stories", "file Features/User Stories for this agent", or runs `/atomic-plan`.'
mode: 'agent'
---
# Plan an Atomic Agent into Azure DevOps

Turn "an agent idea" into a tracked, schema-correct ADO backlog so building an atomic agent **is** a planned, traceable workflow. This skill is **domain-agnostic by default** — UPS (and any other domain) is an optional *pack* layered over a general-purpose core, never baked in.

The full taxonomy, field/state rules, and idempotency recipe live in `../references/ado-planning.md`. The run-anywhere acceptance criteria live in `../references/portability-acs.md` and the gate in `../references/definition-of-done.md`. Read those for depth; this skill is the action path: intake → introspect → preview → create.

## The one rule that is never bent

**An agent is always a Feature, never an Epic.** Epic = application / initiative / multi-agent workflow. Feature = exactly one `AtomicAgent[In, Out]`. Story = one buildable component. The Epic title must **never** be derived from the agent name — if the user gives no application, **ask** ("what application/initiative does this agent belong to?") or file under a generic `Unsorted Agents` Epic.

## Taxonomy at a glance

| Level | Means | ADO tool |
|---|---|---|
| Epic | application / initiative / multi-agent workflow (orchestration lives here) | `wit_create_work_item` |
| Feature | one `AtomicAgent[In, Out]` | `wit_create_work_item` |
| Story | one component (schema, agent, each tool/provider, config, memory, hooks, test, review) | `wit_add_child_work_items` (batched) |
| Test Case | one executable AC check | `testplan_create_test_case` |

The 13 build skills map ~1:1 to Story types (see the reference). `orchestrate` is the only one that parents to the **Epic**, and only when ≥2 agent-Features exist.

## Phase 0 — Introspect (never assume the process template)

Read the target project's real schema; do not hardcode type or field names.

- `wit_get_work_item_type` for the Epic-, Feature-, and Requirement-category types. **Resolve by backlog category**, not by display name (Agile "User Story" vs Scrum "Product Backlog Item" vs CMMI "Requirement" vs custom).
- Capture the real field reference names (story points, acceptance criteria) and the allowed **state categories** into `.atomic/config.yml` (see `planning/config.example.yml`). Static field maps are fallback only — an unknown field **fails with remediation** (`/atomic-plan --bind`), never silently emits to a stock field name.
- If no Acceptance-Criteria field exists, set `acTarget: description-section`. If no Test Plan is available, degrade Test Cases to a description checklist.

When the ADO MCP server is **not** connected, skip to the offline preview (below) — it needs no project binding.

## Phase 1 — Intake

Collect (bundle into one message; skip what's already known):

1. **Application** (→ Epic). Required and never defaulted from the agent name.
2. **Agent** name + one-line capability (→ Feature).
3. **Provider** (default `openai`; provider is swappable later via `/atomic-configure-provider`).
4. **Tools** (0..n → one Story each), **context providers** (0..n → one Story each), **memory?**, **hooks?**.
5. **Pack** (`core` default — domain-agnostic; `ups` or another pack only when the domain applies).

Intake can be written as a YAML file — see `planning/examples/generic-agent.intake.yaml` and `planning/examples/ups-tracking.intake.yaml`.

## Phase 2 — Preview (mandatory gate, no writes)

Always render the full Epic → Feature → Story tree as text first, with each node's skill, points, planned source paths, and a `NEW / EXISTS#id / UPDATE#id` marker, plus the portability DoD checklist. **Nothing is created until the user approves.**

Run the offline renderer to produce this tree without any ADO connection:

```bash
node tools/atomic_plan_preview.mjs --intake planning/examples/generic-agent.intake.yaml
node tools/atomic_plan_preview.mjs --intake planning/examples/ups-tracking.intake.yaml   # pack from intake
```

When ADO is connected, the same preview also runs a read-only dedup scan (`wit_query_by_wiql`, `wit_search_workitem`) to mark existing items.

## Phase 3 — Create (idempotent, batched) — requires the ADO MCP

On approval, in one logical transaction:

1. Dedup scan by fingerprint (see below) — **always**, even if a local manifest exists.
2. `wit_create_work_item` for the Epic (if new) and the Feature.
3. **One** `wit_add_child_work_items` call to create all Stories under the Feature.
4. `wit_work_items_link` to parent the Feature to the Epic and set any Predecessor/Successor order.
5. Render acceptance criteria into the configured `acTarget` (field or description checklist) via `wit_update_work_items_batch`.
6. Optional `testplan_create_test_case` linked to the relevant Stories when a Test Plan exists.
7. Write `.atomic/manifest.yaml` mapping each Story → ADO id, skill, and expected source files.

**Idempotency (do not skip):** stamp a deterministic fingerprint `<!-- afid:<sha1(stable-key)> -->` into each item's **description** (and a tag as backup — tags get stripped by bulk edits). Re-running matches existing items by fingerprint and creates only what's missing (clean recovery from a partial batch). The manifest is a *cache*, never a reason to skip the create-path scan. Track intentional deletions as `status: dismissed` so they aren't resurrected.

## Modes

- `--dry-run` — Phases 0–2 only; zero writes (the default for CI and for any offline run).
- `--bind` — run Phase 0 and (re)write `.atomic/config.yml` for this project.
- `--pack <name>` — overlay a domain pack (default `core`, i.e. none).
- `--epic <id>` / `--new-epic "<title>"` — attach to an existing Epic or create one (never named after the agent).

## Phase 4 — Hand off to the build skills

Each Story names the skill that builds it. The developer runs that skill (e.g. `/atomic-create-tool`), which reads `.atomic/manifest.yaml`, pre-fills the component, and moves the Story to an in-progress state. `/atomic-sync` links the branch/PR back to the Story.

## Anti-patterns

- Naming the Epic after the agent (collapses the agent into an Epic). Ask for the application instead.
- Hardcoding `"User Story"` / `"Active"` / a story-points field — resolve by category via `wit_get_work_item_type`.
- Creating work items before showing the preview, or skipping the dedup scan because a manifest exists (→ duplicates).
- Leaking a domain (UPS) token into a `core` template — domain content belongs only in `planning/packs/<pack>/`.
- Writing acceptance criteria to an AC field that the project doesn't have — default to a description checklist.

For the taxonomy, field-map, and idempotency depth, load `../references/ado-planning.md`.


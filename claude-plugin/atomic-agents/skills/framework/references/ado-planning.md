# ADO Planning Reference

## Contents
- Taxonomy: how a build maps to work items
- Skill → Story-type mapping
- Process-template agnosticism
- Acceptance Criteria targets
- State transitions
- ADO MCP tools
- Idempotency recipe

## Taxonomy

An Atomic Agents build maps onto an Azure DevOps work-item tree. The mapping is fixed:

| Layer | Maps to | Notes |
|---|---|---|
| Epic | An application / initiative / multi-agent workflow | Orchestration lives here. The container, not a unit of work. |
| Feature | Exactly **one** `AtomicAgent[In, Out]` | One agent = one Feature. Always. |
| Story | One buildable unit | A schema, the agent core, a tool, a provider, etc. |
| Test Case | One executable AC check | A single assertion that can pass or fail. |

**An agent is ALWAYS a Feature, NEVER an Epic.** A single agent does not get its own Epic.

**The Epic title must NEVER be derived from the agent name.** The Epic names the *application* the agent belongs to. If no application/initiative is supplied, `/atomic-plan` must either ASK the user for it, or file the Feature under a generic **"Unsorted Agents"** Epic. Never invent an Epic titled after the agent.

## Skill → Story-type mapping

The 13 framework skills materialize into work items as follows. "Level" is the tree layer the item attaches to; "Presence" is when it is emitted; "Default points" is the starting estimate.

| Skill | Story type | Level | Presence | Default points |
|---|---|---|---|---|
| `new-app` | App Bootstrap | Epic | always | 1 |
| `create-atomic-schema` | Schema Contract | Feature | always | 1 |
| `create-atomic-agent` | Agent Core | Feature | always | 2 |
| `create-atomic-tool` | Tool Integration | Feature | conditional, per tool | 3 |
| `create-atomic-context-provider` | Context Provider | Feature | conditional, per provider | 2 |
| `configure-provider` | Provider Config | Feature | always | 1 |
| `add-memory` | Memory | Feature | conditional | 2 |
| `add-hooks` | Hooks & Observability | Feature | conditional | 2 |
| `orchestrate` | Orchestration | **Epic** | iff ≥ 2 Features | 5 |
| `test` | Verification | Feature | always | 3 |
| `explore` | Discovery Spike | Epic | brownfield | 3 |
| `review` | Framework Review | Feature (gate, closes last) | always | 2 |
| `framework` | — | — | never materializes | — |

Notes:
- `orchestrate` only materializes when the Epic holds **≥ 2 Features**; a single-agent Epic has nothing to orchestrate.
- `review` is the closing gate on a Feature — it is the last item to move to Done.
- `framework` is meta-guidance and never becomes a work item.

## Process-template agnosticism (CRITICAL)

Azure DevOps process templates disagree on work-item type names: Agile uses **User Story**, Scrum uses **Product Backlog Item**, CMMI uses **Requirement**, and custom templates use anything. Field reference names differ too.

**NEVER hardcode work-item type names or field reference names.** Resolve types by **backlog category**, not by display name:

| Logical layer | Backlog category | Do NOT probe for |
|---|---|---|
| Epic | Epic-category | "Epic" string literal |
| Feature | Feature-category | "Feature" string literal |
| Story | Requirement-category | "User Story" / "Product Backlog Item" / "Requirement" |

Introspect the real project with the ADO MCP tool **`wit_get_work_item_type`** and capture the result **once** into `.atomic/config.yml`. Static field maps are **FALLBACK ONLY**. An unrecognized field must **FAIL WITH REMEDIATION** —

```
Field not bound for this process. Run /atomic-agents:plan --bind
```

— never silently emit to a stock field name.

## Acceptance Criteria targets

The AC target is configurable per process. Three modes:

| Target | When |
|---|---|
| `field` | Only if introspection confirms a real Acceptance Criteria field exists. |
| `description-section` | **Default** — always available; AC rendered as a section in the description. |
| `testcases` | Only if a Test Plan/Suite is available. |

Test Cases require a Test Plan/Suite (`testplan_create_test_case`). **Detect availability before creating.** If absent, degrade gracefully to a description checklist.

## State transitions

State changes map by **category**, never by literal name. The literal display states (`Active`, `Resolved`, …) vary by template.

| Category | Meaning |
|---|---|
| Proposed | Not started |
| InProgress | Being built |
| Resolved | Built, pending verification |
| Completed | Done |

Never transition to a literal `"Active"` or `"Resolved"` string — resolve the state in the target category first.

## ADO MCP tools

| Tool | Use |
|---|---|
| `wit_get_work_item_type` | Introspect real types/fields per project (run once, cache). |
| `wit_create_work_item` | Create a single Epic/Feature/Story. |
| `wit_add_child_work_items` | Batched Feature → Stories creation. |
| `wit_work_items_link` | Parent/Child, Predecessor/Successor links. |
| `wit_query_by_wiql` + `wit_search_workitem` | Dedup scan on the create path. |
| `wit_update_work_items_batch` | Bulk state/field updates (e.g. Test Case outcomes). |
| `testplan_create_test_case` | Materialize Test Cases (when a Test Plan exists). |
| `wit_add_artifact_link` / `wit_link_work_item_to_pull_request` | Link PR + CI build (used by `/atomic-sync`). |

## Idempotency recipe

Re-running `/atomic-plan` must not duplicate items.

1. **Fingerprint into the description.** Stamp a deterministic marker into the work-item **DESCRIPTION**:
   ```
   <!-- afid:<sha1(stable-key)> -->
   ```
   The `stable-key` is derived from durable identity (Epic + agent + unit), not from order or timestamps. Also add a tag as a backup, but the description marker is authoritative — **tags get stripped by bulk edits**.
2. **Always run a dedup WIQL scan on the create path.** `.atomic/manifest.yaml` is only a cache; it is **never** a reason to skip the scan. Scan with `wit_query_by_wiql` + `wit_search_workitem` for the fingerprint before creating.
3. **Partial-batch reconcile.** A re-run matches already-created items by fingerprint and creates **only the missing ones**.
4. **Track intentional deletions.** Record dismissals in the manifest (`status: dismissed`) so a later re-run does not resurrect them.

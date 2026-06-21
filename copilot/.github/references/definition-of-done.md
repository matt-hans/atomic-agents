# Standardized Definition of Done

A single, standardized DoD checklist is stamped on **every agent-Feature**. `/atomic-test` proves it; `/atomic-review` gates it. This document defines the checklist and how the two skills enforce it.

## Contents
- Feature-level DoD checklist
- `/atomic-test --portability` enforcement
- `/atomic-review` lint rules
- Decoupling guard (general-purpose use)

## Feature-level DoD checklist

Stamped on every agent-Feature. All six must be checked before the Feature is Done:

| # | DoD item | Proven by |
|---|---|---|
| 1 | `core/` passes the no-secrets / no-SDK static check | static lint over `core/` |
| 2 | Provider-swap (mocked) green for required providers | mocked Instructor client per `openai` / `anthropic` / `ollama` |
| 3 | Packaging smoke (`cli`, `library`) returns identical `OutputSchema` shape | `model_json_schema()` equality + golden fixture |
| 4 | Config fail-fast proven | `pytest.raises(ConfigError)` on a missing required var |
| 5 | Portability checklist on the Feature fully checked | AC-PORT-1..5 (see `portability-acs.md`) |
| 6 | PR + CI build linked to the Feature | `wit_link_work_item_to_pull_request` / `wit_add_artifact_link` |

The DoD is the same on every Feature — it does not vary by agent. Conditional ACs (e.g. AC-PORT-4) are checked only when applicable but still appear, marked N/A.

## `/atomic-test --portability` enforcement

`/atomic-test --portability` runs the hermetic checks from `portability-acs.md` (mocked providers, static `core/` check, JSON-Schema identity, `ConfigError` fail-fast) and maps each result to a **Test Case outcome**:

1. Run the hermetic suite — no live keys, no network.
2. Map each AC result (Pass/Fail) to its Test Case via `wit_update_work_items_batch`.
3. **Flip the gate Story** (the `Verification` item) to Resolved/Completed only when every mapped Test Case passes.

A failing hermetic check leaves the gate Story open with the failing Test Case marked accordingly.

## `/atomic-review` lint rules

`/atomic-review` runs **before** tests and blocks the PR on any violation. These are static rules — they do not need a runtime:

| Rule | Violation | Result |
|---|---|---|
| R1 | A provider SDK imported **outside** `config/provider.py` | fail |
| R2 | Forbidden literal (`api_key`, `sk-`, `region`, `endpoint_url`, `password`) in `core/` or `runtimes/` | fail |
| R3 | Business logic in `runtimes/*` (edge adapters must stay thin) | fail |
| R4 | Vendor SDK **anywhere** in `core/` (must be reached via MCP / edge adapter) | fail |
| R5 | Instructor `mode` not sourced from the factory | fail |

Because `/atomic-review` runs first, a structurally non-portable PR is rejected before any test cycle is spent on it.

## Decoupling guard (general-purpose use)

The framework is general-purpose: the **core must stay domain-agnostic** so an agent can be planned with no domain pack at all.

**Token allow-list check.** A simple `/ups/i` grep is **not** sufficient. An allow-list check must keep domain tokens out of generic code. Forbidden tokens include (non-exhaustive):

```
track_package, inquiryNumber, oauth-cc, client_secret, returnSignature
```

| Location | Domain tokens allowed? |
|---|---|
| `blueprints/` / `templates/` core | **No** |
| `skills/_shared` | **No** |
| `packs/` | **Yes** — domain tokens live here only |

**Standing generic-mode check.** A continuous end-to-end check runs with `packs.enabled: []` and proves an agent can be planned and built with **NO domain pack**. If generic mode breaks, a domain assumption has leaked into core — fix the leak, do not relax the check.

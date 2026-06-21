# Portability Acceptance Criteria (run-anywhere / any-runtime / any-model)

Generated agents must run **anywhere**, on **any runtime**, with **any model**. This document encodes that principle as a Core/Edge architecture plus five hermetically testable acceptance criteria.

## Contents
- Core/Edge architecture
- The 5 portability ACs
- Why each AC is hermetic
- Required vs optional matrix
- External integration via MCP

## Core/Edge architecture

Every generated agent uses the same three-zone layout. Provider SDKs and secrets are confined to a single zone; everything reusable stays pure.

| Zone | Contents | Rules |
|---|---|---|
| `core/` | `schemas.py`, `agent.py`, MCP-backed tools, `context/` | **PURE.** No provider SDK, no secrets, no I/O at import. |
| `config/` | `settings.py`, `provider.py` | `settings.py` = pydantic-settings, env-only. `provider.py` is **THE ONLY** place provider SDKs + `instructor` are imported. |
| `runtimes/` | thin **edge** adapters (≤ ~40 lines each) | `cli`, `library`, and optionally `container`, `mcp_server`, `serverless`, `notebook`. No business logic. |

The edge adapters wire `core/` to a host. They construct the provider client via `config/provider.py`, inject it, and call the agent — nothing else.

## The 5 portability ACs

Each AC is written to be **hermetically testable** — no live keys, no network.

| AC | Name | What it asserts |
|---|---|---|
| AC-PORT-1 | Provider independence | A **mocked** Instructor client per provider asserts the code constructs the right client with the right `Mode` and parses a valid `OutputSchema`. (NOT a live call.) |
| AC-PORT-2 | 12-factor config | All secrets/URLs/model-ids/mode come from env. A missing required var raises a **named `ConfigError`** at `Settings()` construction. |
| AC-PORT-3 | Packaging independence | `OutputSchema.model_json_schema()` is **identical** across required runtimes (`cli`, `library`) and matches a recorded golden fixture, with the LLM mocked. |
| AC-PORT-4 | External via injected edge adapter (MCP by default) | **CONDITIONAL** — applies only if the agent has ≥ 1 external integration. `core/` imports no vendor SDK; external reached via `fetch_mcp_tools` against a mock. |
| AC-PORT-5 | Offline capability | Asserted per-PR by the static "no provider SDK imported in `core/`" check; **proven** by an OPTIONAL nightly Ollama job. |

### AC-PORT-2 example
```python
with pytest.raises(ConfigError, match="AGENT_MODEL"):
    Settings()  # required env var unset
```

### AC-PORT-3 — the deterministic oracle
"Same shape" means **JSON Schema identity**: `model_json_schema()` from the `cli` runtime equals the value from the `library` runtime equals the golden fixture, byte-for-byte. No LLM is called; the schema is structural.

### AC-PORT-5 — what runs where
- **Per-PR (blocking):** static check — `core/` imports no provider SDK.
- **Nightly (non-blocking):** an OPTIONAL Ollama job runs the agent end-to-end against a tiny pinned model (e.g. `qwen2.5:0.5b`). Running Ollama is **NOT** a per-PR gate.

## Why each AC is hermetic (the red-team correction)

Live provider keys and a real Ollama server are **not available in standard CI**. So:
- The per-PR assertions are **mocked** (PORT-1, PORT-3, PORT-4) or **static** (PORT-5).
- The genuinely live/offline checks (a real provider call, a real Ollama run) are **separate nightly, non-blocking jobs**.

This keeps the PR gate fast and deterministic while still proving run-anywhere behavior on a slower cadence. An AC that needs a network or a secret to assert is not an AC — it is a nightly job.

## Required vs optional matrix

| Axis | Required | Optional |
|---|---|---|
| Providers (assert wiring via mocks) | `openai`, `anthropic`, `ollama` | `gemini`, `groq` |
| Runtimes | `cli`, `library` | `container`, `mcp_server`, `serverless`, `edge`, `notebook` |

"Required" providers must have their client-construction + mode wiring asserted with mocked Instructor clients. "Required" runtimes must both produce the identical `OutputSchema` shape (AC-PORT-3).

## External integration via MCP

Reaching an external system (e.g. UPS) via **MCP** keeps the agent runtime- and model-agnostic and keeps vendor credentials in the **MCP server's** env — not in the agent. `core/` imports the integration through `fetch_mcp_tools`, never a vendor SDK.

This is a **DEFAULT pattern, not a core requirement.** It applies only when the agent has an external integration (AC-PORT-4 is conditional). A self-contained agent with no external system has nothing to route through MCP.

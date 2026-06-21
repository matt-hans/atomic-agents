---
description: 'Atomic Agents framework invariants — applied automatically when editing Python.'
applyTo: '**/*.py'
---

# Atomic Agents — Python editing rules

These apply whenever you edit Python in this workspace. They are the framework invariants the `/atomic-review` command
checks for — honor them as you write so review comes back clean.

- Subclass `BaseIOSchema` (not `pydantic.BaseModel`) for every agent/tool input and output. Each needs a **non-empty
  docstring** and a `Field(..., description=...)` on every field.
- Construct agents with explicit generics: `AtomicAgent[In, Out](config=...)`. Declare tools as
  `class MyTool(BaseTool[In, Out])`. No `input_schema =` / `output_schema =` class attributes.
- `AgentConfig.client` must be Instructor-wrapped (`instructor.from_*`). Keep `AgentConfig.mode` in sync with the factory
  (`Mode.TOOLS` / `Mode.JSON` / `Mode.GENAI_TOOLS`). Anthropic requires `max_tokens` in `model_api_parameters`; Gemini
  requires `assistant_role="model"`.
- Tools' `run()` returns the output schema instance (never a dict/primitive); async tools expose `run_async`, not `arun`.
  Routine failures (not-found, rate-limited) become typed outputs, not exceptions. External I/O has a timeout.
- `BaseDynamicContextProvider.get_info()` returns a string, does no blocking I/O, leaks no secrets, and is registered
  before any `run()` that depends on it. Cache slow sources with a TTL.
- Handle errors with `register_hook("parse:error"|"completion:error"|"completion:last_attempt", ...)` rather than
  wrapping `run()` in `try/except`. Hook handlers log/meter and return — they never raise.
- Read credentials from the environment. Never hardcode keys. Bound `ChatHistory` on long-running sessions.
- Common API gotchas: `ChatHistory.load(...)` is an instance method that mutates `self` (not a classmethod);
  the MCP transport value is `HTTP_STREAM` (not `STREAMABLE_HTTP`).
- Do not assert that a `model="..."` string is invalid or that a `model_api_parameters` key is unsupported — model
  knowledge here is stale.

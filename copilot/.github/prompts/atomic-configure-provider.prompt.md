---
description: 'Wire an Atomic Agents `AgentConfig` to a specific LLM provider — the `instructor.from_*` factory, the matching Instructor `Mode`, required `model_api_parameters`, env-var keys, and keeping `AgentConfig.mode` in sync. Use when the user asks to "switch provider", "use Anthropic/Gemini/Groq/Ollama instead", "wire up <provider>", "configure the LLM client", "change the model", or runs `/atomic-configure-provider`.'
mode: 'agent'
---
# Configure an LLM Provider

Atomic Agents is provider-agnostic: any Instructor-supported client works. Configuring one means picking the provider, building the matching `instructor.from_*` client, choosing the correct `Mode`, setting the required `model_api_parameters`, and keeping `AgentConfig.mode` (and `assistant_role` where needed) in sync with the factory.

For the full provider matrix — every factory, mode, role, example model, and installation extra — the authority is `../references/providers.md`. This skill is the action-oriented path: clarify → plan → implement → verify → hand off.

## When this fires vs the umbrella `/atomic-framework` command

- **This skill**: the user is choosing or swapping the LLM provider/model for an agent — "switch to Anthropic", "use Gemini instead", "wire up Ollama for local dev", "change the model to claude-sonnet".
- **`/atomic-framework` command**: questions about Atomic Agents in general, or work other than provider wiring.

## Phase 1 — Clarify

Bundle into one message:

1. **Which provider?** OpenAI / Anthropic / Groq / Ollama / Gemini / OpenRouter / MiniMax. Default: whatever the project already uses; otherwise OpenAI.
2. **Which model?** If unspecified, propose a sensible default (see Phase 2) and confirm.
3. **Local or hosted?** Ollama is local and keyless; everything else needs an env-var key.
4. **Where does the client live?** A single `main.py`, or a shared `agents/` module reused across agents?

Skip anything already settled in context.

## Phase 2 — Plan

State the plan in one short block:

- Provider + model + Instructor `Mode`.
- Factory call (`instructor.from_openai` / `from_anthropic` / `from_groq` / `from_genai`).
- Required `model_api_parameters` (Anthropic `max_tokens`, Gemini none, etc.).
- Env-var key name.
- `AgentConfig` knobs to set (`mode`, and `assistant_role="model"` for Gemini).

Default models: OpenAI `gpt-5-mini`, Anthropic `claude-haiku-4-5`, Groq `llama-3.3-70b-versatile`, Ollama `llama3.1`, Gemini `gemini-2.5-flash`, OpenRouter `anthropic/claude-opus-4-6`, MiniMax `MiniMax-M3`.

## Phase 3 — Implement

Every client is Instructor-wrapped and every key is read from the environment. Pick the block for the chosen provider.

### OpenAI — `Mode.TOOLS` (default)

```python
import os, instructor
from openai import OpenAI

client = instructor.from_openai(OpenAI(api_key=os.environ["OPENAI_API_KEY"]))
model = "gpt-5-mini"   # also: "gpt-5", "gpt-5-nano", and reasoning variants
api_params = {"reasoning_effort": "low", "max_tokens": 2048}
# AgentConfig: mode defaults to Mode.TOOLS
```

Reasoning models (o-series, GPT-5 reasoning variants) often prefer `system_role=None`; pass `reasoning_effort` through `model_api_parameters`.

### Anthropic — `Mode.TOOLS`, `max_tokens` REQUIRED

```python
import os, instructor
from anthropic import Anthropic

client = instructor.from_anthropic(Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"]))
model = "claude-opus-4-6"        # or "claude-sonnet-4-6", "claude-haiku-4-5"
api_params = {"max_tokens": 4096}
```

Anthropic requires `max_tokens` on every call — always set it in `model_api_parameters`, or the API rejects the request.

### Groq — `Mode.JSON`

```python
import os, instructor
from groq import Groq
from instructor import Mode

client = instructor.from_groq(Groq(api_key=os.environ["GROQ_API_KEY"]), mode=Mode.JSON)
model = "llama-3.3-70b-versatile"
api_params = {"max_tokens": 2048}
# AgentConfig: mode=Mode.JSON
```

Groq does not support tool-calling for all models — stick with `Mode.JSON` in both the factory and `AgentConfig`.

### Ollama (local) — `Mode.JSON`, no key

```python
import instructor
from openai import OpenAI
from instructor import Mode

client = instructor.from_openai(
    OpenAI(base_url="http://localhost:11434/v1", api_key="ollama"),
    mode=Mode.JSON,
)
model = "llama3.1"      # any model pulled with `ollama pull`
api_params = {"max_tokens": 2048}
# AgentConfig: mode=Mode.JSON
```

No API key is needed; the literal `"ollama"` string satisfies the OpenAI SDK. Ollama's OpenAI adapter does not implement tool-calling reliably, so use `Mode.JSON`.

### Gemini — `Mode.GENAI_TOOLS`, `assistant_role="model"`

```python
import os, instructor
import google.genai
from instructor import Mode

client = instructor.from_genai(
    google.genai.Client(api_key=os.environ["GEMINI_API_KEY"]),
    mode=Mode.GENAI_TOOLS,
)
model = "gemini-2.5-flash"
api_params = {}
# AgentConfig: assistant_role="model", mode=Mode.GENAI_TOOLS
```

Gemini is the only provider where `assistant_role` must be `"model"`. Forgetting it causes silent role confusion in multi-turn chats.

### OpenRouter — `Mode.TOOLS`, OpenAI-compatible gateway

```python
import os, instructor
from openai import OpenAI

client = instructor.from_openai(OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.environ["OPENROUTER_API_KEY"],
))
model = "anthropic/claude-opus-4-6"   # OpenRouter's provider/model id syntax
api_params = {"max_tokens": 2048}
```

### MiniMax — `Mode.JSON`, OpenAI-compatible

```python
import os, instructor
from openai import OpenAI
from instructor import Mode

client = instructor.from_openai(
    OpenAI(base_url="https://api.minimax.io/v1", api_key=os.environ["MINIMAX_API_KEY"]),
    mode=Mode.JSON,
)
model = "MiniMax-M3"   # current default; "MiniMax-M2.7" remains as a legacy option
api_params = {"max_tokens": 2048}
# AgentConfig: mode=Mode.JSON
```

### Feed it into `AgentConfig`

```python
from atomic_agents import AgentConfig
from instructor import Mode

config = AgentConfig(
    client=client,
    model=model,
    model_api_parameters=api_params,
    # mode=Mode.TOOLS,                                # OpenAI / Anthropic / OpenRouter
    # mode=Mode.JSON,                                 # Groq / Ollama / MiniMax
    # mode=Mode.GENAI_TOOLS, assistant_role="model",  # Gemini
)
```

The `mode` passed to `AgentConfig` must match the `Mode` used in the Instructor factory. When the factory takes a `mode=` argument (Groq, Ollama, Gemini, MiniMax), set the same value in both places.

## Phase 4 — Verify

Smoke-test that the client is wired and the mode lines up, without paying for a real call:

```bash
uv run python -c "from <project>.<module> import client, model; print(type(client).__name__, model)"
```

If structured outputs stop working, the most common cause is a `mode` mismatch between the factory and `AgentConfig` — recheck both against the matrix. If Anthropic calls fail immediately, `max_tokens` is missing from `model_api_parameters`.

## Phase 5 — Hand off

Tell the user:

- Which env var to export for the provider key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `MINIMAX_API_KEY`; Ollama needs none).
- The Instructor install extra to add: `instructor[openai]`, `[anthropic]`, `[groq]`, or `[google-genai]`. Ollama, OpenRouter, and MiniMax use the `openai` extra (OpenAI-compatible endpoints).
- That swapping providers later means changing only the client wiring, `model`, and `mode` — schemas, prompts, and hooks are unaffected.

## Anti-patterns

- `AgentConfig.mode` out of sync with the Instructor factory mode — structured outputs silently break.
- `Mode.TOOLS` on Groq / Ollama / MiniMax — flip to `Mode.JSON`; those endpoints do not accept tool-formatted calls.
- Missing `max_tokens` on Anthropic — every call fails.
- `assistant_role="assistant"` on Gemini — must be `"model"`.
- Forgetting `mode=Mode.GENAI_TOOLS` for Gemini, or omitting `mode=` from the `from_genai` / `from_groq` factory.
- Passing the raw SDK client without `instructor.from_*` — structured outputs stop working.
- Hardcoded API keys in source — read every key from the environment.

For deeper material — the full provider matrix, `model_api_parameters` per provider, model-picking guidance, and installation extras — load `../references/providers.md`.


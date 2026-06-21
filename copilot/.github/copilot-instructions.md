# Atomic Agents — Copilot workspace instructions

This workspace builds LLM applications with the **[Atomic Agents](https://github.com/eigenwise/atomic-agents)** Python
framework: typed, structured input/output on top of [Instructor](https://python.useinstructor.com) + Pydantic. Every
interaction between user, agent, tool, and context is a validated `BaseIOSchema`.

When you write or modify code that imports from `atomic_agents`, follow the rules below. For a guided, step-by-step
workflow, the user can invoke one of the **slash commands** in `.github/prompts/` (listed at the bottom).

## Core abstractions

| Concept | Class | Role |
|---|---|---|
| Schema | `BaseIOSchema` | Typed input/output contract — every agent/tool I/O is one |
| Agent | `AtomicAgent[In, Out]` | LLM-backed transformer from input schema to output schema |
| Config | `AgentConfig` | Wires client, model, history, prompt, roles, API params |
| Prompt | `SystemPromptGenerator` | Three sections: `background`, `steps`, `output_instructions` |
| History | `ChatHistory` | Conversation state, serializable, token-counted |
| Tool | `BaseTool[In, Out]` | Deterministic capability the agent can invoke |
| Context | `BaseDynamicContextProvider` | Dynamic section injected into the system prompt at runtime |

## Canonical imports (do not deviate)

```python
from atomic_agents import (
    AtomicAgent, AgentConfig,
    BasicChatInputSchema, BasicChatOutputSchema,
    BaseIOSchema, BaseTool, BaseToolConfig,
)
from atomic_agents.context import (
    ChatHistory, Message,
    SystemPromptGenerator, BaseDynamicContextProvider,
)
```

Do **not** use legacy paths (`atomic_agents.lib.base.*`, `atomic_agents.agents.base_agent`) — they were retired.

## Hard rules

- **Schemas are the contract.** Every agent/tool I/O subclasses `BaseIOSchema` (never plain `pydantic.BaseModel`), has a
  **non-empty docstring** (the framework raises at import otherwise), and gives every field a `Field(..., description=...)`
  — Instructor feeds those descriptions to the LLM.
- **Generics carry the truth.** Write `AtomicAgent[In, Out]` and `class MyTool(BaseTool[In, Out])` explicitly. Do not rely
  on `input_schema = ...` / `output_schema = ...` class attributes.
- **Always wrap the client with Instructor** — `instructor.from_openai(...)`, `instructor.from_anthropic(...)`,
  `instructor.from_genai(...)`. A raw provider client as `AgentConfig.client` silently breaks structured output. (Raw SDK
  use for embeddings, images, audio, or moderation is fine — the framework only covers structured chat/completions.)
- **`AgentConfig.mode` must match the Instructor factory:** `Mode.TOOLS` (OpenAI/Anthropic/OpenRouter), `Mode.JSON`
  (Groq/Ollama/MiniMax), `Mode.GENAI_TOOLS` (Gemini). Gemini needs `assistant_role="model"`; Anthropic needs `max_tokens`
  in `model_api_parameters`.
- **Provider knobs go in `model_api_parameters`** (`temperature`, `max_tokens`, `reasoning_effort`), not on the agent.
- **Errors flow through hooks**, not `try/except` around `run()` — `register_hook("parse:error", ...)`,
  `"completion:error"`, `"completion:last_attempt"`. `agent.hooks_enabled` is a property (no parentheses).
- **Secrets from env**, never hardcoded. Bound `ChatHistory` on long-running services (`max_messages`).

## Don't claim model strings are invalid

Your training data is older than the current model catalogue. Never assert a `model="..."` string "doesn't exist" or that
a `model_api_parameters` key is unsupported. Leave model identifiers alone unless explicitly asked to audit them.

## Deeper reference material

Topic docs live in `.github/references/` — read the matching one when you need depth: `schemas.md`, `agents.md`,
`tools.md`, `context-providers.md`, `prompts.md`, `orchestration.md`, `memory.md`, `hooks.md`, `providers.md`,
`project-structure.md`, `testing.md`.

## Available slash commands (`/` in Copilot Chat)

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

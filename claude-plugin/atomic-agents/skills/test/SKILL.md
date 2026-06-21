---
name: test
description: Scaffold pytest coverage for Atomic Agents agents and tools — schema validation, mocked provider clients, typed tool failures, and opt-in integration tests with capped tokens. Use when the user asks to "write tests", "test the agent/tool", "add pytest coverage", "mock the provider", "test without paying for API calls", or runs `/atomic-agents:test`.
---

# Test Atomic Agents and Tools

Tests for an Atomic Agents project split cleanly: schemas validate at construction, tools are plain classes you can stub, and agents are transformers whose LLM client you mock so unit tests never hit a real provider. `pytest` + `pytest-asyncio` covers all of it — no extra runtime.

For deep material (async/streaming fixtures, honest-test patterns, Instructor test helpers), the authority is `../framework/references/testing.md`. This skill is the action-oriented path: scaffold → mock → assert.

## When this fires vs the umbrella `framework` skill

- **This skill**: the user wants tests — "write tests for the weather tool", "add pytest coverage for the router agent", "mock the LLM so CI doesn't pay for calls".
- **`framework` skill**: questions about Atomic Agents in general, or work other than authoring tests.

## Phase 1 — Clarify

Bundle into one message:

1. **What's under test?** A schema, a tool, an agent, or an orchestration of several.
2. **Unit or integration?** Default to unit — mocked, offline, free. Integration (real provider) is opt-in only.
3. **Async or streaming?** If the code uses `run_async` / `run_async_stream`, plan `pytest-asyncio` tests.
4. **External I/O in tools?** HTTP, DB — these get stubbed with `monkeypatch`.

Skip anything already settled in context.

## Phase 2 — Plan the layout

```
tests/
├── conftest.py
├── test_schemas.py
├── test_tools/
│   ├── test_calculator.py
│   └── test_weather.py
├── test_agents/
│   ├── test_router.py
│   └── test_summarizer.py
└── test_orchestration.py
```

State which files you'll add, then proceed.

## Phase 3 — Test schemas

Schemas validate at construction — the cheapest thing to test. Hit the edge cases that matter; skip the trivial ones (Pydantic already enforces correct types and missing required fields):

```python
import pytest
from pydantic import ValidationError
from my_app.schemas import SearchQuery

def test_search_query_rejects_empty_string():
    with pytest.raises(ValidationError):
        SearchQuery(query="", limit=10)

def test_search_query_caps_limit():
    with pytest.raises(ValidationError):
        SearchQuery(query="x", limit=101)
```

## Phase 4 — Test tools (unit)

Tools are plain classes. Stub external I/O with `monkeypatch`, then assert on the **output schema** — including the typed failure path:

```python
import httpx, pytest
from my_app.tools.weather_tool import WeatherTool, WeatherConfig, WeatherInput

def test_weather_returns_error_without_key():
    tool = WeatherTool(WeatherConfig(api_key=""))
    out = tool.run(WeatherInput(city="Ghent"))
    assert out.status == "error"
    assert "WEATHER_API_KEY" in out.error

def test_weather_parses_ok_response(monkeypatch):
    def fake_get(*a, **kw):
        class R:
            def raise_for_status(self): pass
            def json(self): return {"temp_c": 12.3, "summary": "rain"}
        return R()
    monkeypatch.setattr(httpx, "get", fake_get)

    tool = WeatherTool(WeatherConfig(api_key="x"))
    out = tool.run(WeatherInput(city="Ghent"))
    assert out.status == "ok" and out.temperature_c == 12.3
```

Always cover the typed failure output — assert `status == "error"` and the `error` message — not just the happy path.

## Phase 5 — Test agents (no real LLM)

Swap the Instructor client for one that returns a canned schema instance. Instructor clients route through `.chat.completions.create(...)`, so mock exactly that:

```python
from unittest.mock import MagicMock
from my_app.schemas import UserQuery, Answer
from my_app.agents.qa_agent import create_qa_agent

def test_qa_agent_calls_llm_with_query():
    client = MagicMock()
    # Instructor clients route through .chat.completions.create(...)
    client.chat.completions.create.return_value = Answer(text="42")

    agent = create_qa_agent(client=client, model="gpt-5-mini")
    out = agent.run(UserQuery(question="meaning of life"))
    assert out.text == "42"
```

For agents that exercise validators or hooks, lean on Instructor's test helpers rather than hand-rolling client fakes — `instructor.Instructor` implementations can be constructed for testing (consult the Instructor docs for the exact factory).

Assert on **schema fields or hook events**, never on free-text LLM output.

## Phase 6 — Async and streaming

`pytest-asyncio` handles async agents:

```python
import pytest

@pytest.mark.asyncio
async def test_async_agent(fake_async_client):
    agent = AtomicAgent[In, Out](config=AgentConfig(client=fake_async_client, model="m"))
    out = await agent.run_async(In(...))
    assert out == expected
```

For streaming, collect the partials and assert on the final one:

```python
@pytest.mark.asyncio
async def test_streaming_agent(fake_streaming_client):
    partials = [p async for p in agent.run_async_stream(In(...))]
    assert partials[-1] == expected_final_output
```

## Phase 7 — Integration tests (opt-in, real provider)

Keep these behind an environment flag so they never run in CI by default:

```python
import os, pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("RUN_PROVIDER_TESTS"),
    reason="set RUN_PROVIDER_TESTS=1 to hit the real provider",
)

def test_agent_answers_real_question():
    ...
```

Add `RUN_PROVIDER_TESTS=1` to a nightly or on-demand CI job. Pin a cheap model (`gpt-5-mini`, `claude-haiku-4-5`) and a **tight `max_tokens`** — every integration test that hits a provider must cap tokens, or costs spiral.

## Fixtures that keep tests honest

- **Freeze time** in tests involving `TimeCtx` or timestamps.
- **Don't share `ChatHistory` across tests** — each test gets a fresh one, or state bleeds. Call `reset_history()` between tests that share an agent fixture.
- **Seed randomness** if the agent or a tool uses it.
- **Assert on hook invocations** to ensure error paths fire — register a spy hook before `run()`.

## Anti-patterns

- Tests that silently call the real OpenAI API because the mock wasn't wired up — add a guard that fails loudly when `OPENAI_API_KEY` is set during unit tests.
- Integration tests with no offline guard — they run (and bill) in CI unless gated behind `RUN_PROVIDER_TESTS`.
- Integration tests with no `max_tokens` cap — costs spiral.
- Asserting on free-text LLM output in unit tests — assert on schema fields or hook events instead.
- Forgetting to `reset_history()` between tests that share an agent fixture.
- Testing a tool's happy path only, skipping its typed failure output.

For deeper material — async/streaming fixtures, Instructor test helpers, honest-test patterns — load `../framework/references/testing.md`.

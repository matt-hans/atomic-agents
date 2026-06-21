---
description: 'Instrument an `AtomicAgent` with Instructor hooks — telemetry, validation-error inspection, retries, and logging via `register_hook`. Use when the user asks to "add hooks", "handle parse/completion errors", "add retries/telemetry/logging", "register a hook", "instrument the agent", or runs `/atomic-add-hooks`.'
mode: 'agent'
---
# Add Hooks to an Atomic Agent

Atomic Agents surfaces Instructor's hook system on every agent. Use hooks for telemetry, validation-error inspection, retries, and logging rather than wrapping `run()` in `try/except` — a hook fires inside the request path with the raw exception or completion object in hand, so you see *why* a call failed (a `ValidationError` with field-level detail, a provider 429) instead of just catching whatever bubbled out of `run()`.

For the full reference (the five events, retry mechanics, production logging), the authority is `../references/hooks.md`. This skill is the action-oriented path: pick events → write handlers → register → verify.

## When this fires vs the umbrella `/atomic-framework` command

- **This skill**: the user wants to observe or harden an existing agent — "add logging", "count parse errors", "retry on rate limits", "register a completion:error hook".
- **`/atomic-framework` command**: questions about Atomic Agents in general, or the user is doing something other than instrumenting an agent.

## Phase 1 — Clarify

Bundle into one message:

1. **What concern?** Telemetry (counts/timing), validation-error inspection, retries, logging — or several.
2. **Which events?** Map the concern to events:
   - `completion:kwargs` — before the model call (start timer, mint a request id).
   - `completion:response` — after a successful response (stop timer, reset retry state).
   - `completion:error` — any provider/HTTP error (429, 5xx, timeout).
   - `parse:error` — Pydantic validation failed on the parsed response.
   - `completion:last_attempt` — the final retry before `run()` raises.
3. **Where do handlers live?** Register at agent construction time, one handler per concern.

Skip anything already settled in context.

## Phase 2 — Plan

State the plan in one short block:

- Which events, and one handler function (or one small class) per concern.
- Whether retries need an outer loop (provider errors) or Instructor's built-in `max_retries` already covers it (`parse:error`).
- Registration site — alongside the agent so it is wired once.

## Phase 3 — Implement

### Register and manage

```python
def on_response(resp): ...
def on_error(err):     ...

agent.register_hook("completion:response", on_response)
agent.register_hook("completion:error",    on_error)

# Remove one handler
agent.unregister_hook("completion:error", on_error)

# Clear all handlers for an event, or every handler
agent.clear_hooks("completion:error")
agent.clear_hooks()

# Toggle without unregistering
agent.disable_hooks()
agent.run(input_data)          # hooks skipped
agent.enable_hooks()

agent.hooks_enabled            # bool PROPERTY, not a method — no parentheses
```

Keep handlers cheap. They run synchronously in the request path — a slow logger delays every `run()`.

### Telemetry

```python
import time

metrics = {"requests": 0, "errors": 0, "parse_errors": 0, "total_ms": 0.0}
_t0: float | None = None

def on_kwargs(**_):
    global _t0
    _t0 = time.perf_counter()
    metrics["requests"] += 1

def on_response(_resp, **_):
    metrics["total_ms"] += (time.perf_counter() - _t0) * 1000

def on_parse_error(_err, **_):
    metrics["parse_errors"] += 1

def on_error(_err, **_):
    metrics["errors"] += 1

agent.register_hook("completion:kwargs",   on_kwargs)
agent.register_hook("completion:response", on_response)
agent.register_hook("parse:error",         on_parse_error)
agent.register_hook("completion:error",    on_error)
```

### Inspect validation errors

`parse:error` hands the handler the `ValidationError`. Its field-level detail tells you exactly what the model got wrong.

```python
from pydantic import ValidationError

def on_parse_error(error):
    if isinstance(error, ValidationError):
        for err in error.errors():
            loc  = ".".join(map(str, err["loc"]))
            kind = err["type"]
            msg  = err["msg"]
            logger.warning("LLM produced invalid field %s (%s): %s", loc, kind, msg)
```

`err["type"]` (`"missing"`, `"string_too_short"`, `"literal_error"`, …) identifies the failure. Use it to sharpen field `description=` text or tighten `Literal` sets.

### Retry on provider failures

Instructor already retries `parse:error` internally (`max_retries` on the client). For provider-level failures (429, 5xx, timeouts) use a `completion:error` hook plus an outer loop:

```python
import time

class Retrier:
    def __init__(self, max_attempts=3, base_delay=1.0):
        self.max_attempts = max_attempts
        self.base_delay = base_delay
        self.attempt = 0

    def on_error(self, error):
        self.attempt += 1
        msg = str(error).lower()
        if self.attempt < self.max_attempts and any(
            t in msg for t in ("rate limit", "timeout", "503", "502", "504")
        ):
            time.sleep(self.base_delay * (2 ** (self.attempt - 1)))

    def on_success(self, _resp):
        self.attempt = 0

def run_with_retry(agent, inp, r: Retrier):
    r.attempt = 0
    while True:
        try:
            return agent.run(inp)
        except Exception:
            if r.attempt >= r.max_attempts:
                raise

r = Retrier()
agent.register_hook("completion:error",    r.on_error)
agent.register_hook("completion:response", r.on_success)
```

### Production logging

One handler per concern; register them at agent construction time.

```python
import logging, uuid
log = logging.getLogger("agent")

class RequestLogger:
    def __init__(self):
        self.request_id: str = ""

    def on_kwargs(self, **kwargs):
        self.request_id = str(uuid.uuid4())
        log.info("agent.call", extra={"request_id": self.request_id, "model": kwargs.get("model")})

    def on_response(self, _resp):
        log.info("agent.ok", extra={"request_id": self.request_id})

    def on_error(self, error):
        log.error("agent.error", extra={"request_id": self.request_id, "error": str(error)})

rl = RequestLogger()
agent.register_hook("completion:kwargs",   rl.on_kwargs)
agent.register_hook("completion:response", rl.on_response)
agent.register_hook("completion:error",    rl.on_error)
```

Don't log full request/response payloads — they can contain user PII and inflate log volume. Log the `request_id` + model + timing and correlate with upstream logs.

### Hard rules

- **Handlers must not raise.** A hook exception propagates and can mask the original error. Log or meter, then return.
- `agent.hooks_enabled` is a read-only **property**, not a method — never write `agent.hooks_enabled()`.
- `parse:error` fires *before* Instructor retries. If the built-in retry succeeds, `completion:response` fires and `parse:error` does not re-fire for that call. For a definitive final-failure signal, pair it with `completion:last_attempt`.
- Register the same handler once. Registering it twice means it runs twice — `unregister_hook` the old one first.

## Phase 4 — Verify

```python
out = agent.run(MyInput(...))
print(metrics)        # telemetry handlers should have moved the counters
```

Confirm hooks are live and the toggle reads as a property:

```bash
uv run python -c "from <project>.agents.<agent_name> import agent; print('hooks_enabled =', agent.hooks_enabled)"
```

## Phase 5 — Hand off

Tell the user:

- Which events are wired and what each handler does.
- That handlers run in the request path — keep them cheap; push heavy work to a queue.
- How to toggle (`disable_hooks()` / `enable_hooks()`) and inspect (`agent.hooks_enabled`).
- Optional next steps:
  - Building or wiring the agent itself → `/atomic-create-agent` command.
  - Conversation persistence, summarization, multi-agent memory → `../references/memory.md`.

## Anti-patterns

- Wrapping `run()` in `try/except` for observability instead of registering hooks — you lose the raw `ValidationError` / provider exception the hook would hand you.
- Raising from inside a hook — the exception propagates and can mask the original error. Log/meter and return.
- `agent.hooks_enabled()` — it is a read-only property, not a method. Drop the parentheses.
- Slow I/O in a handler — it blocks every `run()`. Push heavy work to a queue.
- Assuming `parse:error` fires on every validation failure — Instructor's internal retry may resolve it first. Pair with `completion:last_attempt` for final-failure signals.
- Registering the same handler twice — duplicates run twice. `unregister_hook` the old one first.
- Logging full request/response payloads — PII risk and log bloat. Log `request_id` + model + timing.

For deeper material — the five events in full, retry mechanics, the repo's working example (`atomic-examples/hooks-example/hooks_example/main.py`) — load `../references/hooks.md`.


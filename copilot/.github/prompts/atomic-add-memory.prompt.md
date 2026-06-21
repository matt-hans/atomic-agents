---
description: 'Wire `ChatHistory` into an agent — multi-turn memory, persistence (`dump()`/`load()`), bounded history, summarization, and shared vs separate memory across agents. Use when the user asks to "add memory", "make the agent remember", "persist the conversation", "wire up ChatHistory", "summarize history", "share memory across agents", or runs `/atomic-add-memory`.'
mode: 'agent'
---
# Add Memory to an Atomic Agent

Memory in Atomic Agents is a `ChatHistory` object passed into `AgentConfig`. Each `agent.run()` produces **one turn** — the user message and the assistant response grouped under a shared `turn_id`. With a history wired in, turns accumulate automatically; without one, every `run()` is independent.

For deep material (the turn model, multimodal content, supervisor patterns, agent-to-agent loops), the authority is `../references/memory.md`. This skill is the action-oriented path: clarify → wire → persist → bound.

## When this fires vs the umbrella `/atomic-framework` command

- **This skill**: the user is adding or shaping memory — "make this agent remember", "persist the chat", "cap the history", "summarize old turns", "should these two agents share memory?".
- **`/atomic-framework` command**: questions about Atomic Agents in general, or the user is doing something other than wiring memory.

## Phase 1 — Clarify

Bundle into one message:

1. **Multi-turn or stateless?** Should the agent remember earlier exchanges, or is each `run()` independent? Stateless → omit `history` entirely.
2. **Persistence?** Does the conversation need to survive process restarts (save to disk / DB and reload later)?
3. **Long-running?** Will the session grow unbounded (a chat service, a long loop)? If so, plan bounding via `max_messages` or token monitoring.
4. **Multiple agents?** Do several agents participate in one conversation, or does each keep its own state? Concurrency matters — parallel agents must not share one `ChatHistory`.

Skip anything already settled in context.

## Phase 2 — Plan

State the plan in one short block:

- History: bounded (`ChatHistory(max_messages=N)`) or unbounded (`ChatHistory()`).
- Seed: optional assistant intro so the first user turn has something to reply to.
- Persistence: where `dump()` output is stored and when `load()` runs.
- Multi-agent: shared (sequential only) vs independent (default).

## Phase 3 — Wire history into the agent

History accumulates automatically inside `run()`. Do **not** call `add_message` for the assistant response — `run()` appends it under the current turn.

```python
from atomic_agents import AtomicAgent, AgentConfig
from atomic_agents.context import ChatHistory

history = ChatHistory()                 # unbounded
history = ChatHistory(max_messages=40)  # FIFO overflow — drops oldest

# Optional: seed with an assistant intro so the first user turn has something to reply to
history.add_message("assistant", BasicChatOutputSchema(chat_message="Hi!"))

agent = AtomicAgent[In, Out](config=AgentConfig(client=client, model="gpt-5-mini", history=history))
```

Omit `history` entirely for stateless agents — each `run()` is independent.

### Multi-turn vs stateless

What `agent.run(user_input)` does, in order:

1. `history.initialize_turn()` — create a new `turn_id`.
2. Append the user message under that turn.
3. Call the model with the full history + system prompt.
4. Parse the response into `OutputSchema`.
5. Append the assistant message under the same `turn_id`.

Consequences:

- `history.delete_turn_id(agent.history.current_turn_id)` undoes the last exchange (both user and assistant messages in one call).
- `run(None)` skips step 2 and re-runs the model over whatever is already in history — useful after manually injecting a message. It needs seeded history to respond to.
- `agent.reset_history()` wipes the history and restores the initial seed.

## Phase 4 — Persist and restore

`dump()` returns a JSON **string**. `load(s)` is an **instance** method that mutates the instance in place — construct first, then `.load(...)`.

```python
# Save
blob: str = history.dump()
open("session.json", "w").write(blob)

# Restore — load() mutates self; it is NOT a classmethod
restored = ChatHistory()
restored.load(open("session.json").read())

# Clone — fully independent copy via dump/load
clone = history.copy()
```

`load()` re-imports the schema classes by fully qualified name (stored in the dumped payload), so the same module layout must be importable at load time.

## Phase 5 — Bound the history

Unbounded history in a long-running service eventually overflows the context window. Two strategies:

### Message-count cap

```python
history = ChatHistory(max_messages=20)   # drop oldest when exceeded

history.get_message_count()              # -> int
history.get_history()                    # -> list[dict]  (role + JSON content)
history.delete_turn_id(turn_id)          # remove one turn; raises if not found
history.get_current_turn_id()            # -> Optional[str]
```

### Token-aware trimming and summarization

For token-aware trimming (rather than message-count), check utilization and act before the window fills:

```python
if agent.get_context_token_count().utilization > 0.8:
    # Either delete old turns ...
    history.delete_turn_id(old_turn_id)
    # ... or summarize them into a single synthetic message, then continue.
    summary = summarizer.run(SummaryInput(history=history.get_history()))
    agent.reset_history()
    agent.history.add_message("assistant", BasicChatOutputSchema(chat_message=summary.text))
```

Summarization collapses many old turns into one synthetic message so the conversation continues with a compact context.

## Phase 6 — Memory across multiple agents

### Independent histories (default)

Each agent gets its own `ChatHistory()`. Outputs flow between agents via typed schemas at the call site. This keeps state contained and is the default for multi-agent orchestration.

```python
router = AtomicAgent[In, RouteOut](config=AgentConfig(client=c, model=m, history=ChatHistory()))
worker = AtomicAgent[In, WorkOut](config=AgentConfig(client=c, model=m, history=ChatHistory()))
```

### Shared history (sequential only)

Two agents participate in one conversation by sharing a single `ChatHistory`.

```python
shared = ChatHistory()
router = AtomicAgent[In, RouteOut](config=AgentConfig(client=c, model=m, history=shared))
worker = AtomicAgent[In, WorkOut](config=AgentConfig(client=c, model=m, history=shared))
```

Only safe when the agents run **sequentially** on the same thread. Concurrent / parallel runs against one history race — messages interleave and corrupt turns. Parallel agents must each have their own `ChatHistory`.

For sharing a single fact (current user, selected dataset) without a full shared history, use a `BaseDynamicContextProvider` on each agent — see `context-providers.md`.

## Anti-patterns

- Unbounded `ChatHistory` in a long-running service — set `max_messages` or monitor `agent.get_context_token_count().utilization`.
- Sharing one `ChatHistory` across **parallel / concurrent** agents — messages interleave and corrupt turns. Give each parallel agent its own history.
- Calling `ChatHistory.load(saved)` as a classmethod — `load` is an **instance** method that mutates self; construct first, then `.load(...)`.
- Treating `dump()` output as a dict — it's a JSON **string**; parse it with `json.loads` before inspection.
- Calling `add_message` for the assistant response — `run()` already appends it.
- Expecting `run(None)` to work without seeded history — it needs existing messages to respond to.
- Storing secrets inside `BaseIOSchema` content — they are serialized by `dump()` and replayed on every `run()`.

For deeper material — the turn model, multimodal history, agent-to-agent messaging, supervisor-worker patterns — load `../references/memory.md`.


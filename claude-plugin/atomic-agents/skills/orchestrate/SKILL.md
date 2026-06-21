---
name: orchestrate
description: Wire multiple `AtomicAgent`s into a working system — routers with discriminated outputs, sequential pipelines, parallel fan-out, and supervisor loops — so one agent's typed output feeds the next. Use when the user asks to "orchestrate agents", "route between agents", "chain agents", "build a pipeline", "add a supervisor", "make agents work together", or runs `/atomic-agents:orchestrate`.
---

# Orchestrate Atomic Agents

Orchestration is composing single-transformer agents into a larger flow. Each agent stays a typed `BaseIOSchema -> BaseIOSchema` step; orchestration decides how their outputs feed each other. The four shapes are router, sequential pipeline, parallel fan-out, and supervisor loop — start with the simplest one that fits and compose only when it stops working.

For deep material (search+execute over large tool surfaces, shared context providers, multi-agent memory), the authority is `../framework/references/orchestration.md`. This skill is the action-oriented path: pick a pattern → wire types → run.

## When this fires vs the umbrella `framework` skill

- **This skill**: the user is connecting two or more existing agents — "route tickets to billing vs tech", "chain extract → score → summarize", "validate the writer with a reviewer loop".
- **`framework` skill**: questions about Atomic Agents in general, or authoring a single agent (use `create-atomic-agent`).

## Phase 1 — Pick the pattern

Match the situation to one shape before writing any wiring:

| Situation | Pattern |
|---|---|
| Classify a request, then hand off to a specialized agent | Router |
| Stages where each refines the last | Sequential pipeline |
| Independent lookups that can run at the same time | Parallel fan-out |
| Quality gate / iterative refinement | Supervisor loop |

Pick one, start minimal. The key design question in every case: **what schema does one agent emit, and how does it become the next agent's input?**

## Phase 2 — Wire the types

### Router — discriminated output, never a free-text topic

One agent classifies, others handle. Model the decision as a discriminated union of route schemas, each pinned by a `Literal` topic. Then branch on the concrete type with `isinstance`:

```python
from typing import Literal, Union
from pydantic import Field

class BillingRoute(BaseIOSchema):
    """Route to the billing agent."""
    topic: Literal["billing"] = "billing"
    normalized_question: str = Field(..., description="Rewritten for the billing agent.")

class TechRoute(BaseIOSchema):
    """Route to the tech-support agent."""
    topic: Literal["tech"] = "tech"
    normalized_question: str = Field(..., description="Rewritten for the tech-support agent.")

class Routing(BaseIOSchema):
    """Routing decision."""
    choice: Union[BillingRoute, TechRoute] = Field(..., description="Routed agent and payload.")

router = AtomicAgent[UserQuery, Routing](config=router_cfg)

decision = router.run(query)
if isinstance(decision.choice, BillingRoute):
    reply = billing_agent.run(...)
else:
    reply = tech_agent.run(...)
```

The discriminated union is what buys you type safety — a free-text `topic: str` field throws it away and the branch becomes a guess.

### Sequential pipeline — each output is the next input

Stages chain when the types line up. Python checks the alignment statically; the LLM runtime catches the misalignments it can't:

```python
extracted = extractor.run(RawDoc(text=doc))          # RawDoc -> Entities
scored    = scorer.run(ScoreQuery(entities=extracted.entities))
summary   = summarizer.run(SummaryReq(scored=scored))
```

When two stages don't agree on shapes, insert a typed adapter rather than reaching into fields ad hoc — it makes the contract explicit and stops fields from being silently dropped:

```python
def entities_to_score_query(e: Entities) -> ScoreQuery:
    return ScoreQuery(entities=e.entities, threshold=0.7)
```

### Parallel fan-out — independent lookups, isolated state

For lookups that don't depend on each other, run them with `asyncio.gather` and feed the combined results into a final agent:

```python
import asyncio

async def enrich(query):
    docs_task   = asyncio.create_task(doc_agent.run_async(DocLookup(q=query)))
    users_task  = asyncio.create_task(user_agent.run_async(UserLookup(q=query)))
    docs, users = await asyncio.gather(docs_task, users_task)
    return await summary_agent.run_async(Summary(docs=docs.items, users=users.items))
```

Each concurrent agent gets its **own** `ChatHistory` (or none at all). Sharing a `ChatHistory` across agents running at the same time races and corrupts state.

### Supervisor loop — validate-and-retry with a hard cap

A second LLM pass validates the first. The reviewer returns a typed verdict; loop until it accepts, feeding its notes back into the writer:

```python
draft = writer.run(DraftRequest(topic="Atomic Agents"))
for _ in range(3):
    verdict = reviewer.run(ReviewReq(draft=draft.text))
    if verdict.accept:
        break
    draft = writer.run(DraftRequest(topic="Atomic Agents", revise_notes=verdict.notes))
```

Always cap the loop with an explicit iteration bound — a bad prompt can oscillate forever between writer and reviewer.

## Phase 3 — Share state cheaply (optional)

When several agents need the same runtime state (session, user identity), register one provider instance on each rather than threading it through every schema. Updates propagate to all of them:

```python
session = SessionCtx()
router.register_context_provider("session", session)
billing_agent.register_context_provider("session", session)
tech_agent.register_context_provider("session", session)
```

This is cheaper than passing session state through every input/output schema, and keeps the coupling visible instead of hidden behind globals or file paths.

## Phase 4 — Run and verify

Drive the entry point and confirm the handoff produces the next agent's input type:

```python
decision = router.run(UserQuery(question="why was I charged twice?"))
print(type(decision.choice).__name__)   # BillingRoute / TechRoute
```

For pipelines, print each intermediate so a type mismatch surfaces at the offending stage rather than at the end.

## Anti-patterns

- Router that returns a free-text `topic` string instead of a discriminated `Union` — loses type safety and the `isinstance` branch.
- Sharing one `ChatHistory` across parallel agents — races and stale messages.
- Hidden coupling between agents via file paths or globals — put shared state behind a context provider or an explicit schema.
- Supervisor loops with no upper bound — always cap the iteration count.
- Sequential pipelines that silently drop fields between stages — use a typed adapter when shapes don't align.
- Reaching into another agent's output fields by hand when a typed adapter would make the contract explicit.

For deeper material — the search+execute pattern for large tool surfaces (dozens+ tools), full shared-context wiring, and the worked examples in `atomic-examples/orchestration-agent/` and `atomic-examples/deep-research/` — load `../framework/references/orchestration.md`. For conversation persistence and multi-agent memory across these flows, see `../framework/references/memory.md`.

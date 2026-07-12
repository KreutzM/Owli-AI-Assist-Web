# Cross-Repository Workflow

## Standard PWA contract change

1. Workspace tracking issue and child issues define shared acceptance criteria.
2. Backend PR implements contract/server behavior.
3. Web PR consumes the reviewed contract.
4. Android PR is added only when the shared change affects it.
5. Workspace PR updates the canonical contract and reviewed submodule pointers.
6. Landing PR follows when public messaging or discovery changes.

Use aligned branch names where feasible. Never update a workspace gitlink to an unpushed commit.

## Consistency with existing repositories

Kept consistent:

- tracking issue plus child issue,
- Planner / Builder / Reviewer separation,
- thematic branches,
- small commits and PRs,
- exact `RUN REVIEW` handoff,
- explicit maintainer merge decision,
- docs updated with behavior,
- connector-first GitHub review.

Intentional web differences:

- hosted CI is enabled because Node/browser checks are cheap compared with Android builds,
- Playwright WebKit is mandatory because iPhone Safari is a primary target,
- generated AI indexes have a stale check because generation is fast and deterministic,
- architecture guardrails target browser/API boundaries rather than Android hotspots,
- coverage is reported but not percentage-gated in the bootstrap; focused behavior tests and browser gates are mandatory, and scoped thresholds should be ratcheted as pure logic grows.

## Suggested unification later

Move the generic handoff wording into a canonical workspace template and synchronize small repository-specific copies. Adopt deterministic index generation and stale checking in app/backend only after measuring runner cost. Keep language-specific verification commands local to each runtime repository.

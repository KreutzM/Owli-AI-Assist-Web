# Architecture Guardrails

`pnpm guardrails` enforces lightweight rules that are cheap enough for every PR:

- source file size limits,
- no direct `fetch` outside `src/core/api`,
- no direct media/share/speech browser APIs outside `src/platform`,
- no `dangerouslySetInnerHTML`,
- no outward dependencies from `src/core`,
- no cross-feature imports.

These checks are intentionally simple and deterministic. They supplement TypeScript, ESLint, tests, review, and manual accessibility testing; they do not replace them.

When an exception is truly necessary, change the guardrail and architecture documentation in the same reviewed PR. Do not bypass a rule with obfuscated code.

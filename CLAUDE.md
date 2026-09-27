# Enterprise Research Workbench

Windows desktop application for project-based enterprise research using public information.

## Project guidance

- Product requirements and acceptance definitions: `docs/PRD.md` and `docs/release-gates.md`.
- Runtime boundaries and persistence: `docs/architecture.md`.
- Keep research projects, linked Agent runs, evidence, reports, and monitor checks scoped to the same project.
- Do not add stock, quote, portfolio, broker, or Longbridge functionality. Do not claim Craft Agents source-code reuse.
- Live model and public-search checks require the user's configured provider and Brave credentials; fixture verification is not a substitute for those live checks.

## Common commands

```bash
bun install
bun run dev
bun run typecheck
bun run test:unit
bun run test:e2e
```

Windows release packaging and acceptance are defined in `docs/release-gates.md`.

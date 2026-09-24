# Market Intelligence Agent

A desktop research workspace for business, strategy, and product teams. The goal is for an agent to use public information and observed evidence to choose its next research step, then produce competitor and industry reports with sources, conflicts, and gaps. While the app is running, it can track new public information for saved topics.

> This project is under active development. Its desktop and agent foundation comes from the jointly developed Folio codebase. This repository is adding a separate business-research workflow. The planned capabilities below are design targets, not shipped features.

## Planned Capabilities

- Public-information research across industry structure, competitor products, public pricing and channels, public customer-feedback signals, policy and technology risks, and evidence conflicts.
- Dynamic agent decisions: choose another public search, open a discovered source, or finish based on current evidence, with replayable run records.
- Evidence-backed reports that distinguish search snippets from inspected page text and retain sources, counter-evidence, and open questions.
- New-information monitoring while the app is running. A material update triggers a new research run and report comparison; background monitoring while the app is closed is not included in the first version.
- Evaluation targets: six enterprise research tasks, three strategies, and 24 executable cases. Actual passing results will be reported only after implementation and execution.

The system uses publicly accessible information only. Extracted dates, products, and public prices retain their source URL and text excerpt. Public comments are potentially biased feedback signals, not representative customer research. The first version does not connect to private enterprise systems or a separate enterprise-data service.

## Architecture

```text
React workspace
   │ typed IPC
Electron main process ── persistence, credentials, scheduler, public search
   │
Business research Runtime ── agent decision → tool call → observation → report
   │
Existing Folio Pi Agent runtime and desktop foundation
```

## Run Locally

Requires Bun and Node.js.

```bash
bun install
bun run dev
```

Setup, API-key configuration, and demo steps will be documented alongside the runnable research workflow. Live search requires a public-search API credential; sample material must never be presented as live findings.

## Project History and Contributions

I co-developed Folio with helsome. This repository preserves Folio's commit history and prior contribution records. The business-research domain, dynamic decisions, public-information monitoring, evaluation cases, and demo materials for Market Intelligence Agent are being implemented here. Folio's existing stock-screening tasks, investment strategies, and evaluation cases are not counted as new enterprise-research work in this project.

## Status

The latest Folio main branch has been synchronized, and the product design and implementation plan are in place. Business-research code and runtime verification are still in progress. Feature claims, evaluation counts, and live-run results will match the final commits and their verification records.

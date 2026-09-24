# Market Intelligence Agent Implementation Plan

> **For agentic workers:** Execute task-by-task in this session. Each task ends with a focused verification, a small commit, and a push to `Rapeter/Market-Intelligence-Agent`.

**Goal:** Deliver a desktop enterprise market and competitor research agent that dynamically selects public-information research actions, stores evidence-backed reports, detects material new public information while running, and exposes a measurable 6-task / 3-strategy / 24-case evaluation.

**Architecture:** Add an independent business-research domain and bounded Agent runtime under `packages/core` and `packages/shared`; keep Pi/provider and web-search details behind adapters. The Electron main process owns credentials, network access, persistence, scheduling, and validated IPC. React consumes typed client contracts and shows runs, evidence, reports, history, monitoring, and evaluation results.

**Tech Stack:** Bun workspaces, TypeScript, Pi runtime already in Folio, Electron main/preload IPC, React, Jotai, i18next, JSON-file persistence, Bun tests, Playwright/Electron E2E.

**Spec:** `docs/superpowers/specs/2026-09-23-market-intelligence-agent-design.md`

## Global Constraints

- Use only publicly accessible sources; extracted fields retain source URL, source excerpt, retrieval time, and extraction status.
- Public feedback is a biased signal, not representative customer research; do not describe it otherwise.
- The first version monitors only while the application runs; when reopened, it performs one overdue check.
- The Agent may choose only `search_web`, `open_source`, or `finish`; enforce iteration, tool, response-size, and total-time budgets.
- Search results and pages are untrusted data. Never execute page scripts or follow redirects to localhost, private, link-local, or reserved addresses.
- Secrets stay in encrypted main-process credentials and never appear in renderer contracts, research events, reports, or traces.
- Keep Folio source history and attribution. Do not claim the inherited investment features or Folio's 17/8/86 as new enterprise work.
- Full target: six enterprise research tasks, three strategies, and 24 executable cases; publish actual verified counts if a smaller version is released.
- Push each coherent, verified task as a separate commit to the user's `main` branch; preserve commit granularity.

## Review Focus

1. A model returns malformed JSON, an unknown action, or disallowed arguments — reject it as a typed model/decision error; cover with Core tests.
2. A public page redirects to a private IP, never resolves, or returns oversized HTML — stop before reading unsafe content; cover with web-adapter tests.
3. The same subscription signal is delivered twice or during restart — create at most one run per subscription/fingerprint; cover with repository/scheduler tests.
4. Search results contain prompt-injection text or unsupported claims — treat text as data and prevent unsupported citations; cover with evaluation cases.
5. A provider fails, a user cancels, or storage fails mid-run — persist the correct terminal state and do not overwrite the last successful report; cover with runtime recovery tests.

---

### Task 1: Anchor the Pi adapter and establish the personal repository

**Files:**
- Create: `docs/architecture/pi-business-research-adapter.md`
- Modify: `README.md`, `README.en.md`, `package.json`, `apps/electron/package.json`
- Test: `apps/electron/src/main/about.test.ts`, release metadata checks

**Interfaces:**
- The mapping note records `DecisionModelPort.decide(state, signal)` to the existing `PiRpcClient.promptStreaming` / isolated session path, tool schema registration, event normalization, cancellation, provider-error normalization, and the usage-metadata limitation.
- Keep existing package aliases when renaming the root product. The main product name becomes `Market Intelligence Agent`; inherited Folio attribution is explicit.

- [x] Read the installed Pi package version, `PiRpcClient.promptStreaming`, `PiRuntimeAdapter`, and the Folio extension tool registry; add the concrete mapping note before writing an adapter.
- [x] Rewrite README feature claims around public evidence research, scope, limitations, setup, evaluations, and Folio contribution history; keep Chinese and English descriptions aligned. Add real screenshots in Task 9 after the workflow UI exists.
- [x] Update desktop product name and app id without changing internal workspace import names; assert About/release metadata.
- [x] Run `bun test apps/electron/src/main/about.test.ts`, Electron typecheck, and release metadata/syntax checks; commit `docs: establish market intelligence product identity` and push.

### Task 2: Define business-research contracts and the six task / three strategy catalog

**Files:**
- Create: `packages/core/src/business-research.ts`, `packages/core/src/business-research.test.ts`
- Create: `packages/shared/src/business-research/catalog.ts`, `catalog.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/shared/src/index.ts`, `packages/shared/package.json`

**Interfaces:**

```ts
export type BusinessResearchAction =
  | { kind: 'search_web'; query: string; taskId: BusinessResearchTaskId }
  | { kind: 'open_source'; evidenceId: string }
  | { kind: 'finish'; rationale: string };

export interface BusinessResearchTaskInput {
  industry: string;
  question: string;
  competitors: string[];
  strategyId: BusinessResearchStrategyId;
  timeRange?: { from?: string; to?: string };
}
```

- [x] Add branded entity IDs and discriminated unions for six task ids, three strategy ids, evidence/source grades, report claims, run states, and terminal outcomes.
- [x] Implement input normalization/validation and catalog completeness checks; ensure no securities-symbol assumptions leak into the domain.
- [x] Test invalid competitors, blank questions, unsupported dates, all six unique tasks, all three strategies, and their task weights.
- [x] Run focused core/shared tests, full `bun run typecheck`, and `bun run test:unit`; commit and push `feat: define business research domain and catalog`.

### Task 3: Implement the deterministic decision loop and run event log

**Files:**
- Create: `packages/shared/src/business-research/core.ts`, `core.test.ts`
- Create: `packages/shared/src/business-research/runtime.ts`, `runtime.test.ts`
- Create: `packages/shared/src/business-research/events.ts`, `replay.ts`, `replay.test.ts`

**Interfaces:**

```ts
export interface DecisionModelPort {
  decide(input: { task: BusinessResearchTaskInput; observations: BusinessResearchObservation[]; allowedActions: BusinessResearchAction['kind'][] }, signal: AbortSignal): Promise<BusinessResearchAction>;
}
export interface BusinessResearchToolPort {
  searchWeb(query: string, signal: AbortSignal): Promise<BusinessResearchEvidence[]>;
  openSource(evidenceId: string, signal: AbortSignal): Promise<BusinessResearchEvidence>;
}
```

- [x] Write failing tests proving the model chooses a different next query after conflicting evidence and chooses `finish` after sufficient evidence.
- [x] Implement one-action-per-decision Core validation; reject unknown tools, invalid evidence ids, duplicate no-progress steps, and malformed decisions.
- [x] Implement Runtime budgets, cancellation, monotonic event sequence, and explicit `completed` / `partial` / `failed` / `cancelled` transitions.
- [x] Implement event replay that reconstructs the same observation state and strips secret-like fields before persistence.
- [x] Run focused Core/Runtime tests and shared typecheck; commit and push `feat: add bounded dynamic research loop`.

### Task 4: Add public web search, safe source reading, and citation-grade evidence

**Files:**
- Create: `packages/shared/src/business-research/brave-search.ts`, `brave-search.test.ts`
- Create: `packages/shared/src/business-research/public-page.ts`, `public-page.test.ts`
- Create: `packages/shared/src/business-research/evidence.ts`, `evidence.test.ts`
- Modify: `apps/electron/src/main/credentialStore.ts` only if a separate Brave credential namespace is needed

- [x] Check the current official Brave Search API schema before implementing requests; parse status, rate limits, and result URL/title/snippet without trusting remote data.
- [x] Add URL allow checks for HTTPS, redirect validation, private/reserved IP rejection after every DNS resolution, bounded response bytes/time, and static text extraction.
- [x] Normalize results into evidence ids with query, source URL, retrieval timestamp, source excerpt, and `search_excerpt` / `page_text` grade.
- [x] Preserve public-evidence provenance and permit opening only evidence ids discovered in the current run. Claim-to-case support checks belong with Task 5 synthesis/evaluation, before any claim is rendered as supported.
- [x] Test malformed responses, duplicate URLs, missing URLs, redirects, private IPs, timeout, oversized pages, and inert HTML/script content.
- [x] Run focused adapter tests; commit and push `feat: collect safe public web evidence`.

### Task 5: Build report synthesis, monitoring signals, and the 24-case evaluation corpus

**Files:**
- Create: `packages/shared/src/business-research/synthesis.ts`, `synthesis.test.ts`
- Create: `packages/shared/src/business-research/monitor-signals.ts`, `monitor-signals.test.ts`
- Create: `packages/shared/src/business-research/evaluation/cases.ts`, `cases.test.ts`, `metrics.ts`, `metrics.test.ts`

- [x] Implement the six task objectives: industry landscape, competitor products, pricing/channels, public feedback signals, policy/technology risk, evidence conflict/change review.
- [x] Implement three strategy profiles: industry overview, competitor deep dive, and change/risk tracking; strategies affect priorities and budgets, not a fixed tool order.
- [x] Synthesize claims only from persisted evidence and record contrary evidence, unresolved questions, monitoring actions, and source grades; reject missing evidence IDs and case-unsupported citations.
- [x] Add 24 versioned executable cases in the spec distribution; annotate permitted actions, expected terminal/check outcome, evidence support, and expected trigger behavior.
- [x] Implement metric formulas from the spec, including p50 and nearest-rank p95, task completion, terminal/check accuracy, admissible tool selection, citation validity/coverage, recovery, trigger precision/recall, and sample/exclusion counts.
- [x] Run all 24 cases through the fixture runtime and assert the design thresholds; commit and push the report synthesis, evaluation corpus, and metric evaluator in separate verified increments.

### Task 6: Persist reports, runs, and topic subscriptions with recovery

**Files:**
- Create: `packages/shared/src/business-research/repository.ts`, `repository.test.ts`
- Create: `packages/shared/src/business-research/service.ts`, `service.test.ts`, `scheduler.ts`, `scheduler.test.ts`
- Modify: `packages/shared/src/business-research/index.ts`, `packages/shared/src/index.ts`

- [x] Persist input snapshot, evidence, report, append-only events, subscription state, checks, and run fingerprints in separate validated JSON records under the existing user data root.
- [x] Implement `start`, `cancel`, `getRun`, `listRuns`, `getReport`, `listReports`, `subscribe`, `unsubscribe`, `listSubscriptions`, and `checkDue` with idempotent recovery.
- [x] Schedule checks every 24 hours by default (minimum one hour), catch up one overdue check on application restart, deduplicate per subscription/fingerprint, merge concurrent triggers, and persist skip/failure reasons.
- [x] Test interrupted writes, corrupted/missing checkpoint, app restart, duplicate signal, changed known page, unrelated item, disabled subscription, and no-change paths with a controllable clock.
- [x] Run focused repository/service/scheduler tests; commit and push `feat: persist research and monitor public changes`.

### Task 7: Wire credentials, runtime adapter, main-process composition, and typed IPC

**Files:**
- Create: `packages/shared/src/business-research/pi-adapter.ts`, `pi-adapter.test.ts`
- Create: `.pi/extensions/finagent/businessResearchTools.ts`, `businessResearchTools.test.ts`
- Modify: `.pi/extensions/finagent/index.ts`, `apps/electron/src/main/kernelHost.ts`, `apps/electron/src/main/index.ts`, `apps/electron/src/preload/index.ts`, `apps/electron/src/renderer/finagentClient.ts`, `packages/ui/src/client.tsx`

- [x] Implement the adapter strictly from the Task 1 mapping note; isolate each research run session, expose only business research tools for research prompts, normalize Pi events/errors, and stop work on abort.
- [x] Store the Brave API key through main-process encrypted credentials and return configured metadata only; never log or serialize its value.
- [x] Compose service and monitor scheduler in `kernelHost`, dispose timers and active runs on app shutdown, and keep monitor retries bounded.
- [x] Add runtime-validated IPC handlers and narrow preload wrappers for run lifecycle, reports, traces, metrics, and subscriptions; renderer cannot invoke arbitrary network access.
- [x] Test argument validation, credential redaction, IPC failures, disabled/unavailable Pi runtime, cancellation, and session isolation.
- [x] Run relevant main/preload tests and Electron typecheck; commit and push `feat: wire business research into electron runtime`.

### Task 8: Build the research workspace and monitoring/evaluation views

**Files:**
- Create: `packages/ui/src/components/businessResearch/BusinessResearchWorkspace.tsx` with co-located panels and tests
- Create: `packages/ui/src/atoms/businessResearchAtoms.ts`, tests
- Modify: `packages/ui/src/atoms/index.ts`, `packages/ui/src/atoms/workspaceAtoms.ts`, `packages/ui/src/components/workspace/FinanceWorkspace.tsx`, `packages/ui/src/components/layout/WorkspaceTopbar.tsx`, `packages/ui/src/components/layout/Sidebar.tsx`, and both locale research/navigation dictionaries

- [x] Add enterprise input form for industry, question, 2–4 competitors and strategy; show dynamically selected task facets in the run timeline; support fixture mode and explicit live-search key status.
- [x] Show decision timeline, current action, evidence grade, source links, claim citations, conflict/unknown states, partial/failure/cancel states, saved reports and report diffs.
- [x] Add monitoring subscribe/pause/remove controls with next-check and last-check reason, and evaluation results showing numerator, denominator, sample count, p50/p95, and fixture/live label.
- [x] Follow existing client/atom/i18n patterns; add accessible keyboard controls and narrow-screen layout.
- [x] Run UI unit tests and `bun run --filter @finagent/ui typecheck`; commit and push `feat: add business research workspace`.

### Task 9: Demonstrate dynamic decisions and automatic public-information triggers

**Files:**
- Create: `apps/electron/e2e/business-research.mjs`, test fixtures, `docs/demos/business-research/`
- Modify: `apps/electron/package.json` E2E scripts, `README.md`, `README.en.md`

- [x] Add E2E flows for fixture research, citations, reload persistence, manual rerun diff, monitor subscribe/pause, duplicate suppression, and automatic trigger after a material new fixture snapshot.
- [ ] Run the app with the configured real model and public search adapter. Capture two same-topic counterfactual runs where different evidence causes different valid next tool decisions; save redacted traces and actual elapsed times.
- [ ] Run one live subscription check that discovers new public information and triggers a research run; redact keys and any personal data from artifacts.
- [x] Capture current UI screenshots; update setup, feature boundaries, 6/3/24 counts, fixture evaluation results, attribution, and remaining limitations based only on observed results.
- [x] Run focused E2E and README consistency checks; commit and push `test: verify dynamic research and public change triggers`.

Task 9 fixture segment: the Electron flow persisted two fixture runs and verified citations, reload, rerun diff, monitor pause, and 24/24 deterministic cases; the monitor integration persisted two fixture follow-up runs, suppressed a duplicate signal, and issued zero network requests. The real-model counterfactual and live public-source trigger checks remain open until a dedicated profile has model and Brave credentials configured; fixture evidence is not a substitute.

### Task 10: Release audit and publish all verified commits

**Files:**
- Modify: release documentation and CI configuration only if required by observed failures

- [ ] Run `bun run typecheck`, `bun run test:unit`, `bun run build`, focused Electron E2E, and package smoke tests; record exact results.
- [ ] Inspect `git status`, commit history, branch base, secret scan, application metadata, README claims, and artifact links; ensure no unsupported benchmark or ownership claim remains.
- [ ] Push the verified release commit to `Rapeter/Market-Intelligence-Agent` `main`; verify remote commit SHA and the public repository page.
- [ ] Report the commit list, tests, actual evaluation counts/results, live-verification evidence, and any unmet release acceptance item.

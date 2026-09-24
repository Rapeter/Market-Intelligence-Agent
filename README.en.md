# Market Intelligence Agent

A desktop research workspace for business, strategy, and product teams. The agent uses public information and observed evidence to choose its next research step, then produces competitor and industry reports with sources, conflicts, and gaps. While the app is running, it can track new public information for saved topics.

> This is an alpha release. The business-research workflow and desktop UI are implemented; this page reports deterministic-fixture acceptance separately from real-model/public-search verification. The desktop and agent foundation comes from Folio, co-developed with helsome; its history and contribution records are preserved.

## Research Workflow

- Six research tasks: industry landscape, competitor products, pricing and channels, public feedback, policy and technology risks, and evidence-change review.
- Three strategies: industry overview, competitor deep dive, and change/risk tracking. Strategies change task priorities and search budgets; each agent step can only search public information, open a source discovered in the current run, or finish.
- Reports distinguish search snippets from inspected page text and retain citations, conflicts, unresolved questions, and evidence grades. A search snippet is never labeled as inspected page text.
- Subscriptions check on an interval while the app is running. A new source or material change to a known source can trigger follow-up research and a report comparison. Background monitoring while the app is closed is not included; on restart, at most one overdue check is caught up.

The system uses publicly accessible information only. Extracted dates, products, and public prices retain their source URL and text excerpt. Public comments are potentially biased feedback signals, not representative customer research. This version does not connect to private enterprise systems, customer-research systems, or an independent structured enterprise-data service.

## Acceptance Results

The following results come from deterministic local fixtures. They are not live-model accuracy or market findings.

| Metric | Observed result | Counting rule and acceptance |
| --- | --- | --- |
| Research tasks / strategies | 6 / 3 | Unique task IDs / strategy IDs in this project's catalog |
| Executable evaluation cases | 24/24 passed; 0 failed, 0 excluded | Fixed scripted decisions and snapshots; full target requires 24/24 expected outcomes |
| Research runs | 22/22 started, 0 unstarted; 17 completed, 4 partial, 1 failed, 0 cancelled | The 24 cases expect 22 runs; statuses are reported separately and an unstarted expected run is a case failure |
| Normal-task completion | 6/6 (100%) | Normal cases completed with required sections and at least one valid citation / 6; threshold 6/6 |
| Expected outcome accuracy | 24/24 (100%) | Cases matching the annotated run terminal state or monitor trigger/skip outcome / 24; threshold 24/24 |
| Tool-selection accuracy | 58/58 (100%) | Decisions whose action and arguments are in the annotated allowed set / all annotated decision points; fixture threshold 100%; live counterfactual acceptance is pending configuration |
| Citation validity / factual claim coverage | 17/17 (100%) / 14/14 (100%) | Valid citations supporting their claims / all citations; factual claims with valid evidence / all factual claims; both fixture thresholds are 100% |
| Conflict detection / recovery | 3/3 (100%) / 3/3 (100%) | Expected conflicts detected / conflict cases; recovery outcomes matching retry, partial, or explicit-failure expectation / 3; both thresholds are 3/3 |
| Automatic-trigger precision / recall | 2/2 (100%) / 2/2 (100%) | Correct triggers / all triggers; correct triggers / two expected-trigger cases; both thresholds are 2/2 and duplicate signals must not retrigger |
| Evaluation run latency | 22 samples; p50 16 ms, p95 21 ms, max 28 ms | Start-to-terminal samples under a controlled fixture clock; p50 is arithmetic median, p95 is nearest rank; thresholds: p95 ≤30,000 ms and max ≤60,000 ms |
| Evaluation tool latency | 38 samples; p95 5 ms | Nearest-rank p95 over fixture tool calls; not a measure of live network latency |
| Desktop research flow | 2 persisted runs, each with 2 fixture evidence records | Windows Electron UI click-to-report-visible timings are recorded in the machine artifact; one local sample, not a performance promise |
| Monitor integration | 3 checks, 2 follow-up runs; duplicate signal suppressed | Two fixed snapshots; 0 network requests; sample timings are in the machine artifact and are not real-site latency |
| Reload and report diff | Passed | Runs, reports, events, and paused state remained available after reload; the second same-topic run showed 2 new evidence records |

A zero denominator is not applicable, never 100%; percentages must not replace counts or hide failed samples. The fixed evaluation uses the scripted fixture model and source snapshots; it does not call a model provider or Brave Search. Per-case outcomes, numerators/denominators, sample counts, fixture model/source versions, evaluation time, and the Windows platform are recorded in the [machine-readable acceptance artifact](docs/demos/business-research/fixture-verification.json). Live counterfactual acceptance requires both evidence-different pairs to produce valid divergent next decisions with zero invalid tool calls. Live public-source monitoring requires an actual follow-up research run. Both remain pending configuration and cannot be replaced by fixture results.

Real-model same-topic counterfactual decisions (different evidence producing a different next tool choice) and change-triggering from a real public search source have not yet passed acceptance. They require configured model and Brave Search credentials and must be run separately; fixture results do not substitute for them.

Acceptance screenshots:

![First fixture report: illustrative evidence is labeled and open questions remain unresolved](docs/demos/business-research/fixture-first-report.png)

![Same-topic rerun shows newly observed evidence](docs/demos/business-research/fixture-rerun-diff.png)

![Paused monitor subscription remains paused after app reload](docs/demos/business-research/fixture-monitor-paused.png)

[Machine-readable fixture verification record](docs/demos/business-research/fixture-verification.json).

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

Run the research-flow acceptance test without external network access or API credentials:

```bash
bun run --filter @finagent/electron test:e2e:business-research
```

Live research additionally requires an available model provider and a Brave Search credential; credentials are stored securely by the Electron main process. Fixture samples are explicitly labeled illustrative and must not be treated as live findings.

Real-model and public-search acceptance use a separate local profile. Do not put credentials in the repository, command arguments, or chat. Windows PowerShell example:

```powershell
$liveProfile = Join-Path $env:LOCALAPPDATA 'Market-Intelligence-Agent\live-e2e'
bun run --filter @finagent/electron business-research:live-profile -- prepare "$liveProfile"
node apps/electron/e2e/business-research-live-profile.mjs open "$liveProfile"
```

When the window opens, complete first-run onboarding if needed, configure a model provider in Settings and Brave Search in the Market Intelligence workspace. Return to the terminal and press Enter to close the window after saving; this profile remains on the local machine for later acceptance runs. The script marks only an empty directory or one it has already marked, and refuses repository paths and unmarked non-empty directories.

After closing the setup window, run live acceptance in the same PowerShell session. It accesses Brave Search and the configured model provider, creates and then disables one acceptance subscription in the dedicated profile, and may incur provider usage charges:

```powershell
$env:FINAGENT_LIVE_E2E_USER_DATA_DIR = $liveProfile
bun run --filter @finagent/electron test:e2e:business-research:live
```

On success, the run writes the redacted record `docs/demos/business-research/live-verification.json`. Its traces retain validated actions, public-source location metadata, content hashes, and elapsed times, not credentials or raw page text.

## Project History and Contributions

I co-developed Folio with helsome. This repository preserves Folio's commit history and prior contribution records. The business-research domain, dynamic decisions, public-information monitoring, evaluation cases, and demo materials for Market Intelligence Agent have been implemented here and continue to be verified. Folio's existing stock-screening tasks, investment strategies, and evaluation cases are not counted as new enterprise-research work in this project.

## Status

Current acceptance boundary: fixture research, persistence, report diff, monitor trigger/deduplication, and UI reload have passed. Real-model counterfactual decisions and real public-source monitoring still need live verification after credentials are configured. The 6/3/24 counts belong to this enterprise-research catalog and corpus; they do not reuse Folio investment research's 17/8/86 or claim those counts are equivalent.

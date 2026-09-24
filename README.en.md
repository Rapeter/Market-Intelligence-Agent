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

| Metric | Result | Counting rule |
| --- | --- | --- |
| Research tasks / strategies | 6 / 3 | Unique task and strategy IDs in the project catalog |
| Executable evaluation cases | 24/24 passed; 0 failed, 0 excluded | Fixed scripted decisions and snapshots covering research runs, report/citation safety, recovery, and automatic triggers; not an estimate of real-model generalization |
| Desktop research flow | 2 persisted runs, each with 2 fixture evidence records | Click-to-terminal-report-visible: 1,503 ms and 1,496 ms in this sample; local fixture timings, not an SLA |
| Monitor integration | 3 checks; new-source and changed-source signals triggered 2 follow-up runs; duplicate signal suppressed | Two fixed snapshots; 0 network requests; check timings 56 ms, 38 ms, and 4 ms in this sample, not real-site latency |
| Reload and report diff | Passed | Run, report, events, and paused state remained available after reload; the second same-topic run showed 2 new evidence records |

The numerator, denominator, and acceptance threshold for task completion, tool selection, citation validity/factual coverage, conflict detection, recovery, and trigger precision/recall are defined individually in [Evaluation Metrics and Counting Rules](docs/superpowers/specs/2026-09-23-market-intelligence-agent-design.md#评测指标统计口径与通过条件). A zero denominator is not applicable; sample counts must not be omitted in favor of percentages alone. Latencies are in milliseconds. Evaluation p50 is the arithmetic median; p95 uses nearest rank (the sorted sample at `ceil(0.95 × N)`). The two UI fixture timings are reported as raw observations, not a performance promise.

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
bun run --filter @finagent/electron business-research:live-profile -- open "$liveProfile"
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

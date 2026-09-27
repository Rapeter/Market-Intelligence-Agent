# Windows Release Gates — Enterprise Research Workbench

A release candidate is acceptable only when all required local gates pass and the exact fixture/live boundary is stated. This is a Windows desktop application; macOS packaging is out of scope.

## Required offline gates

| Gate | Command | Acceptance |
| --- | --- | --- |
| Typecheck | `bun run typecheck` | All workspace packages pass |
| Unit/integration | `bun run test:unit` | 0 failures |
| Locale parity | `bun run i18n:check` | English and Chinese key/interpolation parity |
| Windows build | `bun run build` | Renderer, main, preload, shared packages and Pi extension bundle |
| Fixture research evaluation | `bun run --filter @finagent/electron test` / workspace fixture evaluator | 24/24 corpus cases; 6 tasks and 3 strategies are the catalog definitions |
| Desktop E2E | `bun run test:e2e` | Project → run → decisions/evidence → report → linked follow-up → reload; monitor run keeps project |
| Windows installer | `bun run release:package` | NSIS installer and SHA-256 manifest |
| Packaged smoke | `bun run test:package-smoke` | Unpacked app starts, loads the bundled Pi runtime, and persists a project |
| Clean installer smoke | `bun run test:installer-smoke` | Silently installs the NSIS package to an isolated temp folder, starts Pi and the UI, creates a project, uninstalls, and removes only its temp files |

On Windows hosts where the account cannot create symlinks while extracting electron-builder's signing tools, set `FINAGENT_SKIP_WIN_RESOURCE_EDIT=1` before `bun run release:package`. This explicit fallback skips executable icon/version metadata editing; it does not change runtime contents, and the regular branded package remains the default.

The 24-case fixture corpus is deterministic and is not a measure of live model accuracy. Report numerators, denominators, sample counts and timing definitions in the machine-readable acceptance artifact. Do not substitute Folio's 17/8/86 investment catalog or evaluation counts.

## Credentialed checks (separate, optional)

- Dynamic real-model decision acceptance requires two evidence-counterfactual inputs to cause validly different next actions and zero invalid tool calls.
- Public-source monitor acceptance requires a real detected change to start a project-attributed follow-up run.
- These checks may use external services and incur provider usage. If credentials are not configured or the run is not performed, report them as pending, never as passed.

## Data and migration checks

- Re-run the legacy enterprise-record migration twice; the second pass must not change destination content or overwrite an existing record.
- Keep the Windows userData directory stable across display rebranding.
- Before cleaning `Market-Intelligence-Agent/live-e2e`, inventory and inspect each file, preserve a recoverable copy, remove only verified investment data, and retain enterprise records and credentials. Never delete the full profile or untracked `tmp/` data.
- Verify reachable navigation, IPC, package dependencies, preload exports, documentation and assets contain no investment product capability or Longbridge dependency.

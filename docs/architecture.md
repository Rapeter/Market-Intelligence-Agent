# Enterprise Research Workbench — Architecture

## Scope

This Windows desktop product keeps the Electron/React shell, the Pi Agent runtime foundation, project/session experience, and three-column workspace developed in Folio with helsome. The active business domain is public-information enterprise research only; no Craft Agents source is claimed or imported.

## Runtime and data flow

```
React renderer
  ├─ left: project selection and creation
  ├─ center: project scope, runs, decision trace, evidence, report, monitor, fixture metrics
  └─ right: project-linked Agent questions and follow-ups
        │ typed, allow-listed IPC
Electron main process
  ├─ Project/research repository (atomic JSON files)
  ├─ CredentialStore (main-process encrypted provider credentials)
  ├─ BusinessResearchService + monitor scheduler
  └─ Pi runtime host
        │ run-scoped tool adapter
Pi Agent extension
  ├─ business_research_search
  └─ business_research_open
```

A project is the durable root. Starting an Agent question creates a business-research run; the question is passed as the research brief to the Pi runtime. Decision events, tool calls, evidence, report, and follow-up lineage use the same run ID. Monitor-created runs inherit the subscription's project and topic.

## Persistence and migration

- Repositories write through the shared atomic JSON store, including bounded retry for transient Windows rename failures.
- The legacy enterprise-research migration is idempotent and never overwrites an existing destination record.
- Electron's Windows userData location remains `%APPDATA%\Market Intelligence Agent` after display-name rebranding, preserving projects and encrypted credentials from earlier builds.
- Dedicated live-E2E profiles are explicitly selected by `FINAGENT_USER_DATA_DIR`; they are separate from the user's default profile.
- The Windows installer bundles the Pi CLI as an application dependency and launches it with Electron's Node runtime; end users do not need to install Bun separately.

## Security boundaries

- The renderer uses typed IPC and does not access filesystem, credentials, or Pi process directly.
- Live search keys stay in main-process credential storage and are injected into the trusted tool adapter, never tool arguments.
- Only public search results and sources discovered in the same run can be opened.
- Diagnostics redact credentials and report environment/runtime status only.
- User-supplied provider overrides and custom model endpoints remain supported.

## Windows acceptance surface

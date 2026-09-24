# Pi adapter map for business research

This note records the existing runtime contract before adding business research tools. It is grounded in the current Folio code and the installed Pi runtime; it does not assume the standalone `AgentSession` API is used in this application.

## Existing path

- The app runs Pi as a child process through `PiRpcClient` (`packages/shared/src/agent/pi-rpc-client.ts`). It sends a prompt with `promptStreaming(content)` and yields parsed Pi events until an `end` or `error` item.
- `PiRuntimeAdapter` (`packages/shared/src/agent/pi-runtime-adapter.ts`) selects a JSONL session with `switchSession`, creates an `AgentRunInput` prompt, and maps raw events with `PiEventAdapter` (`packages/shared/src/agent/pi-event-adapter.ts`). One Pi process is shared, so the adapter switches session files and does not provide parallel prompt execution.
- The extension's local `Tool` contract is declared in `.pi/extensions/finagent/index.ts`; `registerTools()` registers the generated capability tools. It is not the SDK's in-process `defineTool()` contract. Tool arguments are validated by each extension tool and the shared capability layer.
- Raw Pi tool events become the product's `tool_started` and `tool_completed` events. `ToolCallRecord` preserves tool name, arguments, start/end times, status, error, result, and nested trace when available.

## Business research port mapping

| Domain port | Existing Pi/runtime surface | Adapter responsibility |
| --- | --- | --- |
| `DecisionModelPort.decide(state, signal)` | A dedicated Pi session and `PiRpcClient.promptStreaming()` | Send only the compact task, current evidence summaries, remaining budget, and permitted action schema. Require one bounded action per decision step; parse and validate the resulting action before it enters Core. |
| `search_web` / `open_source` tool execution | New namespaced tools registered through the extension's local `Tool` interface | Validate arguments again in the tool executor, pass the request abort signal, return bounded text plus evidence id/provenance, and redact provider errors. |
| Tool call trace and observation | Raw Pi tool-call events normalized by `PiEventAdapter` | Convert each call to a domain decision/tool/observation event with monotonic sequence. Never persist API keys or raw unbounded page text. |
| Cancellation | `PiRuntimeAdapter.cancel()` → `PiRpcClient.abortCurrentPrompt()`; extension tools receive `AbortSignal` | Abort the current model request and fetch; emit a single terminal `cancelled` state; do not schedule the next loop step. |
| Provider error | `PiRuntimeAdapter` normalizes low-level failures to `ApiError` | Map auth, rate limit, timeout, unavailable, invalid decision, and generic runtime failures to stable business run codes; do not retry auth or cancellation. |
| Usage | Pi stream events/result and existing observability trace | Persist available token, call, and duration values. Some providers omit usage on terminal events; absent token values remain absent and are reported as unavailable, not zero. |

## Constraints to verify during implementation

1. The current prompt API runs a complete Pi prompt; one-action-per-decision semantics must be enforced by the extension guard/runtime and covered with a test, not assumed from prompt wording.
2. The shared Pi child process serializes active prompts. A business run must not switch its session while another prompt is streaming; the service must queue or reject overlapping prompts.
3. Business research runs use a per-run JSONL session and a tool allow-list containing only `business_research_search` and `business_research_open`. Financial tools and skill-resource tools are not available to this workflow.
4. The Brave credential is read from encrypted main-process storage and passed only to the trusted runtime tool boundary under a dedicated environment key. It is excluded from prompts, IPC responses, event records, and logs.
5. Before changing Pi dependency versions or directly calling an SDK API, read the installed declarations/source and record the verified mapping here. Current app code uses the RPC wrapper.

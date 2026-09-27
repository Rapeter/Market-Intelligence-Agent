import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { app } from 'electron';
import type {
  AppPreferencesSnapshot,
  BusinessResearchProjectId,
  BusinessResearchReportId,
  BusinessResearchRunId,
  BusinessResearchSubscriptionId,
  BusinessResearchIdKind,
  CredentialInfo,
  CustomProviderConfig,
  LlmModel,
  LlmRuntimeState,
  LlmTestResult,
  ProviderStatus,
} from '@finagent/core';
import {
  isBusinessResearchRunMode,
  normalizeBusinessResearchInput,
  parseBusinessResearchId,
} from '@finagent/core';
import { isLocalePreference } from '@finagent/i18n';
import {
  BusinessResearchRepository,
  BusinessResearchScheduler,
  BusinessResearchService,
  createBraveBusinessResearchTools,
  createPiBusinessResearchAdapter,
  evaluateBusinessResearchEvaluationCorpus,
  createBusinessResearchFixtureDecisionModel,
  createBusinessResearchFixtureTools,
  createBusinessResearchFixtureReportDraft,
  type BusinessResearchToolPort,
  type BusinessResearchMonitorSourceSnapshot,
  type PiBusinessResearchAdapter,
} from '@finagent/shared/business-research';
import { createCodeError } from '@finagent/shared/agent/errors';
import { PiRpcClient } from '@finagent/shared/agent/pi-rpc-client';
import { JsonFileStore } from '@finagent/shared/storage/json-file-store';
import { getPiCwd, getPiExtensionEntry, getRuntimeRoot } from '@finagent/shared/resources';
import { collectDiagnostics, type DiagnosticsBundle } from '@finagent/shared/diagnostics';
import { createAppPreferencesService, type AppPreferencesService } from './app-preferences.ts';
import {
  BUSINESS_RESEARCH_BRAVE_CREDENTIAL_ID,
  CredentialStore,
  redactSecrets,
} from './credentialStore.ts';
import {
  runBusinessResearchLiveCounterfactuals,
  summarizeLiveMonitorFollowUpRun,
} from './businessResearchLiveE2e.ts';
import { retryTransientMonitorProbe } from './businessResearchMonitorRetry.ts';
import { resolveBundledPiCliEntry } from './piRuntime.ts';
import { isBusinessResearchLiveE2eEnabled } from '../businessResearchLiveE2eMode.ts';
import { mainErrorLog } from './ipcResult.ts';

const DEFAULT_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export class AgentKernelHost {
  private readonly credentials: CredentialStore;
  private readonly businessResearchRepository: BusinessResearchRepository;
  private readonly businessResearchService: BusinessResearchService;
  private readonly businessResearchScheduler: BusinessResearchScheduler;
  private readonly businessResearchPiRpc?: PiRpcClient;
  private readonly businessResearchAdapter?: PiBusinessResearchAdapter;
  private readonly appPreferences: AppPreferencesService;
  private readonly provider: 'local' | 'pi-runtime';

  constructor() {
    this.provider = process.env.FINAGENT_AGENT_PROVIDER === 'local' ? 'local' : 'pi-runtime';
    process.env.FINAGENT_PI_EXTENSION = getPiExtensionEntry();

    const userData = app.getPath('userData');
    this.credentials = new CredentialStore(join(userData, 'credentials.json'));
    this.appPreferences = createAppPreferencesService(new JsonFileStore(userData), () => app.getLocale());

    this.businessResearchRepository = new BusinessResearchRepository(new JsonFileStore(userData));
    const sessionDirectory = join(userData, 'business-research-pi-sessions');
    if (this.provider === 'pi-runtime') {
      const usesBundledPiRuntime = process.env.FINAGENT_PI_COMMAND === undefined;
      this.businessResearchPiRpc = new PiRpcClient({
        command: process.env.FINAGENT_PI_COMMAND ?? process.execPath,
        args: createBusinessResearchPiArgs(sessionDirectory, usesBundledPiRuntime),
        cwd: getPiCwd(),
        sessionDir: sessionDirectory,
        requiredEnvKeys: process.env.FINAGENT_LLM_ENV_KEYS?.split(',').map((key) => key.trim()).filter(Boolean) ?? [],
        env: () => this.buildRuntimeEnv(),
      });
      this.businessResearchAdapter = createPiBusinessResearchAdapter({
        rpc: this.businessResearchPiRpc,
        sessionDirectory,
        prepareRequest: async () => {
          const state = await this.businessResearchPiRpc?.getState();
          if (state?.model?.provider && state.model.id) {
            await this.businessResearchPiRpc?.setModel(state.model.provider, state.model.id);
          }
          if (state?.thinkingLevel) {
            await this.businessResearchPiRpc?.setThinkingLevel(state.thinkingLevel);
          }
        },
      });
    }

    this.businessResearchService = new BusinessResearchService(this.businessResearchRepository, {
      createDecisionModel: (runId, task, mode) => mode === 'fixture'
        ? createBusinessResearchFixtureDecisionModel(task)
        : this.businessResearchAdapter?.createDecisionModel(runId) ?? {
            async decide() {
              throw createCodeError('BUSINESS_RESEARCH_PI_UNAVAILABLE', 'Configure an available Pi model runtime to run research.');
            },
          },
      createTools: (_runId, task, mode) => mode === 'fixture'
        ? createBusinessResearchFixtureTools(_runId, task)
        : this.createCredentialBackedBraveTools(),
      generateReport: async (input) => {
        if (input.mode === 'fixture') return createBusinessResearchFixtureReportDraft(input);
        if (!this.businessResearchAdapter) {
          throw createCodeError('BUSINESS_RESEARCH_PI_UNAVAILABLE', 'Configure an available Pi model runtime to write reports.');
        }
        return this.businessResearchAdapter.generateReport(input);
      },
    });

    this.businessResearchScheduler = new BusinessResearchScheduler(
      this.businessResearchRepository,
      this.businessResearchService,
      {
        probe: (input) => retryTransientMonitorProbe(input.signal, async () => {
          const tools = this.createCredentialBackedBraveTools();
          const found = await tools.searchWeb(input.query, input.signal);
          const snapshots: BusinessResearchMonitorSourceSnapshot[] = [];
          for (const result of found.slice(0, 5)) {
            let snapshot = result;
            try {
              snapshot = await tools.openSource(result.id, input.signal);
            } catch {
              // The search excerpt remains usable evidence, but is kept unverified.
            }
            snapshots.push({
              url: snapshot.url,
              title: snapshot.title,
              summary: snapshot.excerpt,
              contentFingerprint: createHash('sha256').update(snapshot.excerpt).digest('hex'),
              retrievedAt: snapshot.retrievedAt,
            });
          }
          return snapshots;
        }),
      },
    );
    this.businessResearchScheduler.start();
  }

  async dispose(): Promise<void> {
    await this.businessResearchScheduler.dispose();
    await this.businessResearchService.dispose();
    await this.businessResearchPiRpc?.dispose();
  }

  async businessResearchCredentialStatus(): Promise<{ configured: boolean; updatedAt?: number }> {
    return this.credentials.getCredentialMetadata(BUSINESS_RESEARCH_BRAVE_CREDENTIAL_ID);
  }

  async businessResearchSetBraveKey(input: unknown): Promise<{ configured: boolean; updatedAt?: number }> {
    const request = requireObject(input);
    const apiKey = requireString(request.apiKey, 'apiKey').trim();
    if (apiKey.length < 12 || apiKey.length > 4_096) {
      throw createCodeError('INVALID_ARGUMENT', 'Brave Search API key must be between 12 and 4096 characters.');
    }
    await this.credentials.setCredential(BUSINESS_RESEARCH_BRAVE_CREDENTIAL_ID, apiKey);
    return this.businessResearchCredentialStatus();
  }

  async businessResearchRemoveBraveKey(): Promise<{ configured: boolean; updatedAt?: number }> {
    await this.credentials.removeCredential(BUSINESS_RESEARCH_BRAVE_CREDENTIAL_ID);
    return this.businessResearchCredentialStatus();
  }

  businessResearchCreateProject(input: unknown) {
    return this.businessResearchService.createProject(input);
  }

  businessResearchListProjects() {
    return this.businessResearchService.listProjects();
  }

  async businessResearchStart(input: unknown) {
    const request = requireObject(input);
    const mode = request.mode === undefined ? 'live' : request.mode;
    if (!isBusinessResearchRunMode(mode)) {
      throw createCodeError('INVALID_ARGUMENT', 'mode must be live or fixture.');
    }
    return this.businessResearchService.start(request.task ?? request, {
      mode,
      ...(request.projectId === undefined ? {} : { projectId: requireBusinessResearchId('project', request.projectId) as BusinessResearchProjectId }),
      ...(request.parentRunId === undefined ? {} : { parentRunId: requireBusinessResearchId('run', request.parentRunId) as BusinessResearchRunId }),
    });
  }

  async businessResearchCancel(input: unknown): Promise<boolean> {
    const request = requireObject(input);
    return this.businessResearchService.cancel(requireBusinessResearchId('run', request.runId) as BusinessResearchRunId);
  }

  businessResearchListRuns() {
    return this.businessResearchService.listRuns();
  }

  async businessResearchGetRun(input: unknown) {
    const request = requireObject(input);
    return this.businessResearchService.getRun(requireBusinessResearchId('run', request.runId) as BusinessResearchRunId);
  }

  async businessResearchListEvents(input: unknown) {
    const request = requireObject(input);
    return this.businessResearchService.listEvents(requireBusinessResearchId('run', request.runId) as BusinessResearchRunId);
  }

  businessResearchListReports() {
    return this.businessResearchService.listReports();
  }

  async businessResearchGetReport(input: unknown) {
    const request = requireObject(input);
    return this.businessResearchService.getReport(requireBusinessResearchId('report', request.reportId) as BusinessResearchReportId);
  }

  businessResearchEvaluate() {
    return evaluateBusinessResearchEvaluationCorpus();
  }

  async businessResearchSubscribe(input: unknown) {
    const request = requireObject(input);
    if (request.intervalMs !== undefined && (typeof request.intervalMs !== 'number' || !Number.isSafeInteger(request.intervalMs))) {
      throw createCodeError('INVALID_ARGUMENT', 'intervalMs must be a safe integer.');
    }
    return this.businessResearchService.subscribe(request.task ?? request, {
      intervalMs: request.intervalMs as number | undefined,
      ...(request.projectId === undefined ? {} : { projectId: requireBusinessResearchId('project', request.projectId) as BusinessResearchProjectId }),
    });
  }

  async businessResearchUnsubscribe(input: unknown) {
    const request = requireObject(input);
    return this.businessResearchService.unsubscribe(requireBusinessResearchId('subscription', request.subscriptionId) as BusinessResearchSubscriptionId);
  }

  async businessResearchResumeSubscription(input: unknown) {
    const request = requireObject(input);
    return this.businessResearchService.resumeSubscription(requireBusinessResearchId('subscription', request.subscriptionId) as BusinessResearchSubscriptionId);
  }

  async businessResearchRemoveSubscription(input: unknown) {
    const request = requireObject(input);
    return this.businessResearchService.removeSubscription(requireBusinessResearchId('subscription', request.subscriptionId) as BusinessResearchSubscriptionId);
  }

  businessResearchListSubscriptions() {
    return this.businessResearchService.listSubscriptions();
  }

  async businessResearchListChecks(input: unknown) {
    const request = requireObject(input);
    return this.businessResearchRepository.listChecks(requireBusinessResearchId('subscription', request.subscriptionId) as BusinessResearchSubscriptionId);
  }

  businessResearchCheckDue() {
    return this.businessResearchScheduler.checkDue();
  }

  async businessResearchRunLiveCounterfactualProbes(input: unknown) {
    this.assertBusinessResearchLiveE2eEnabled();
    const request = requireObject(input);
    const normalized = normalizeBusinessResearchInput(request.task);
    if (!normalized.ok) {
      throw createCodeError('BUSINESS_RESEARCH_INVALID_INPUT', 'Invalid live counterfactual research task.');
    }
    if (!this.businessResearchAdapter) {
      throw createCodeError('BUSINESS_RESEARCH_PI_UNAVAILABLE', 'Configure a live Pi model before running acceptance.');
    }
    if (!(await this.businessResearchCredentialStatus()).configured) {
      throw createCodeError('BUSINESS_RESEARCH_BRAVE_CREDENTIAL_MISSING', 'Configure Brave Search before running acceptance.');
    }
    const state = await this.getLlmState();
    const modelProvider = state.model?.provider;
    const modelId = state.model?.id;
    if (!modelProvider || !modelId) {
      throw createCodeError('BUSINESS_RESEARCH_MODEL_UNAVAILABLE', 'Select an available model before running acceptance.');
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 150_000);
    try {
      const result = await runBusinessResearchLiveCounterfactuals({
        task: normalized.value,
        tools: this.createCredentialBackedBraveTools(),
        createDecisionModel: (runId) => this.businessResearchAdapter!.createDecisionModel(runId),
        createRunId: () => {
          const id = parseBusinessResearchId('run', `run-live-e2e-${randomUUID()}`);
          if (id === undefined) throw createCodeError('BUSINESS_RESEARCH_INVALID_ID', 'Could not create a live probe identifier.');
          return id as BusinessResearchRunId;
        },
        sanitizeText: redactSecrets,
        signal: controller.signal,
      });
      return { model: { provider: modelProvider, id: modelId }, elapsedMs: Date.now() - startedAt, ...result };
    } catch (error) {
      if (timedOut) throw createCodeError('BUSINESS_RESEARCH_LIVE_E2E_TIMEOUT', 'Live counterfactual acceptance exceeded 150 seconds.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async businessResearchCheckSubscriptionNow(input: unknown) {
    this.assertBusinessResearchLiveE2eEnabled();
    const request = requireObject(input);
    const subscriptionId = parseBusinessResearchId('subscription', request.subscriptionId) as BusinessResearchSubscriptionId | undefined;
    if (subscriptionId === undefined) throw createCodeError('INVALID_ARGUMENT', 'subscriptionId must be a valid subscription id.');
    const subscription = await this.businessResearchRepository.getSubscription(subscriptionId);
    if (subscription === undefined || !subscription.enabled) {
      throw createCodeError('BUSINESS_RESEARCH_SUBSCRIPTION_UNAVAILABLE', 'The live acceptance subscription is unavailable.');
    }
    if (!(await this.businessResearchCredentialStatus()).configured) {
      throw createCodeError('BUSINESS_RESEARCH_BRAVE_CREDENTIAL_MISSING', 'Configure Brave Search before running acceptance.');
    }
    const now = Date.now();
    await this.businessResearchRepository.saveSubscription({ ...subscription, updatedAt: now, nextCheckAt: now });
    const checks = await this.businessResearchScheduler.checkDue();
    const check = checks.find((item) => item.subscriptionId === subscriptionId);
    if (check === undefined) throw createCodeError('BUSINESS_RESEARCH_LIVE_E2E_CHECK_MISSING', 'The real subscription check did not complete.');
    const run = check.runId === undefined ? undefined : await this.businessResearchService.waitForRun(check.runId);
    if (run !== undefined && run.mode !== 'live') {
      throw createCodeError('BUSINESS_RESEARCH_LIVE_E2E_FIXTURE_RUN', 'The live monitor created a non-live research run.');
    }
    return {
      check: {
        id: check.id,
        subscriptionId: check.subscriptionId,
        decision: check.decision,
        runId: check.runId ?? null,
        startedAt: check.startedAt,
        completedAt: check.completedAt,
      },
      followUpRun: summarizeLiveMonitorFollowUpRun(run),
    };
  }

  private assertBusinessResearchLiveE2eEnabled(): void {
    if (!isBusinessResearchLiveE2eEnabled({
      isPackaged: app.isPackaged,
      e2e: process.env.FINAGENT_E2E,
      liveE2e: process.env.FINAGENT_LIVE_E2E,
    })) {
      throw createCodeError('BUSINESS_RESEARCH_LIVE_E2E_DISABLED', 'Live acceptance operations are disabled.');
    }
    try {
      const profilePath = app.getPath('userData');
      if (!isAbsolute(profilePath)) throw new Error('Profile path is not absolute.');
      const profile = realpathSync(profilePath);
      const repository = realpathSync(process.cwd());
      if (!profile.startsWith(`${repository}/`) && !profile.startsWith(`${repository}\\`)) {
        throw new Error('Live acceptance requires an isolated in-repository userData profile.');
      }
    } catch {
      throw createCodeError('BUSINESS_RESEARCH_LIVE_E2E_PROFILE_INVALID', 'Live acceptance requires an isolated in-repository userData profile.');
    }
  }

  getLlmState(): Promise<LlmRuntimeState> {
    return this.readLlmState();
  }

  async listModels(): Promise<LlmModel[]> {
    return this.requirePiRpc().getAvailableModels();
  }

  async setModel(input: unknown): Promise<LlmRuntimeState> {
    const request = requireObject(input);
    const provider = requireString(request.provider, 'provider');
    const modelId = requireString(request.modelId, 'modelId');
    const model = await this.requirePiRpc().setModel(provider, modelId);
    if (model.provider !== provider || model.id !== modelId) {
      throw createCodeError('PI_RUNTIME_ERROR', `Pi did not switch to ${provider}/${modelId}.`);
    }
    return this.readLlmState();
  }

  async listThinkingLevels(): Promise<string[]> {
    const state = await this.requirePiRpc().getState();
    return thinkingLevels(state.model?.thinkingLevelMap);
  }

  async setThinkingLevel(input: unknown): Promise<LlmRuntimeState> {
    const request = requireObject(input);
    await this.requirePiRpc().setThinkingLevel(requireString(request.level, 'level'));
    return this.readLlmState();
  }

  async getProviders(): Promise<ProviderStatus[]> {
    let models: LlmModel[] = [];
    let runtimeError: string | undefined;
    try {
      models = await this.listModels();
    } catch (error) {
      runtimeError = error instanceof Error ? error.message : String(error);
    }
    const credentialInfos = await this.credentials.listCredentials();
    const modelsByProvider = new Map<string, LlmModel[]>();
    for (const model of models) {
      const providerModels = modelsByProvider.get(model.provider) ?? [];
      providerModels.push(model);
      modelsByProvider.set(model.provider, providerModels);
    }
    const statuses: ProviderStatus[] = [...modelsByProvider].map(([provider, providerModels]) => {
      const configured = credentialInfos.some((info) => info.provider === provider && info.configured);
      return {
        provider,
        displayName: provider,
        status: configured ? 'connected' : 'missing_credential',
        modelCount: providerModels.length,
        ...(configured ? {} : { message: 'No API key stored. Add one in Settings → Models.' }),
      };
    });
    for (const info of credentialInfos) {
      if (info.custom || modelsByProvider.has(info.provider)) continue;
      statuses.push({ provider: info.provider, displayName: info.provider, status: 'missing_credential', message: 'Provider is configured but not present in the runtime registry.' });
    }
    if (runtimeError) statuses.push({ provider: 'runtime', displayName: 'Pi Runtime', status: 'runtime_error', message: redactSecrets(runtimeError) });
    return statuses;
  }

  listCredentials(): Promise<CredentialInfo[]> {
    return this.credentials.listCredentials();
  }

  async setCredential(input: unknown): Promise<void> {
    const request = requireObject(input);
    await this.credentials.setCredential(requireString(request.provider, 'provider'), requireString(request.apiKey, 'apiKey'));
    await this.requirePiRpc().restart();
  }

  async removeCredential(input: unknown): Promise<void> {
    const request = requireObject(input);
    await this.credentials.removeCredential(requireString(request.provider, 'provider'));
    await this.requirePiRpc().restart();
  }

  async setCustomProvider(input: unknown): Promise<void> {
    const request = requireObject(input) as unknown as CustomProviderConfig;
    const config: CustomProviderConfig = {
      name: requireString(request.name, 'name'),
      displayName: requireString(request.displayName, 'displayName'),
      baseUrl: requireString(request.baseUrl, 'baseUrl'),
      api: typeof request.api === 'string' ? request.api : 'openai-completions',
      apiKey: typeof request.apiKey === 'string' ? request.apiKey : undefined,
      models: Array.isArray(request.models) ? request.models : [],
    };
    if (config.models.length === 0) throw createCodeError('INVALID_ARGUMENT', 'A custom provider needs at least one model.');
    await this.credentials.setCustomProvider(config);
    await this.requirePiRpc().restart();
  }

  async removeCustomProvider(input: unknown): Promise<void> {
    const request = requireObject(input);
    await this.credentials.removeCustomProvider(requireString(request.name, 'name'));
    await this.requirePiRpc().restart();
  }

  async testProvider(input: unknown): Promise<LlmTestResult> {
    const request = requireObject(input);
    const provider = requireString(request.provider, 'provider');
    const modelId = requireString(request.modelId, 'modelId');
    const rpc = this.requirePiRpc();
    const startedAt = Date.now();
    let previousSessionFile: string | undefined;
    const testSessionFile = join(app.getPath('userData'), 'business-research-pi-sessions', `llm-test-${randomUUID().slice(0, 8)}.jsonl`);
    try {
      previousSessionFile = (await rpc.getState()).sessionFile;
      await rpc.switchSession(testSessionFile);
      const model = await rpc.setModel(provider, modelId);
      if (!model || model.provider !== provider || model.id !== modelId) {
        throw createCodeError('PI_RUNTIME_ERROR', `Model ${provider}/${modelId} is not available.`);
      }
      const answer = (await rpc.prompt('Reply with the single word OK.')).answer.trim();
      return { ok: answer.length > 0, message: answer.length > 0 ? 'Connection verified.' : 'The model returned an empty answer.', provider, modelId, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return { ok: false, message: redactSecrets(error instanceof Error ? error.message : 'Connection test failed.'), provider, modelId, latencyMs: Date.now() - startedAt };
    } finally {
      await unlink(testSessionFile).catch(() => undefined);
      if (previousSessionFile) await rpc.switchSession(previousSessionFile).catch(() => undefined);
    }
  }

  async collectDiagnostics(): Promise<DiagnosticsBundle> {
    let llmState: LlmRuntimeState | null = null;
    try {
      llmState = await this.readLlmState();
    } catch {
      // Diagnostics remain useful before Pi is configured or installed.
    }
    const pi = this.readPiDiagnostics(llmState);
    return collectDiagnostics({
      version: app.getVersion(),
      os: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron ?? null,
      agentProviderId: this.provider,
      agentState: this.businessResearchPiRpc?.isRuntimeAlive() ? 'running' : 'idle',
      llmProviderId: llmState?.model?.provider ?? null,
      llmModel: llmState?.model?.id ?? null,
      capabilities: [
        'business-research.projects',
        'business-research.runs',
        'business-research.evidence',
        'business-research.reports',
        'business-research.monitors',
      ],
      resources: { dev: !app.isPackaged, root: getRuntimeRoot() },
      pi,
      errors: mainErrorLog.recent(20),
    });
  }

  async restartRuntime(): Promise<void> {
    await this.businessResearchPiRpc?.restart();
  }

  async getAppPreferences(): Promise<AppPreferencesSnapshot> {
    return this.appPreferences.get();
  }

  async updateAppPreferences(input: unknown): Promise<AppPreferencesSnapshot> {
    const request = requireObject(input);
    if (!isLocalePreference(request.locale)) throw createCodeError('INVALID_ARGUMENT', 'Invalid locale preference.');
    return this.appPreferences.update(request.locale);
  }

  private async readLlmState(): Promise<LlmRuntimeState> {
    const state = await this.requirePiRpc().getState();
    return {
      runtimeProvider: 'pi-runtime',
      ...(state.model === undefined ? {} : { model: state.model }),
      thinkingLevel: state.thinkingLevel ?? 'off',
      availableThinkingLevels: thinkingLevels(state.model?.thinkingLevelMap),
      isStreaming: state.isStreaming ?? false,
      ...(state.sessionId === undefined ? {} : { sessionId: state.sessionId }),
      ...(state.messageCount === undefined ? {} : { messageCount: state.messageCount }),
    };
  }

  private requirePiRpc(): PiRpcClient {
    if (!this.businessResearchPiRpc) {
      throw createCodeError('LLM_UNAVAILABLE', 'Configure the Pi model runtime to use a live research model.');
    }
    return this.businessResearchPiRpc;
  }

  private readPiDiagnostics(llmState: LlmRuntimeState | null) {
    const rpc = this.businessResearchPiRpc;
    if (!rpc) {
      return {
        status: 'idle' as const,
        command: null,
        cwd: null,
        extensions: [],
        providersConfigured: [],
        model: null,
        lastExitCode: null,
        lastExitSignal: null,
        stderrTail: null,
      };
    }
    const launch = rpc.getLaunchInfo();
    const exit = rpc.getLastExitInfo();
    const stderr = rpc.getRecentStderr();
    return {
      status: rpc.isRuntimeAlive() ? 'running' as const : exit ? 'exited' as const : 'idle' as const,
      command: `${launch.command} ${launch.args.join(' ')}`.slice(0, 400),
      cwd: launch.cwd,
      extensions: launch.extensions,
      providersConfigured: llmState?.model?.provider ? [llmState.model.provider] : [],
      model: llmState?.model?.id ?? null,
      lastExitCode: exit?.code ?? null,
      lastExitSignal: exit?.signal ?? null,
      stderrTail: stderr.length > 0 ? stderr.slice(-2000) : null,
    };
  }

  private createCredentialBackedBraveTools(): BusinessResearchToolPort {
    let tools: Promise<BusinessResearchToolPort> | undefined;
    const getTools = () => {
      tools ??= this.credentials
        .getCredential(BUSINESS_RESEARCH_BRAVE_CREDENTIAL_ID)
        .then((apiKey) => createBraveBusinessResearchTools({ apiKey: apiKey ?? '' }));
      return tools;
    };
    return {
      searchWeb: async (query, signal) => (await getTools()).searchWeb(query, signal),
      openSource: async (evidenceId, signal) => (await getTools()).openSource(evidenceId, signal),
    };
  }

  private async buildRuntimeEnv(): Promise<NodeJS.ProcessEnv> {
    const overrides: Array<Record<string, unknown>> = [];
    if (process.env.ANTHROPIC_BASE_URL) overrides.push({ provider: 'anthropic', baseUrl: process.env.ANTHROPIC_BASE_URL });
    for (const provider of await this.credentials.listCustomProviders()) {
      overrides.push({ provider: provider.name, baseUrl: provider.baseUrl, api: provider.api, apiKey: provider.apiKey, models: provider.models });
    }
    for (const info of await this.credentials.listCredentials()) {
      if (info.custom) continue;
      const apiKey = await this.credentials.getCredential(info.provider);
      if (apiKey) overrides.push({ provider: info.provider, apiKey });
    }
    return {
      ...(process.env.FINAGENT_PI_COMMAND === undefined ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      FINAGENT_PROVIDER_OVERRIDES: overrides.length > 0 ? JSON.stringify(overrides) : '',
      FINAGENT_BUSINESS_RESEARCH_ONLY: '1',
      FINAGENT_BRAVE_SEARCH_API_KEY: await this.credentials.getCredential(BUSINESS_RESEARCH_BRAVE_CREDENTIAL_ID) ?? '',
    };
  }
}

function createBusinessResearchPiArgs(sessionDirectory: string, useBundledPiRuntime: boolean): string[] {
  const entryOrPackage = useBundledPiRuntime
    ? resolveBundledPiCliEntry(app.getAppPath())
    : '@earendil-works/pi-coding-agent';
  const args = [entryOrPackage, '--mode', 'rpc', '--provider', process.env.FINAGENT_PI_PROVIDER ?? 'anthropic'];
  const model = process.env.FINAGENT_PI_MODEL ?? process.env.ANTHROPIC_MODEL;
  if (model) args.push('--model', model);
  args.push('--extension', getPiExtensionEntry(), '--session-dir', sessionDirectory);
  return args;
}

function thinkingLevels(levelMap?: Record<string, string | null>): string[] {
  if (!levelMap || Object.keys(levelMap).length === 0) return [...DEFAULT_THINKING_LEVELS];
  return ['off', ...Object.entries(levelMap).filter(([, mapping]) => mapping !== null).map(([level]) => level)];
}

function requireBusinessResearchId<Kind extends BusinessResearchIdKind>(kind: Kind, value: unknown) {
  const parsed = parseBusinessResearchId(kind, value);
  if (parsed === undefined) throw createCodeError('INVALID_ARGUMENT', `${kind} id is invalid.`);
  return parsed;
}

function requireObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw createCodeError('INVALID_ARGUMENT', 'Expected an object.');
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createCodeError('INVALID_ARGUMENT', `${field} must be a non-empty string.`);
  }
  return value.trim();
}

export { toIpcError, toIpcResult, mainErrorLog } from './ipcResult.ts';

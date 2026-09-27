import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { AgentKernelHost } from './kernelHost.ts';
import { toIpcResult } from './ipcResult.ts';
import { isBusinessResearchLiveE2eEnabled } from '../businessResearchLiveE2eMode.ts';
import { registerAboutIpc } from './about.ts';
import { writeSupportBundle } from '@finagent/shared/diagnostics';
import { loadFinagentEnv } from './loadEnv.ts';
import { getRuntimeRoot } from '@finagent/shared/resources';
import { legacyEnterpriseResearchUserDataPath } from './userDataPath.ts';
let mainWindow: BrowserWindow | null = null;
const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, '../..');
if (app.isPackaged) {
  process.env.FINAGENT_PACKAGED = '1';
}
const runtimeRoot = getRuntimeRoot();

if (process.env.FINAGENT_USER_DATA_DIR) {
  app.setPath('userData', process.env.FINAGENT_USER_DATA_DIR);
} else if (process.platform === 'win32') {
  // Keep the previous Windows profile directory so product rebranding does
  // not strand existing research projects, reports, or encrypted credentials.
  app.setPath('userData', legacyEnterpriseResearchUserDataPath(app.getPath('appData')));
}

loadFinagentEnv({
  roots: [runtimeRoot, appRoot],
});
// Only one main process may reconcile/write checkpoints in a userData profile.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {
  if (process.env.FINAGENT_E2E_HIDDEN === '1') return;
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.focus();
});
const agentKernelHost = new AgentKernelHost();
registerAboutIpc();
const isDev = !app.isPackaged;

function createWindow() {
  // Test-harness window policy (see docs/release-gates.md §Test tiers):
  //   - default (real user): window is visible
  //   - FINAGENT_E2E_HIDDEN=1 (all e2e harnesses): window never appears on
  //     screen — CDP/renderer keep working, nothing flashes on the desktop
  //   - FINAGENT_E2E_VISIBLE=1 (manual debugging): force visible
  const windowVisible =
    process.env.FINAGENT_E2E_VISIBLE === '1' || process.env.FINAGENT_E2E_HIDDEN !== '1';
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hidden',
    show: windowVisible,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Load the app
  if (isDev && process.env.FINAGENT_FORCE_PROD_LOAD !== '1') {
    mainWindow.loadURL('http://localhost:5173');
    if (process.env.FINAGENT_OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  void agentKernelHost.dispose();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers for window controls
ipcMain.handle('window:minimize', () => mainWindow?.minimize());

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window:close', () => mainWindow?.close());

ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized());

// Business research is exposed as validated lifecycle/report/monitor operations only.
ipcMain.handle('businessResearch:createProject', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.businessResearchCreateProject(input))
);
ipcMain.handle('businessResearch:listProjects', async () =>
  toIpcResult(() => agentKernelHost.businessResearchListProjects())
);
ipcMain.handle('businessResearch:getCredentialStatus', async () =>
  toIpcResult(() => agentKernelHost.businessResearchCredentialStatus())
);
ipcMain.handle('businessResearch:setBraveKey', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.businessResearchSetBraveKey(input))
);
ipcMain.handle('businessResearch:removeBraveKey', async () =>
  toIpcResult(() => agentKernelHost.businessResearchRemoveBraveKey())
);
ipcMain.handle('businessResearch:start', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.businessResearchStart(input))
);
ipcMain.handle('businessResearch:cancel', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.businessResearchCancel(input))
);
ipcMain.handle('businessResearch:listRuns', async () =>
  toIpcResult(() => agentKernelHost.businessResearchListRuns())
);
ipcMain.handle('businessResearch:getRun', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.businessResearchGetRun(input))
);
ipcMain.handle('businessResearch:listEvents', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.businessResearchListEvents(input))
);
ipcMain.handle('businessResearch:listReports', async () =>
  toIpcResult(() => agentKernelHost.businessResearchListReports())
);
ipcMain.handle('businessResearch:getReport', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.businessResearchGetReport(input))
);
ipcMain.handle('businessResearch:evaluate', async () =>
  toIpcResult(() => agentKernelHost.businessResearchEvaluate())
);
ipcMain.handle('businessResearch:subscribe', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.businessResearchSubscribe(input))
);
ipcMain.handle('businessResearch:unsubscribe', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.businessResearchUnsubscribe(input))
);
ipcMain.handle('businessResearch:resumeSubscription', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.businessResearchResumeSubscription(input))
);
ipcMain.handle('businessResearch:removeSubscription', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.businessResearchRemoveSubscription(input))
);
ipcMain.handle('businessResearch:listSubscriptions', async () =>
  toIpcResult(() => agentKernelHost.businessResearchListSubscriptions())
);
ipcMain.handle('businessResearch:listChecks', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.businessResearchListChecks(input))
);
ipcMain.handle('businessResearch:checkDue', async () =>
  toIpcResult(() => agentKernelHost.businessResearchCheckDue())
);

if (isBusinessResearchLiveE2eEnabled({
  isPackaged: app.isPackaged,
  e2e: process.env.FINAGENT_E2E,
  liveE2e: process.env.FINAGENT_LIVE_E2E,
})) {
  ipcMain.handle('businessResearch:e2e:counterfactualProbes', async (_event, input: unknown) =>
    toIpcResult(() => agentKernelHost.businessResearchRunLiveCounterfactualProbes(input))
  );
  ipcMain.handle('businessResearch:e2e:checkSubscriptionNow', async (_event, input: unknown) =>
    toIpcResult(() => agentKernelHost.businessResearchCheckSubscriptionNow(input))
  );
}

// LLM control plane
ipcMain.handle('llm:getState', async () =>
  toIpcResult(() => agentKernelHost.getLlmState())
);

ipcMain.handle('llm:listModels', async () =>
  toIpcResult(() => agentKernelHost.listModels())
);

ipcMain.handle('llm:setModel', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.setModel(input))
);

ipcMain.handle('llm:listThinkingLevels', async () =>
  toIpcResult(() => agentKernelHost.listThinkingLevels())
);

ipcMain.handle('llm:setThinkingLevel', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.setThinkingLevel(input))
);

ipcMain.handle('llm:getProviders', async () =>
  toIpcResult(() => agentKernelHost.getProviders())
);

ipcMain.handle('llm:listCredentials', async () =>
  toIpcResult(() => agentKernelHost.listCredentials())
);

ipcMain.handle('llm:setCredential', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.setCredential(input))
);

ipcMain.handle('llm:removeCredential', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.removeCredential(input))
);

ipcMain.handle('llm:setCustomProvider', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.setCustomProvider(input))
);

ipcMain.handle('llm:removeCustomProvider', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.removeCustomProvider(input))
);

ipcMain.handle('llm:testProvider', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.testProvider(input))
);

// Diagnostics (spec §35–36)
ipcMain.handle('diagnostics:collect', async () =>
  toIpcResult(() => agentKernelHost.collectDiagnostics())
);

ipcMain.handle('runtime:restart', async () =>
  toIpcResult(() => agentKernelHost.restartRuntime())
);

ipcMain.handle('diagnostics:export', async () =>
  toIpcResult(async () => {
    const bundle = await agentKernelHost.collectDiagnostics();
    const result = await dialog.showSaveDialog({
      title: 'Export Enterprise Research Workbench diagnostics',
      defaultPath: join(app.getPath('documents'), `market-intelligence-diagnostics-${Date.now()}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await writeSupportBundle(bundle, result.filePath);
    return { canceled: false, filePath: result.filePath };
  })
);

// V8: app preferences (locale) — main-owned so the renderer, agent runtime,
// notifications, and dialogs share one effective locale (spec §14–16).
ipcMain.handle('appPreferences:get', async () =>
  toIpcResult(() => agentKernelHost.getAppPreferences())
);

ipcMain.handle('appPreferences:update', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.updateAppPreferences(input))
);

// Controlled external open (spec §10): http/https only, never a shell.
ipcMain.handle('openExternal', async (_event, url: unknown) =>
  toIpcResult(async () => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error('Only http(s) URLs may be opened');
    }
    await shell.openExternal(url);
  })
);

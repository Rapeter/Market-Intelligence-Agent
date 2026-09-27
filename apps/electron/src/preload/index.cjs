var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;

// src/preload/index.ts
var exports_preload = {};
module.exports = __toCommonJS(exports_preload);
var import_electron = require("electron");

// src/preload/businessResearchBridge.ts
function createBusinessResearchBridge(invoke) {
  return {
    createProject: (input) => invoke("businessResearch:createProject", input),
    listProjects: () => invoke("businessResearch:listProjects"),
    getCredentialStatus: () => invoke("businessResearch:getCredentialStatus"),
    setBraveKey: (input) => invoke("businessResearch:setBraveKey", input),
    removeBraveKey: () => invoke("businessResearch:removeBraveKey"),
    start: (input) => invoke("businessResearch:start", input),
    cancel: (input) => invoke("businessResearch:cancel", input),
    listRuns: () => invoke("businessResearch:listRuns"),
    getRun: (input) => invoke("businessResearch:getRun", input),
    listEvents: (input) => invoke("businessResearch:listEvents", input),
    listReports: () => invoke("businessResearch:listReports"),
    getReport: (input) => invoke("businessResearch:getReport", input),
    evaluate: () => invoke("businessResearch:evaluate"),
    subscribe: (input) => invoke("businessResearch:subscribe", input),
    unsubscribe: (input) => invoke("businessResearch:unsubscribe", input),
    resumeSubscription: (input) => invoke("businessResearch:resumeSubscription", input),
    removeSubscription: (input) => invoke("businessResearch:removeSubscription", input),
    listSubscriptions: () => invoke("businessResearch:listSubscriptions"),
    listChecks: (input) => invoke("businessResearch:listChecks", input),
    checkDue: () => invoke("businessResearch:checkDue")
  };
}

// src/preload/businessResearchLiveE2eBridge.ts
function createBusinessResearchLiveE2eBridge(invoke, enabled) {
  if (!enabled)
    return;
  return {
    runCounterfactualProbes: (input) => invoke("businessResearch:e2e:counterfactualProbes", input),
    checkSubscriptionNow: (input) => invoke("businessResearch:e2e:checkSubscriptionNow", input)
  };
}

// src/businessResearchLiveE2eMode.ts
function isBusinessResearchLiveE2eEnabled(config) {
  return !config.isPackaged && config.e2e === "1" && config.liveE2e === "1";
}

// src/preload/index.ts
var invoke = (channel, ...args) => import_electron.ipcRenderer.invoke(channel, ...args);
var electronAPI = {
  window: {
    minimize: () => invoke("window:minimize"),
    maximize: () => invoke("window:maximize"),
    close: () => invoke("window:close"),
    isMaximized: () => invoke("window:isMaximized")
  },
  businessResearch: createBusinessResearchBridge(invoke),
  businessResearchLiveE2e: createBusinessResearchLiveE2eBridge((channel, input) => invoke(channel, input), isBusinessResearchLiveE2eEnabled({
    isPackaged: process.env.FINAGENT_PACKAGED === "1",
    e2e: process.env.FINAGENT_E2E,
    liveE2e: process.env.FINAGENT_LIVE_E2E
  })),
  llm: {
    getState: () => invoke("llm:getState"),
    listModels: () => invoke("llm:listModels"),
    setModel: (input) => invoke("llm:setModel", input),
    listThinkingLevels: () => invoke("llm:listThinkingLevels"),
    setThinkingLevel: (input) => invoke("llm:setThinkingLevel", input),
    getProviders: () => invoke("llm:getProviders"),
    listCredentials: () => invoke("llm:listCredentials"),
    setCredential: (input) => invoke("llm:setCredential", input),
    removeCredential: (input) => invoke("llm:removeCredential", input),
    setCustomProvider: (input) => invoke("llm:setCustomProvider", input),
    removeCustomProvider: (input) => invoke("llm:removeCustomProvider", input),
    testProvider: (input) => invoke("llm:testProvider", input)
  },
  about: { get: () => invoke("app:about") },
  diagnostics: {
    collect: () => invoke("diagnostics:collect"),
    export: () => invoke("diagnostics:export"),
    restartRuntime: () => invoke("runtime:restart")
  },
  appPreferences: {
    get: () => invoke("appPreferences:get"),
    update: (input) => invoke("appPreferences:update", input)
  },
  openExternal: (url) => invoke("openExternal", url)
};
import_electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);

import { registerProviderOverrides, registerTools } from '../../../packages/pi-extension/src/index.ts';
import {
  registerBusinessResearchPromptGuard,
  registerBusinessResearchTools,
} from './businessResearchTools.ts';

export default function finagentExtension(pi: Parameters<typeof registerTools>[0]) {
  registerProviderOverrides(pi);
  if (process.env.FINAGENT_BUSINESS_RESEARCH_ONLY === '1') {
    registerBusinessResearchTools(pi);
    registerBusinessResearchPromptGuard(pi);
    return;
  }
  registerTools(pi);
}

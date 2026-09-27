import { registerProviderOverrides } from '../../../packages/pi-extension/src/index.ts';
import {
  registerBusinessResearchPromptGuard,
  registerBusinessResearchTools,
} from './businessResearchTools.ts';

export default function finagentExtension(pi: Parameters<typeof registerBusinessResearchTools>[0]) {
  registerProviderOverrides(pi);
  registerBusinessResearchTools(pi);
  registerBusinessResearchPromptGuard(pi);
}

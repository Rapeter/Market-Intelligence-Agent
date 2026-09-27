import type { NamespaceResource } from '../keys.ts';

export const agent = {
  model: { label: 'Model', loading: 'Loading models…', select: 'Select model', none: 'No models available' },
  reasoning: {
    label: 'Reasoning',
    withLevel: 'Reasoning: {{level}}',
    unavailable: 'Reasoning levels are unavailable in this runtime',
  },
} satisfies NamespaceResource;

import type { SameKeysAs } from '../keys.ts';
import type { agent as enAgent } from '../en-US/agent.ts';

export const agent = {
  model: { label: '模型', loading: '正在加载模型…', select: '选择模型', none: '没有可用模型' },
  reasoning: {
    label: '推理',
    withLevel: '推理：{{level}}',
    unavailable: '当前运行时不支持推理等级',
  },
} satisfies SameKeysAs<typeof enAgent>;

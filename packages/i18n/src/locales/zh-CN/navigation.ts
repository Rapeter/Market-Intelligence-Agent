import type { SameKeysAs } from '../keys.ts';
import type { navigation as enNavigation } from '../en-US/navigation.ts';

export const navigation = {
  settings: '设置',
  agentPanel: '研究 Agent',
  aboutAria: '关于企业经营研究工作台',
  aboutTitle: '关于企业经营研究工作台',
  minimizeWindow: '最小化窗口',
  maximizeWindow: '最大化窗口',
  restoreWindow: '还原窗口',
  closeWindow: '关闭窗口',
} satisfies SameKeysAs<typeof enNavigation>;

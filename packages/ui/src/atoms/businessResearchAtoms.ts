import { atom } from 'jotai';
import type {
  BusinessResearchProject,
  BusinessResearchProjectId,
  BusinessResearchRunMode,
  BusinessResearchStrategyId,
} from '@finagent/core';
import type {
  BusinessResearchCheckRecord,
  BusinessResearchEvent,
  BusinessResearchEvaluationMetrics,
  BusinessResearchReport,
  BusinessResearchRunRecord,
  BusinessResearchSubscriptionRecord,
} from '@finagent/shared/business-research';

export interface BusinessResearchFormState {
  question: string;
  strategyId: BusinessResearchStrategyId;
}

export const businessResearchFormAtom = atom<BusinessResearchFormState>({
  question: '',
  strategyId: 'industry_overview',
});

/** The workspace opens in network-free demonstration mode; live search is explicit. */
export const businessResearchModeAtom = atom<BusinessResearchRunMode>('fixture');
export const businessResearchProjectsAtom = atom<BusinessResearchProject[]>([]);
export const selectedBusinessResearchProjectIdAtom = atom<BusinessResearchProjectId | null>(null);
export const selectedBusinessResearchProjectAtom = atom((get) => {
  const selectedId = get(selectedBusinessResearchProjectIdAtom);
  return selectedId === null ? undefined : get(businessResearchProjectsAtom).find((project) => project.id === selectedId);
});
export const businessResearchRunsAtom = atom<BusinessResearchRunRecord[]>([]);
export const businessResearchReportsAtom = atom<BusinessResearchReport[]>([]);
export const businessResearchEventsAtom = atom<BusinessResearchEvent[]>([]);
export const businessResearchSubscriptionsAtom = atom<BusinessResearchSubscriptionRecord[]>([]);
export const businessResearchChecksAtom = atom<Record<string, BusinessResearchCheckRecord[]>>({});
export const businessResearchMetricsAtom = atom<BusinessResearchEvaluationMetrics | null>(null);

export const selectedBusinessResearchRunIdAtom = atom<BusinessResearchRunRecord['id'] | null>(null);
export const selectedBusinessResearchReportIdAtom = atom<BusinessResearchReport['id'] | null>(null);
export const selectedBusinessResearchSubscriptionIdAtom = atom<BusinessResearchSubscriptionRecord['id'] | null>(null);

export const selectedBusinessResearchRunAtom = atom((get) => {
  const selectedId = get(selectedBusinessResearchRunIdAtom);
  return selectedId === null
    ? undefined
    : get(businessResearchRunsAtom).find((run) => run.id === selectedId);
});

export const selectedBusinessResearchReportAtom = atom((get) => {
  const selectedId = get(selectedBusinessResearchReportIdAtom);
  return selectedId === null
    ? undefined
    : get(businessResearchReportsAtom).find((report) => report.id === selectedId);
});

export const selectedBusinessResearchSubscriptionAtom = atom((get) => {
  const selectedId = get(selectedBusinessResearchSubscriptionIdAtom);
  return selectedId === null
    ? undefined
    : get(businessResearchSubscriptionsAtom).find((item) => item.id === selectedId);
});

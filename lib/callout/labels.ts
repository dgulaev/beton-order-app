export const CALLOUT_STATUSES = [
  'new',
  'in_progress',
  'called',
  'rejected',
  'converted',
] as const;

export type CalloutStatus = (typeof CALLOUT_STATUSES)[number];

export const CALLOUT_STATUS_LABEL: Record<CalloutStatus, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  called: 'Прозвонен',
  rejected: 'Отказ',
  converted: 'В клиенты',
};

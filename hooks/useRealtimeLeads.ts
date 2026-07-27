'use client';

import { useRealtimeBroadcast } from '@/hooks/useRealtimeBroadcast';
import type { Lead, LeadStatus } from '@/lib/leads';

export function useRealtimeLeads(
  setLeads: React.Dispatch<React.SetStateAction<Lead[]>>,
  options?: {
    enabled?: boolean;
    /** Если задано — в списке остаются только эти статусы (inbox на mobile) */
    statusFilter?: LeadStatus[];
  },
) {
  const allowed = options?.statusFilter;

  return useRealtimeBroadcast({
    topic: 'leads:all',
    enabled: options?.enabled,
    onInsert: (record) => {
      const lead = record as Lead;
      if (allowed && !allowed.includes(lead.status)) return;
      setLeads((prev) => {
        if (prev.some((l) => l.id === lead.id)) return prev;
        return [lead, ...prev];
      });
    },
    onUpdate: (record) => {
      const lead = record as Lead;
      setLeads((prev) => {
        if (allowed && !allowed.includes(lead.status)) {
          return prev.filter((l) => l.id !== lead.id);
        }
        if (prev.some((l) => l.id === lead.id)) {
          return prev.map((l) => (l.id === lead.id ? ({ ...l, ...lead } as Lead) : l));
        }
        if (!allowed || allowed.includes(lead.status)) {
          return [lead, ...prev];
        }
        return prev;
      });
    },
    onDelete: (old) => {
      setLeads((prev) => prev.filter((l) => l.id !== old?.id));
    },
  });
}

export function useLeadChangeNotifications(options: {
  enabled?: boolean;
  onNewLead?: (lead: Lead) => void;
}) {
  return useRealtimeBroadcast({
    topic: 'leads:all',
    enabled: options?.enabled,
    onInsert: (record) => {
      const lead = record as Lead;
      if (lead.status === 'spam') return;
      options.onNewLead?.(lead);
    },
  });
}

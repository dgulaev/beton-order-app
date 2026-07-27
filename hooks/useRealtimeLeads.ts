'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useRealtimeBroadcast } from '@/hooks/useRealtimeBroadcast';
import type { Lead, LeadStatus } from '@/lib/leads';

function matchesLeadFilters(
  lead: Lead,
  options?: { statusFilter?: LeadStatus[]; sourceFilter?: string },
): boolean {
  if (options?.statusFilter && !options.statusFilter.includes(lead.status)) return false;
  if (options?.sourceFilter && lead.source !== options.sourceFilter) return false;
  return true;
}

export function useRealtimeLeads(
  setLeads: Dispatch<SetStateAction<Lead[]>>,
  options?: {
    enabled?: boolean;
    /** Если задано — в списке остаются только эти статусы */
    statusFilter?: LeadStatus[];
    /** Если задано — только этот source */
    sourceFilter?: string;
  },
) {
  return useRealtimeBroadcast({
    topic: 'leads:all',
    enabled: options?.enabled,
    onInsert: (record) => {
      const lead = record as Lead;
      if (!matchesLeadFilters(lead, options)) return;
      setLeads((prev) => {
        if (prev.some((l) => l.id === lead.id)) return prev;
        return [lead, ...prev];
      });
    },
    onUpdate: (record) => {
      const lead = record as Lead;
      setLeads((prev) => {
        if (!matchesLeadFilters(lead, options)) {
          return prev.filter((l) => l.id !== lead.id);
        }
        if (prev.some((l) => l.id === lead.id)) {
          return prev.map((l) => (l.id === lead.id ? ({ ...l, ...lead } as Lead) : l));
        }
        return [lead, ...prev];
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

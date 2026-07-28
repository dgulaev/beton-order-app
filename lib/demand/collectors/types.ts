export type DemandDraft = {
  source: string;
  external_id?: string | null;
  external_url?: string | null;
  title: string;
  body?: string | null;
  region?: string | null;
  published_at?: string | null;
  volume_m3?: number | null;
  grades?: string[] | null;
  delivery_needed?: boolean | null;
  buyer_type?: string | null;
  raw_payload?: Record<string, unknown> | null;
  /** Всегда слать notifyManagers при создании (например входящее Авито). */
  force_notify?: boolean;
};

export interface DemandCollector {
  readonly source: string;
  collect(): Promise<DemandDraft[]>;
}

export type ParsedTenderFields = {
  platform?: string | null;
  purchase_number?: string | null;
  law?: string | null;
  nmck?: string | null;
  organization_name?: string | null;
  inn?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  grade?: string | null;
  volume_m3?: number | null;
  city?: string | null;
  address?: string | null;
  /** Окончание подачи заявок (ЕИС/ЭТП), не дата поставки. */
  deadline?: string | null;
  desired_date?: string | null;
  etp_url?: string | null;
  docs_url?: string | null;
  comment?: string | null;
  title?: string | null;
};

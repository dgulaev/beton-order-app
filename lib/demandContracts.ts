/** Клиентские константы документов спроса — без supabaseAdmin. */

export {
  LEAD_CONTRACT_ACCEPT as DEMAND_CONTRACT_ACCEPT,
  LEAD_CONTRACT_MAX_BYTES as DEMAND_CONTRACT_MAX_BYTES,
  isAllowedContractFile,
} from '@/lib/leadContracts';

export const DEMAND_CONTRACTS_BUCKET = 'demand-contracts';

export type DemandContract = {
  id: number;
  demand_id: number;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  created_at: string;
};

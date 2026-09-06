import { apiGet, type BackendResponse, extractData } from './client';

export interface PendingActionItem {
  id: string;
  action_type: 'pending_sign' | 'pending_broadcast' | 'pending_deploy';
  chain_type: string;
  network_name: string;
  is_testnet: boolean;
  status: string;
  wallet_id: string;
  wallet_name: string;
  to_address: string | null;
  amount: string | null;
  token_symbol: string | null;
  token_decimals: number | null;
  threshold: number | null;
  signature_count: number | null;
  predicted_address: string | null;
  created_at: string;
}

export interface PendingActionsResponse {
  items: PendingActionItem[];
  total: number;
}

export async function getPendingActions(): Promise<PendingActionsResponse> {
  const response = await apiGet<BackendResponse<PendingActionsResponse>>(
    '/pending-actions'
  );
  return extractData(response);
}

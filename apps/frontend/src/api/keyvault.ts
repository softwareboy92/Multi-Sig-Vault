import { apiPost, type BackendResponse, extractData } from "./client";

export interface KeyVaultProtocolRequest {
  chain_type: "EVM" | "BTC";
  chain_net_type: string;
  evm_chain_id?: number;
  chain_type_value?: string;
}

export interface KeyVaultProtocolResponse {
  payload_json: string;
  challenge: string;
  expires_at: string;
}

export interface KeyVaultSigningPayloadResponse {
  payload_json: string;
  signer_id: string;
}

export async function getKeyvaultProtocol(
  data: KeyVaultProtocolRequest,
): Promise<KeyVaultProtocolResponse> {
  const response = await apiPost<BackendResponse<KeyVaultProtocolResponse>>(
    "/signers/keyvault/protocol",
    data,
  );
  return extractData(response);
}

export async function getKeyvaultSigningPayload(
  transactionId: string,
  signerId: string,
): Promise<KeyVaultSigningPayloadResponse> {
  const response = await apiPost<
    BackendResponse<KeyVaultSigningPayloadResponse>
  >(
    `/transactions/${transactionId}/keyvault/signing-payload?signer_id=${signerId}`,
    {},
  );
  return extractData(response);
}

import { apiGet, apiPost, apiPut, extractData } from './client';
import type {
  SimulationConfig,
  SimulationConfigUpdate,
  SimulationResult,
} from '@/types';

/**
 * Check if Tenderly simulation is configured on the backend.
 */
export async function getSimulationConfig(): Promise<SimulationConfig> {
  const response = await apiGet<{ success: boolean; data: SimulationConfig }>(
    '/simulation/config',
  );
  return extractData(response);
}

export async function updateSimulationConfig(
  data: SimulationConfigUpdate,
): Promise<SimulationConfig> {
  const response = await apiPut<
    { success: boolean; data: SimulationConfig },
    SimulationConfigUpdate
  >('/simulation/config', data);
  return extractData(response);
}

/**
 * Trigger simulation for an EVM Safe transaction.
 * Returns the simulation result (persisted to DB).
 */
export async function simulateTransaction(
  transactionId: string,
): Promise<SimulationResult> {
  const response = await apiPost<{ success: boolean; data: SimulationResult }>(
    `/simulation/transactions/${transactionId}/simulate`,
  );
  return extractData(response);
}

/**
 * Get existing simulation result for a transaction.
 * Returns null if no simulation has been run yet.
 */
export async function getSimulation(
  transactionId: string,
): Promise<SimulationResult | null> {
  const response = await apiGet<{
    success: boolean;
    data: SimulationResult | null;
  }>(`/simulation/transactions/${transactionId}/simulation`);
  return extractData(response);
}

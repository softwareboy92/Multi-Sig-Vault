import { useCallback, useEffect, useState } from 'react';

import {
  getSimulation,
  getSimulationConfig,
  simulateTransaction,
} from '@/api/simulation';
import type { SimulationResult } from '@/types';

export type SimulationState =
  | 'not_configured'
  | 'idle'
  | 'loading'
  | 'success'
  | 'error';

interface UseSimulationReturn {
  /** Current state of the simulation section. */
  state: SimulationState;
  /** Simulation result (when state === 'success'). */
  simulation: SimulationResult | null;
  /** Error message (when state === 'error'). */
  error: string | null;
  /** Trigger a new simulation. */
  simulate: () => Promise<void>;
}

/**
 * Manages simulation state for an EVM transaction.
 *
 * On mount: checks Tenderly config + loads existing simulation result.
 * Exposes `simulate()` to trigger new simulation.
 */
export function useSimulation(
  transactionId: string | undefined,
  chainType: string | undefined,
): UseSimulationReturn {
  const [state, setState] = useState<SimulationState>('idle');
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // On mount / param change: reset state, check config and load existing result
  useEffect(() => {
    setState('idle');
    setSimulation(null);
    setError(null);

    if (!transactionId || chainType !== 'EVM') {
      return;
    }

    let cancelled = false;

    const init = async () => {
      try {
        // Check if Tenderly is configured
        const config = await getSimulationConfig();
        if (cancelled) return;

        if (!config.configured) {
          setState('not_configured');
          return;
        }

        // Load existing simulation result
        const existing = await getSimulation(transactionId);
        if (cancelled) return;

        if (existing) {
          setSimulation(existing);
          setState('success');
        } else {
          setState('idle');
        }
      } catch {
        if (!cancelled) {
          setState('idle');
        }
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [transactionId, chainType]);

  const simulate = useCallback(async () => {
    if (!transactionId) return;

    setState('loading');
    setError(null);

    try {
      const result = await simulateTransaction(transactionId);
      setSimulation(result);
      setState('success');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Simulation failed';
      setError(message);
      setState('error');
    }
  }, [transactionId]);

  return { state, simulation, error, simulate };
}

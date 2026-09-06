import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';

import { AlertBanner, Button, Card, Spinner } from '@/components/ui';
import { SimulationResultPanel } from './SimulationResultPanel';
import type { SimulationState } from '@/hooks/useSimulation';
import type { SimulationResult } from '@/types';

interface SimulationSectionProps {
  state: SimulationState;
  simulation: SimulationResult | null;
  error: string | null;
  walletAddress: string;
  onSimulate: () => void;
}

export const SimulationSection: React.FC<SimulationSectionProps> = ({
  state,
  simulation,
  error,
  walletAddress,
  onSimulate,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Card className="p-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-extrabold text-[var(--text)]">
          {t('transactions.simulationTitle')}
        </h3>
      </div>

      {/* Not configured */}
      {state === 'not_configured' && (
        <div className="space-y-3">
          <AlertBanner severity="info">
            {t('transactions.simulationNotConfigured')}
          </AlertBanner>
          <div className="flex justify-end">
            <Button
              variant="ghost"
              className="text-xs"
              onClick={() => navigate('/settings#security')}
            >
              {t('transactions.configureSimulation')}
            </Button>
          </div>
        </div>
      )}

      {/* Idle — show trigger button */}
      {state === 'idle' && (
        <div className="flex flex-col items-center gap-3 py-4">
          <p className="text-xs text-[var(--muted)]">
            {t('transactions.simulationDescription')}
          </p>
          <Button variant="default" onClick={onSimulate}>
            {t('transactions.simulateButton')}
          </Button>
        </div>
      )}

      {/* Loading */}
      {state === 'loading' && (
        <div className="flex items-center justify-center gap-2 py-6">
          <Spinner size="sm" />
          <span className="text-xs text-[var(--muted)]">
            {t('transactions.simulationSimulating')}
          </span>
        </div>
      )}

      {/* Success — show result */}
      {state === 'success' && simulation && (
        <div className="space-y-3">
          <SimulationResultPanel
            simulation={simulation}
            walletAddress={walletAddress}
          />
          <div className="flex justify-end">
            <Button variant="ghost" className="text-xs" onClick={onSimulate}>
              {t('transactions.resimulateButton')}
            </Button>
          </div>
        </div>
      )}

      {/* Error — show previous result if available, plus error banner */}
      {state === 'error' && (
        <div className="space-y-3">
          <AlertBanner severity="danger">
            {error || t('transactions.simulationError')}
          </AlertBanner>
          {simulation && (
            <SimulationResultPanel
              simulation={simulation}
              walletAddress={walletAddress}
            />
          )}
          <div className="flex justify-end">
            <Button variant="default" className="text-xs" onClick={onSimulate}>
              {t('common.retry')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};

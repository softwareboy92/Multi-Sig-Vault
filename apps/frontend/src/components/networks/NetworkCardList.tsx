import type { ReactNode } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { Card, Button } from '../ui';
import { NetworkCard } from './NetworkCard';
import type { NetworkConfig } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NetworkCardListProps {
  networks: NetworkConfig[];
  selectedNetworkId: string | null;
  loading: boolean;
  onSelect: (networkId: string) => void;
  onDelete?: (networkId: string) => void;
  onEdit?: (network: NetworkConfig) => void;

  /** Whether to show the "Add Network" button (EVM: true, BTC: false). */
  allowCreate?: boolean;
  onCreateClick?: () => void;

  /** Optional subtitle text below the panel header (e.g. "preConfigured" hint). */
  subtitle?: string;

  /** Render the detail line below network name in each card. */
  renderDetail: (network: NetworkConfig) => string;

  /** Optional extra content after the header (slot). */
  headerExtra?: ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NetworkCardList({
  networks,
  selectedNetworkId,
  loading,
  onSelect,
  onDelete,
  onEdit,
  allowCreate = false,
  onCreateClick,
  subtitle,
  renderDetail,
}: NetworkCardListProps) {
  const { t } = useTranslation();

  return (
    <Card className="!p-0 overflow-hidden">
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <div>
          <h2 className="title-h3">{t('networks.networks')}</h2>
          {subtitle && (
            <p className="text-xs text-[var(--muted)] mt-1">{subtitle}</p>
          )}
        </div>
        {allowCreate && onCreateClick && (
          <Button variant="primary" onClick={onCreateClick} className="text-sm">
            {t('networks.addNetwork')}
          </Button>
        )}
      </div>

      {/* List */}
      <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
        {loading ? (
          <div className="p-8 text-center text-[var(--muted)]">{t('common.loading')}</div>
        ) : networks.length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)]">
            {t('networks.noNetworks')}
          </div>
        ) : (
          networks.map((network) => (
            <NetworkCard
              key={network.id}
              network={network}
              isSelected={selectedNetworkId === network.id}
              onSelect={() => onSelect(network.id)}
              onDelete={onDelete ? () => onDelete(network.id) : undefined}
              onEdit={onEdit ? () => onEdit(network) : undefined}
              detail={renderDetail(network)}
            />
          ))
        )}
      </div>
    </Card>
  );
}

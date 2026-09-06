import type { NetworkConfig } from '../../types';
import { useTranslation } from '../../hooks/useTranslation';
import { Badge } from '../ui';

export interface NetworkCardProps {
  network: NetworkConfig;
  isSelected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  /** Extra detail line displayed below the name (e.g. "Chain ID: 1" or "Network: mainnet"). */
  detail?: string;
}

export function NetworkCard({ network, isSelected, onSelect, onDelete, onEdit, detail }: NetworkCardProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`p-4 cursor-pointer transition-colors border-l-4 ${
        isSelected
          ? 'bg-[var(--row-head-bg)] border-l-[var(--accent)]'
          : 'hover:bg-[var(--row-head-bg)] border-l-transparent'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-[var(--text)] mb-1">{network.name}</div>
          {detail && (
            <p className="text-xs text-[var(--muted)]">
              <code className="font-mono">{detail}</code>
            </p>
          )}
          <div className="flex items-center gap-2 mt-2">
            {network.is_testnet && (
              <Badge variant="warning">{t('networks.testnet')}</Badge>
            )}
            {!network.enabled && (
              <Badge variant="default">{t('networks.disabled')}</Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {onEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="p-1.5 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--row-head-bg)] rounded transition-colors"
              title={t('networks.edit')}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1.5 text-[var(--danger)] hover:bg-[var(--row-head-bg)] rounded transition-colors"
              title={t('networks.delete')}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import type { ReactNode } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { Card, Badge } from '../ui';
import { NodeList } from './NodeList';
import type { NetworkConfig, NodeConfig, NodeTestResponse } from '../../types';

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function EditIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function PlusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ImportIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NetworkNodeCardProps {
  network: NetworkConfig;
  nodes: NodeConfig[];
  loadingNodes: boolean;
  nodeTestResults: Record<string, NodeTestResponse>;

  // Display
  renderDetail: (network: NetworkConfig) => string;
  renderEndpoint?: (node: NodeConfig) => ReactNode;
  renderNetworkHeader?: (network: NetworkConfig) => ReactNode;
  addNodeLabel: string;

  // Network actions
  allowNetworkCrud?: boolean;
  onImportRpc?: () => void;
  onEditNetwork?: () => void;
  onDeleteNetwork?: () => void;

  // Node actions (forwarded to NodeList)
  onAddNode: () => void;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onEditNode: (node: NodeConfig) => void;
  onTestNode: (nodeId: string) => Promise<NodeTestResponse>;
  onSetDefault: (nodeId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NetworkNodeCard({
  network,
  nodes,
  loadingNodes,
  nodeTestResults,
  renderDetail,
  renderEndpoint,
  renderNetworkHeader,
  addNodeLabel,
  allowNetworkCrud = false,
  onImportRpc,
  onEditNetwork,
  onDeleteNetwork,
  onAddNode,
  onDeleteNode,
  onEditNode,
  onTestNode,
  onSetDefault,
}: NetworkNodeCardProps) {
  const { t } = useTranslation();

  return (
    <Card className="!p-0 overflow-hidden">
      {/* ── Network Header ────────────────────────────────────── */}
      <div className="group/card p-4 border-b border-[var(--border)]">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="title-h3">{network.name}</h3>
              {network.is_testnet && (
                <Badge variant="warning">{t('networks.testnet')}</Badge>
              )}
              {!network.enabled && (
                <Badge variant="default">{t('networks.disabled')}</Badge>
              )}
            </div>

            {renderNetworkHeader ? (
              renderNetworkHeader(network)
            ) : (
              <p className="text-sm text-[var(--muted)] mt-1">
                <code className="font-mono">{renderDetail(network)}</code>
              </p>
            )}
          </div>

          {/* Action buttons — hover/focus-within to reveal */}
          <div className="flex items-center gap-1 ml-2 opacity-0 group-hover/card:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity duration-150">
            {/* Import RPC */}
            {onImportRpc && (
              <button
                type="button"
                onClick={onImportRpc}
                className="p-1.5 text-[var(--accent)] hover:bg-[var(--row-head-bg)] rounded transition-colors"
                title={t('networks.importFromRegistry')}
              >
                <ImportIcon />
              </button>
            )}

            {/* Add Node */}
            <button
              type="button"
              onClick={onAddNode}
              className="p-1.5 text-[var(--accent)] hover:bg-[var(--row-head-bg)] rounded transition-colors"
              title={addNodeLabel}
            >
              <PlusIcon />
            </button>

            {onEditNetwork && (
              <button
                type="button"
                onClick={onEditNetwork}
                className="p-1.5 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--row-head-bg)] rounded transition-colors"
                title={t('networks.edit')}
              >
                <EditIcon />
              </button>
            )}
            {allowNetworkCrud && onDeleteNetwork && (
              <button
                type="button"
                onClick={onDeleteNetwork}
                className="p-1.5 text-[var(--danger)] hover:bg-[var(--row-head-bg)] rounded transition-colors"
                title={t('networks.delete')}
              >
                <TrashIcon />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Nodes Section ─────────────────────────────────────── */}
      <div className="p-4">
        {loadingNodes ? (
          <div className="text-center py-4 text-[var(--muted)]">
            {t('common.loading')}
          </div>
        ) : (
          <NodeList
            nodes={nodes}
            defaultNodeId={network.default_node_id}
            nodeTestResults={nodeTestResults}
            renderEndpoint={renderEndpoint}
            onDelete={onDeleteNode}
            onEdit={onEditNode}
            onTest={onTestNode}
            onSetDefault={onSetDefault}
          />
        )}

      </div>
    </Card>
  );
}

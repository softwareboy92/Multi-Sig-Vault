import type { ReactNode } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { Card, Button, Badge } from '../ui';
import { NodeList } from './NodeList';
import type { NetworkConfig, NodeConfig, NodeTestResponse } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NodePanelProps {
  selectedNetwork: NetworkConfig | null;
  nodes: NodeConfig[];
  loadingNodes: boolean;
  defaultNodeId?: string | null;
  nodeTestResults: Record<string, NodeTestResponse>;

  /** Label for the "Add Node" button (e.g. "Add RPC Node" vs "Add Electrum Node"). */
  addNodeLabel: string;
  /** Title for the node section when no network is selected. */
  nodeSectionTitle: string;
  /** Hint text when no network is selected. */
  selectHint: string;

  /** Custom endpoint renderer (BTC shows host:port + SSL badge). */
  renderEndpoint?: (node: NodeConfig) => ReactNode;
  /** Render network header detail (chain_id for EVM, btc_network for BTC). */
  renderNetworkHeader?: (network: NetworkConfig) => ReactNode;

  // Callbacks
  onAddNode: () => void;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onEditNode: (node: NodeConfig) => void;
  onTestNode: (nodeId: string) => Promise<NodeTestResponse>;
  onSetDefault: (nodeId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NodePanel({
  selectedNetwork,
  nodes,
  loadingNodes,
  defaultNodeId,
  nodeTestResults,
  addNodeLabel,
  nodeSectionTitle,
  selectHint,
  renderEndpoint,
  renderNetworkHeader,
  onAddNode,
  onDeleteNode,
  onEditNode,
  onTestNode,
  onSetDefault,
}: NodePanelProps) {
  const { t } = useTranslation();

  return (
    <Card className="!p-0 overflow-hidden">
      {/* Header */}
      <div className="p-4">
        {selectedNetwork ? (
          <div className="flex items-center justify-between">
            <div>
              <h2 className="title-h3">{selectedNetwork.name}</h2>
              {renderNetworkHeader ? (
                renderNetworkHeader(selectedNetwork)
              ) : (
                <p className="text-sm text-[var(--muted)] mt-1">
                  {selectedNetwork.is_testnet && (
                    <Badge variant="warning" className="mr-2">
                      {t('networks.testnet')}
                    </Badge>
                  )}
                  {!selectedNetwork.enabled && (
                    <Badge variant="default" className="mr-2">
                      {t('networks.disabled')}
                    </Badge>
                  )}
                </p>
              )}
            </div>
            <Button variant="primary" onClick={onAddNode} className="text-sm">
              {addNodeLabel}
            </Button>
          </div>
        ) : (
          <h2 className="title-h3">{nodeSectionTitle}</h2>
        )}
      </div>

      {/* Body */}
      <div className="p-4">
        {!selectedNetwork ? (
          <div className="text-center py-12 text-[var(--muted)]">
            {selectHint}
          </div>
        ) : loadingNodes ? (
          <div className="text-center py-12 text-[var(--muted)]">{t('common.loading')}</div>
        ) : (
          <NodeList
            nodes={nodes}
            defaultNodeId={defaultNodeId}
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

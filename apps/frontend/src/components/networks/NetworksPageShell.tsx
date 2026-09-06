import { type ReactNode, useEffect, useState, useCallback } from 'react';
import { useNetworkStore } from '../../stores/useNetworkStore';
import { useToastStore } from '../../stores/useToastStore';
import { useTranslation } from '../../hooks/useTranslation';
import { Breadcrumb, PageShell, Button, ConfirmDialog } from '../ui';
import { NetworkNodeCard } from './NetworkNodeCard';
import type { NetworkConfig, NodeConfig, ChainTypeNetwork } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NetworksPageShellProps {
  chainType: ChainTypeNetwork;
  title: string;

  // --- Network customization ---
  /** Whether user can create / delete / edit networks (EVM=true, BTC=false). */
  allowNetworkCrud?: boolean;
  /** Render detail text below network name inside each card. */
  renderNetworkDetail: (network: NetworkConfig) => string;

  // --- Node customization ---
  /** Label for the "Add Node" button. */
  addNodeLabel: string;
  /** Custom endpoint renderer (BTC: host:port + SSL badge). */
  renderEndpoint?: (node: NodeConfig) => ReactNode;
  /** Render custom header content for each network (chain_id / btc_network info). */
  renderNetworkHeader?: (network: NetworkConfig) => ReactNode;

  // --- Modals ---
  /** Network form modal (rendered by the page, only needed if allowNetworkCrud). */
  renderNetworkModal?: (props: {
    isOpen: boolean;
    onClose: () => void;
    editingNetwork: NetworkConfig | null;
  }) => ReactNode;

  /** Callback to open RPC import modal for a network. EVM-only. */
  onImportRpc?: (networkId: string) => void;

  /** Node form modal (rendered by the page). */
  renderNodeModal: (props: {
    isOpen: boolean;
    onClose: () => void;
    editingNode: NodeConfig | null;
    selectedNetworkId: string;
  }) => ReactNode;
}

// ---------------------------------------------------------------------------
// Component — Flat Cards layout (方案 B)
//
// Every network is rendered as an independent card with its nodes listed
// inline. No master-detail panel or selectedNetworkId state for display;
// `activeNetworkId` is only used for modal context (add/edit node).
// ---------------------------------------------------------------------------

export function NetworksPageShell({
  chainType,
  title,
  allowNetworkCrud = false,
  renderNetworkDetail,
  addNodeLabel,
  renderEndpoint,
  renderNetworkHeader,
  onImportRpc,
  renderNetworkModal,
  renderNodeModal,
}: NetworksPageShellProps) {
  const { t } = useTranslation();
  const showToast = useToastStore((s) => s.showToast);

  // --- Store ---
  const {
    networks,
    nodes,
    loadingNetworks,
    loadingNodes,
    nodeTestResults,
    fetchNetworks,
    fetchNodes,
    deleteNetwork,
    deleteNode,
    setDefaultNode,
    testNode,
  } = useNetworkStore();

  const chainNetworks = networks[chainType] ?? [];
  const isLoadingNetworks = loadingNetworks[chainType] ?? false;

  // --- Local state ---
  // Modal context — which network the node modal operates on
  const [activeNetworkId, setActiveNetworkId] = useState<string | null>(null);

  // Modal state
  const [showNetworkModal, setShowNetworkModal] = useState(false);
  const [editingNetwork, setEditingNetwork] = useState<NetworkConfig | null>(null);
  const [showNodeModal, setShowNodeModal] = useState(false);
  const [editingNode, setEditingNode] = useState<NodeConfig | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'network' | 'node';
    id: string;
    networkId: string;
    name: string;
    isLast?: boolean;
    isDefault?: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // --- Effects ---

  // Fetch all networks on mount
  useEffect(() => {
    fetchNetworks(chainType);
  }, [fetchNetworks, chainType]);

  // Fetch nodes for ALL networks in parallel when network list changes
  const networkIdKey = chainNetworks.map((n) => n.id).join(',');
  useEffect(() => {
    if (!networkIdKey) return;
    chainNetworks.forEach((n) => fetchNodes(chainType, n.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkIdKey, fetchNodes, chainType]);

  // --- Network handlers ---
  const handleRequestDeleteNetwork = useCallback(
    (networkId: string) => {
      const net = chainNetworks.find((n) => n.id === networkId);
      if (!net) return;
      setDeleteTarget({
        type: 'network',
        id: networkId,
        networkId,
        name: net.name,
      });
    },
    [chainNetworks],
  );

  const handleEditNetwork = useCallback((network: NetworkConfig) => {
    setEditingNetwork(network);
    setShowNetworkModal(true);
  }, []);

  // --- Node handlers ---
  const handleOpenCreateNode = useCallback((networkId: string) => {
    setActiveNetworkId(networkId);
    setEditingNode(null);
    setShowNodeModal(true);
  }, []);

  const handleEditNode = useCallback((networkId: string, node: NodeConfig) => {
    setActiveNetworkId(networkId);
    setEditingNode(node);
    setShowNodeModal(true);
  }, []);

  const handleRequestDeleteNode = useCallback(
    (networkId: string, nodeId: string) => {
      const networkNodes = nodes[networkId] ?? [];
      const node = networkNodes.find((n) => n.id === nodeId);
      if (!node) return;
      const network = chainNetworks.find((n) => n.id === networkId);
      setDeleteTarget({
        type: 'node',
        id: nodeId,
        networkId,
        name: node.endpoint_url,
        isLast: networkNodes.length === 1,
        isDefault: network?.default_node_id === nodeId,
      });
    },
    [nodes, chainNetworks],
  );

  // --- Confirm delete (both network and node) ---
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.type === 'network') {
        await deleteNetwork(chainType, deleteTarget.id);
        showToast(t('networks.networkDeleted'), 'success');
      } else {
        await deleteNode(deleteTarget.networkId, deleteTarget.id);

        // Auto-select highest-priority remaining node as default if we deleted the default
        if (deleteTarget.isDefault && !deleteTarget.isLast) {
          const remaining = (nodes[deleteTarget.networkId] ?? [])
            .filter((n) => n.id !== deleteTarget.id)
            .sort((a, b) => b.priority - a.priority);
          if (remaining.length > 0) {
            try {
              await setDefaultNode(chainType, deleteTarget.networkId, remaining[0].id);
              showToast(t('networks.defaultNodeAutoSwitched'), 'info');
            } catch {
              // non-critical
            }
          }
        }
      }
      setDeleteTarget(null);
    } catch (error) {
      showToast(`${t('common.deleteFailed')}: ${(error as Error).message}`, 'error');
    } finally {
      setDeleting(false);
    }
  };

  // --- Close helpers ---
  const closeNetworkModal = () => {
    setShowNetworkModal(false);
    setEditingNetwork(null);
  };

  const closeNodeModal = () => {
    setShowNodeModal(false);
    setEditingNode(null);
    setActiveNetworkId(null);
  };

  // --- Delete confirmation text ---
  const deleteTitle = deleteTarget?.type === 'network'
    ? t('networks.deleteNetwork')
    : t('networks.deleteNode');

  const deleteDesc = deleteTarget?.type === 'network'
    ? t('networks.confirmDeleteNetworkDesc')
    : deleteTarget?.isLast
      ? t('networks.confirmDeleteLastNode')
      : t('networks.confirmDeleteNode');

  return (
    <PageShell
      title={title}
      breadcrumbs={
        <Breadcrumb
          items={[
            { label: t('nav.settings'), href: '/settings' },
            { label: title },
          ]}
        />
      }
    >
      {/* Top action bar */}
      {allowNetworkCrud && (
        <div className="flex justify-end mb-4">
          <Button
            variant="primary"
            onClick={() => {
              setEditingNetwork(null);
              setShowNetworkModal(true);
            }}
            className="text-sm"
          >
            {t('networks.addNetwork')}
          </Button>
        </div>
      )}

      {/* Network + Node cards grid */}
      {isLoadingNetworks ? (
        <div className="text-center py-12 text-[var(--muted)]">{t('common.loading')}</div>
      ) : chainNetworks.length === 0 ? (
        <div className="text-center py-12 text-[var(--muted)]">
          {t('networks.noNetworks')}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {chainNetworks.map((network) => (
            <NetworkNodeCard
              key={network.id}
              network={network}
              nodes={nodes[network.id] ?? []}
              loadingNodes={loadingNodes[network.id] ?? false}
              nodeTestResults={nodeTestResults}
              renderDetail={renderNetworkDetail}
              renderEndpoint={renderEndpoint}
              renderNetworkHeader={renderNetworkHeader}
              addNodeLabel={addNodeLabel}
              allowNetworkCrud={allowNetworkCrud}
              onImportRpc={onImportRpc ? () => onImportRpc(network.id) : undefined}
              onEditNetwork={() => handleEditNetwork(network)}
              onDeleteNetwork={() => handleRequestDeleteNetwork(network.id)}
              onAddNode={() => handleOpenCreateNode(network.id)}
              onDeleteNode={(nodeId) => {
                handleRequestDeleteNode(network.id, nodeId);
                return Promise.resolve();
              }}
              onEditNode={(node) => handleEditNode(network.id, node)}
              onTestNode={(nodeId) => testNode(chainType, network.id, nodeId)}
              onSetDefault={(nodeId) => setDefaultNode(chainType, network.id, nodeId)}
            />
          ))}
        </div>
      )}

      {/* Network Modal (only if allowNetworkCrud) */}
      {renderNetworkModal?.({
        isOpen: showNetworkModal,
        onClose: closeNetworkModal,
        editingNetwork,
      })}

      {/* Node Modal */}
      {activeNetworkId &&
        renderNodeModal({
          isOpen: showNodeModal || editingNode !== null,
          onClose: closeNodeModal,
          editingNode,
          selectedNetworkId: activeNetworkId,
        })}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title={deleteTitle}
        description={deleteDesc}
        variant="danger"
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        loading={deleting}
      />
    </PageShell>
  );
}

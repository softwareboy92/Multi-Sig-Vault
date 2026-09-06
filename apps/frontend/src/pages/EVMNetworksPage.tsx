import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useNetworkStore } from '../stores/useNetworkStore';
import { useToastStore } from '../stores/useToastStore';
import { useTranslation } from '../hooks/useTranslation';
import { Input } from '../components/ui';
import { ImportRpcModal } from '../components/networks/ImportRpcModal';
import { lookupChain, getPublicRpcs } from '../services/chainRegistry';
import {
  NetworksPageShell,
  NetworkFormModal,
  NodeFormModal,
  DEFAULT_NETWORK_FORM,
} from '../components/networks';
import type { NetworkFormState } from '../components/networks';
import type { NetworkConfig, NodeConfig } from '../types';

// ---------------------------------------------------------------------------
// EVM-specific node form
// ---------------------------------------------------------------------------

interface EvmNodeForm {
  endpoint_url: string;
  priority: string;
}

const DEFAULT_EVM_NODE_FORM: EvmNodeForm = { endpoint_url: '', priority: '100' };

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function EVMNetworksPage() {
  const { t } = useTranslation();
  const showToast = useToastStore((s) => s.showToast);
  const { createNetwork, updateNetwork, createNode, updateNode, setDefaultNode, fetchNetworks, fetchNodes } =
    useNetworkStore();

  // --- Network form state ---
  const [networkForm, setNetworkForm] = useState<NetworkFormState>(DEFAULT_NETWORK_FORM);

  // --- Node form state ---
  const [nodeForm, setNodeForm] = useState<EvmNodeForm>(DEFAULT_EVM_NODE_FORM);

  // --- Import RPC modal state ---
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importNetworkId, setImportNetworkId] = useState<string>('');
  const [importChainId, setImportChainId] = useState<number>(0);

  // --- Network modal handlers ---
  const handleNetworkSubmit = useCallback(
    async (form: NetworkFormState, editingNetwork: NetworkConfig | null) => {
      const chainId = parseInt(form.chain_id);
      const nativeCurrency =
        form.native_currency_name.trim() && form.native_currency_symbol.trim()
          ? {
              name: form.native_currency_name.trim(),
              symbol: form.native_currency_symbol.trim(),
              decimals: parseInt(form.native_currency_decimals) || 18,
            }
          : undefined;
      const extra = {
        chain_id: chainId,
        ...(nativeCurrency ? { native_currency: nativeCurrency } : {}),
      };
      if (editingNetwork) {
        await updateNetwork('EVM', editingNetwork.id, {
          name: form.name.trim(),
          is_testnet: form.is_testnet,
          explorer_url: form.explorer_url.trim() || null,
          extra,
        });
        showToast(t('networks.networkUpdated'), 'success');
      } else {
        const network = await createNetwork('EVM', {
          name: form.name.trim(),
          is_testnet: form.is_testnet,
          explorer_url: form.explorer_url.trim() || null,
          enabled: true,
          extra,
        });

        // Auto-seed one default RPC node from chain registry
        try {
          await lookupChain(chainId);
          const rpcs = getPublicRpcs(chainId);
          if (rpcs.length > 0) {
            const node = await createNode('EVM', network.id, {
              node_type: 'JSON_RPC',
              endpoint_url: rpcs[0],
              priority: 500,
            });
            await setDefaultNode('EVM', network.id, node.id);
          }
        } catch (e) {
          console.warn('[auto-seed] Failed to create default RPC node:', e);
        }
      }
      await fetchNetworks('EVM');
    },
    [createNetwork, updateNetwork, createNode, setDefaultNode, fetchNetworks, showToast, t],
  );

  // --- Node form handlers ---
  const handleNodeSubmit = useCallback(
    async (form: EvmNodeForm, editingNode: NodeConfig | null, networkId: string) => {
      const priority = Math.min(1000, Math.max(0, parseInt(form.priority) || 100));
      if (editingNode) {
        await updateNode(editingNode.id, {
          endpoint_url: form.endpoint_url.trim(),
          priority,
          enabled: editingNode.enabled,
        });
        showToast(t('networks.nodeUpdated'), 'success');
      } else {
        await createNode('EVM', networkId, {
          node_type: 'JSON_RPC',
          endpoint_url: form.endpoint_url.trim(),
          priority,
          enabled: true,
        });
      }
      await fetchNodes('EVM', networkId);
    },
    [createNode, updateNode, fetchNodes, showToast, t],
  );

  // Track whether we've seeded networkForm for the current editingNetwork
  const seededNetworkRef = useRef<string | null>(null);

  // --- Import RPC: derive existingEndpoints reactively from store ---
  const importNodes = useNetworkStore((s) => s.nodes[importNetworkId]);
  const existingEndpoints = useMemo(
    () => (importNodes ?? []).map((n) => n.endpoint_url),
    [importNodes],
  );

  const handleOpenImport = useCallback(
    (networkId: string) => {
      const nets = useNetworkStore.getState().networks.EVM ?? [];
      const net = nets.find((n) => n.id === networkId);
      const cid = (net?.extra as Record<string, unknown>)?.chain_id;
      if (typeof cid !== 'number') return;
      setImportNetworkId(networkId);
      setImportChainId(cid);
      setImportModalOpen(true);
    },
    [],
  );

  return (
    <>
    <NetworksPageShell
      chainType="EVM"
      title={t('networks.evmNetworks')}
      allowNetworkCrud
      renderNetworkDetail={(n) => `${t('networks.chainId')}: ${n.chain_id}`}
      addNodeLabel={t('networks.addRpcNode')}
      renderNetworkHeader={(network) => (
        <p className="text-sm text-[var(--muted)] mt-1">
          {t('networks.chainId')}: <code className="font-mono">{network.chain_id}</code>
        </p>
      )}
      renderNetworkModal={({ isOpen, onClose, editingNetwork }) => {
        // Seed networkForm once when modal opens in edit mode
        if (isOpen && editingNetwork && seededNetworkRef.current !== editingNetwork.id) {
          seededNetworkRef.current = editingNetwork.id;
          const seeded: NetworkFormState = {
            name: editingNetwork.name,
            chain_id: String(editingNetwork.chain_id ?? ''),
            is_testnet: editingNetwork.is_testnet,
            explorer_url: editingNetwork.explorer_url ?? '',
            native_currency_name:
              (editingNetwork.extra as any)?.native_currency?.name ?? '',
            native_currency_symbol:
              (editingNetwork.extra as any)?.native_currency?.symbol ?? '',
            native_currency_decimals:
              (editingNetwork.extra as any)?.native_currency?.decimals != null
                ? String((editingNetwork.extra as any).native_currency.decimals)
                : '',
          };
          // Directly set state; React will re-render with the seeded values
          setNetworkForm(seeded);
        }
        if (!isOpen && seededNetworkRef.current) {
          seededNetworkRef.current = null;
        }

        return (
          <NetworkFormModal
            isOpen={isOpen}
            onClose={() => {
              onClose();
              setNetworkForm(DEFAULT_NETWORK_FORM);
            }}
            mode={editingNetwork ? 'edit' : 'create'}
            form={networkForm}
            onFormChange={setNetworkForm}
            onSubmit={async (form) => {
              await handleNetworkSubmit(form, editingNetwork);
              onClose();
              setNetworkForm(DEFAULT_NETWORK_FORM);
            }}
          />
        );
      }}
      renderNodeModal={({ isOpen, onClose, editingNode, selectedNetworkId }) => (
        <NodeFormModal<EvmNodeForm>
          isOpen={isOpen}
          onClose={() => {
            onClose();
            setNodeForm(DEFAULT_EVM_NODE_FORM);
          }}
          title={editingNode ? t('networks.editRpcNode') : t('networks.addRpcNode')}
          isEditing={editingNode !== null}
          form={editingNode
            ? {
                endpoint_url: editingNode.endpoint_url,
                priority: String(editingNode.priority),
              }
            : nodeForm}
          onFormChange={(f) => setNodeForm(f)}
          validate={(form) => {
            if (!form.endpoint_url.trim()) return t('networks.endpointRequired');
            if (!/^https?:\/\/.+/.test(form.endpoint_url.trim())) return t('networks.invalidEndpointUrl');
            return null;
          }}
          onSubmit={async (form) => {
            await handleNodeSubmit(form, editingNode, selectedNetworkId);
            onClose();
            setNodeForm(DEFAULT_EVM_NODE_FORM);
          }}
          renderFields={(form, onChange) => (
            <>
              <Input
                label={t('networks.endpointUrl')}
                value={form.endpoint_url}
                onChange={(e) => onChange({ endpoint_url: e.target.value })}
                placeholder="https://eth-mainnet.example.com"
              />
              <Input
                label={t('networks.priority')}
                type="number"
                value={form.priority}
                onChange={(e) => onChange({ priority: e.target.value })}
                placeholder="100"
                min={0}
                max={1000}
              />
            </>
          )}
        />
      )}
      onImportRpc={handleOpenImport}
    />
    <ImportRpcModal
      isOpen={importModalOpen}
      onClose={() => setImportModalOpen(false)}
      chainId={importChainId}
      networkId={importNetworkId}
      existingEndpoints={existingEndpoints}
      onImported={(success, failed) => {
        fetchNodes('EVM', importNetworkId);
        if (success > 0 && failed === 0) {
          showToast(
            t('networks.importSuccess').replace('{count}', String(success)),
            'success',
          );
        } else if (success > 0 && failed > 0) {
          showToast(
            t('networks.importPartialFail')
              .replace('{success}', String(success))
              .replace('{failed}', String(failed)),
            'warning',
          );
        } else {
          showToast(t('networks.importAllFailed'), 'error');
        }
      }}
    />
    </>
  );
}

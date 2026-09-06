import { useState, useCallback, useEffect } from 'react';
import { useNetworkStore } from '../stores/useNetworkStore';
import { useToastStore } from '../stores/useToastStore';
import { useTranslation } from '../hooks/useTranslation';
import { Input, Badge, Modal, Button } from '../components/ui';
import { NetworksPageShell, NodeFormModal } from '../components/networks';
import { buildElectrumUrl, parseElectrumUrl } from '../utils/electrum-url';
import type { NetworkConfig, NodeConfig } from '../types';

// ---------------------------------------------------------------------------
// BTC-specific node form
// ---------------------------------------------------------------------------

interface BtcNodeForm {
  host: string;
  port: string;
  ssl: boolean;
  priority: string;
}

const DEFAULT_BTC_NODE_FORM: BtcNodeForm = {
  host: '',
  port: '50002',
  ssl: true,
  priority: '100',
};

// ---------------------------------------------------------------------------
// Explorer URL edit modal
// ---------------------------------------------------------------------------

function BtcExplorerModal({
  isOpen,
  onClose,
  network,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  network: NetworkConfig | null;
  onSave: (networkId: string, explorerUrl: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (network) {
      setUrl(network.explorer_url ?? '');
      setError(null);
    }
  }, [network]);

  const handleSubmit = async () => {
    const trimmed = url.trim();
    if (trimmed && !/^https?:\/\/.+/.test(trimmed)) {
      setError(t('networks.invalidExplorerUrl'));
      return;
    }
    setSaving(true);
    try {
      await onSave(network!.id, trimmed || null);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('networks.editExplorerUrl')}>
      <div className="flex flex-col gap-4">
        <Input
          label={t('networks.explorerUrl')}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError(null);
          }}
          placeholder="https://blockstream.info"
        />
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex gap-2 justify-end pt-1">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={saving}>
            {saving ? t('networks.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BTCNetworksPage() {
  const { t } = useTranslation();
  const showToast = useToastStore((s) => s.showToast);
  const { createNode, updateNode, fetchNodes, updateNetwork, fetchNetworks } =
    useNetworkStore();

  const [nodeForm, setNodeForm] = useState<BtcNodeForm>(DEFAULT_BTC_NODE_FORM);

  // --- Node handlers ---
  const handleNodeSubmit = useCallback(
    async (form: BtcNodeForm, editingNode: NodeConfig | null, networkId: string) => {
      const endpointUrl = buildElectrumUrl({
        host: form.host.trim(),
        port: parseInt(form.port),
        ssl: form.ssl,
      });
      const priority = Math.min(1000, Math.max(0, parseInt(form.priority) || 100));

      if (editingNode) {
        await updateNode(editingNode.id, {
          endpoint_url: endpointUrl,
          priority,
          enabled: editingNode.enabled,
        });
        showToast(t('networks.nodeUpdated'), 'success');
      } else {
        await createNode('BTC', networkId, {
          node_type: 'ELECTRUM',
          endpoint_url: endpointUrl,
          priority,
          enabled: true,
        });
      }
      await fetchNodes('BTC', networkId);
    },
    [createNode, updateNode, fetchNodes, showToast, t],
  );

  // --- Explorer URL save handler ---
  const handleExplorerSave = useCallback(
    async (networkId: string, explorerUrl: string | null) => {
      await updateNetwork('BTC', networkId, { explorer_url: explorerUrl });
      showToast(t('networks.networkUpdated'), 'success');
      await fetchNetworks('BTC');
    },
    [updateNetwork, fetchNetworks, showToast, t],
  );

  // --- BTC endpoint renderer ---
  const renderBtcEndpoint = useCallback(
    (node: NodeConfig) => {
      const parsed = parseElectrumUrl(node.endpoint_url);
      return (
        <div className="flex items-center gap-2">
          <code className="text-sm font-mono text-[var(--text)]">
            {parsed ? `${parsed.host}:${parsed.port}` : node.endpoint_url}
          </code>
          {parsed?.ssl && (
            <Badge variant="success" className="px-1.5 py-0.5">SSL</Badge>
          )}
        </div>
      );
    },
    [],
  );

  return (
    <NetworksPageShell
      chainType="BTC"
      title={t('networks.btcNetworks')}
      renderNetworkDetail={(n) => `${t('networks.network')}: ${n.btc_network}`}
      addNodeLabel={t('networks.addElectrumNode')}
      renderEndpoint={renderBtcEndpoint}
      renderNetworkHeader={() => null}
      renderNetworkModal={({ isOpen, onClose, editingNetwork }) => (
        <BtcExplorerModal
          isOpen={isOpen}
          onClose={onClose}
          network={editingNetwork}
          onSave={handleExplorerSave}
        />
      )}
      renderNodeModal={({ isOpen, onClose, editingNode, selectedNetworkId }) => (
        <NodeFormModal<BtcNodeForm>
          isOpen={isOpen}
          onClose={() => {
            onClose();
            setNodeForm(DEFAULT_BTC_NODE_FORM);
          }}
          title={editingNode ? t('networks.editElectrumNode') : t('networks.addElectrumNode')}
          isEditing={editingNode !== null}
          form={editingNode
            ? (() => {
                const parsed = parseElectrumUrl(editingNode.endpoint_url);
                return {
                  host: parsed?.host ?? editingNode.endpoint_url,
                  port: String(parsed?.port ?? 50002),
                  ssl: parsed?.ssl ?? true,
                  priority: String(editingNode.priority),
                };
              })()
            : nodeForm}
          onFormChange={(f) => setNodeForm(f)}
          validate={(form) => {
            if (!form.host.trim()) return t('networks.fillRequired');
            if (!/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(form.host.trim())) return t('networks.invalidHost');
            if (!form.port.trim()) return t('networks.fillRequired');
            const port = parseInt(form.port);
            if (isNaN(port) || port < 1 || port > 65535) return t('networks.invalidPort');
            return null;
          }}
          onSubmit={async (form) => {
            await handleNodeSubmit(form, editingNode, selectedNetworkId);
            onClose();
            setNodeForm(DEFAULT_BTC_NODE_FORM);
          }}
          renderFields={(form, onChange) => (
            <>
              <Input
                label={t('networks.host')}
                value={form.host}
                onChange={(e) => onChange({ host: e.target.value })}
                placeholder="electrum.example.com"
              />
              <Input
                label={t('networks.port')}
                type="number"
                value={form.port}
                onChange={(e) => onChange({ port: e.target.value })}
                placeholder="50002"
                min={1}
                max={65535}
              />
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.ssl}
                  onChange={(e) => onChange({ ssl: e.target.checked })}
                  className="accent-[var(--accent)]"
                />
                <span className="text-sm">{t('networks.useSsl')}</span>
              </label>
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
    />
  );
}

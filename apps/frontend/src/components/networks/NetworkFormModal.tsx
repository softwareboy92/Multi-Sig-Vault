import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { Modal, Input, Button } from '../ui';
import { lookupChain, getAllChains, checkSafeDeployment } from '../../services/chainRegistry';
import type { ChainInfo, SafeDeploymentStatus } from '../../services/chainRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NetworkFormState {
  name: string;
  chain_id: string;
  is_testnet: boolean;
  explorer_url: string;
  native_currency_name: string;
  native_currency_symbol: string;
  native_currency_decimals: string;
}

export const DEFAULT_NETWORK_FORM: NetworkFormState = {
  name: '',
  chain_id: '',
  is_testnet: false,
  explorer_url: '',
  native_currency_name: '',
  native_currency_symbol: '',
  native_currency_decimals: '',
};

export interface NetworkFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (form: NetworkFormState) => Promise<void>;
  /** "create" or "edit" mode. */
  mode: 'create' | 'edit';
  form: NetworkFormState;
  onFormChange: (form: NetworkFormState) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NetworkFormModal({
  isOpen,
  onClose,
  onSubmit,
  mode,
  form,
  onFormChange,
}: NetworkFormModalProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isEditing = mode === 'edit';

  // --- Chain selector state (create mode only) ---
  const [allChains, setAllChains] = useState<ChainInfo[]>([]);
  const [chainsLoading, setChainsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // --- Safe v1.4.1 deployment check state ---
  const [safeStatus, setSafeStatus] = useState<SafeDeploymentStatus | 'checking' | 'idle'>('idle');
  const safeCheckVersionRef = useRef(0);

  const triggerSafeCheck = useCallback(async (chainId: number) => {
    if (isEditing || isNaN(chainId) || chainId < 1) return;
    const version = ++safeCheckVersionRef.current;
    setSafeStatus('checking');
    const status = await checkSafeDeployment(chainId);
    if (safeCheckVersionRef.current === version) {
      setSafeStatus(status);
    }
  }, [isEditing]);

  useEffect(() => {
    if (isOpen && !isEditing && allChains.length === 0 && !chainsLoading) {
      setChainsLoading(true);
      getAllChains()
        .then(setAllChains)
        .finally(() => setChainsLoading(false));
    }
  }, [isOpen, isEditing, allChains.length, chainsLoading]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  // Popular chain IDs shown when search is empty
  const POPULAR_CHAIN_IDS = new Set([1, 56, 137, 42161, 10, 8453, 43114, 250, 100, 11155111, 97]);

  const filteredChains = form.name.trim()
    ? allChains.filter((c) => {
        const q = form.name.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          String(c.chainId).includes(q) ||
          c.nativeCurrency.symbol.toLowerCase().includes(q)
        );
      }).slice(0, 50)
    : allChains.filter((c) => POPULAR_CHAIN_IDS.has(c.chainId));

  const handleSelectChain = useCallback((chain: ChainInfo) => {
    onFormChange({
      ...form,
      name: chain.name,
      chain_id: String(chain.chainId),
      native_currency_name: chain.nativeCurrency.name,
      native_currency_symbol: chain.nativeCurrency.symbol,
      native_currency_decimals: String(chain.nativeCurrency.decimals),
      explorer_url: chain.explorers?.[0]?.url ?? '',
    });
    lastFilledChainIdRef.current = String(chain.chainId);
    setShowDropdown(false);
    if (formError) setFormError(null);
    triggerSafeCheck(chain.chainId);
  }, [form, onFormChange, formError, triggerSafeCheck]);

  const validate = (): string | null => {
    if (!form.name.trim()) return t('networks.fillRequired');
    if (!form.chain_id.trim()) return t('networks.fillRequired');
    const chainId = parseInt(form.chain_id);
    if (isNaN(chainId) || chainId < 1) return t('networks.invalidChainId');
    if (chainId > 4294967295) return t('networks.chainIdTooLarge');
    if (!isEditing && safeStatus === 'not-deployed') return t('networks.safeNotDeployed');
    const url = form.explorer_url.trim();
    if (url && !/^https?:\/\/.+/.test(url)) return t('networks.invalidExplorerUrl');
    if (form.native_currency_decimals.trim()) {
      const decimals = parseInt(form.native_currency_decimals);
      if (isNaN(decimals) || decimals < 0 || decimals > 255) return t('networks.invalidDecimals');
    }
    if (form.native_currency_symbol.trim().length > 16) return t('networks.symbolTooLong');
    return null;
  };

  const [lookingUp, setLookingUp] = useState(false);
  const lastFilledChainIdRef = useRef<string>('');

  const handleChainIdBlur = useCallback(async () => {
    const chainId = parseInt(form.chain_id);
    if (!chainId || isNaN(chainId)) return;

    const chainIdChanged = form.chain_id !== lastFilledChainIdRef.current;

    setLookingUp(true);
    try {
      const info = await lookupChain(chainId);
      if (!info) {
        // Chain not in registry — still check Safe deployment
        if (chainIdChanged) triggerSafeCheck(chainId);
        return;
      }

      const updates: Partial<NetworkFormState> = {};
      if (chainIdChanged) {
        // Chain ID changed — overwrite all fields with new chain info
        updates.name = info.name;
        updates.native_currency_name = info.nativeCurrency.name;
        updates.native_currency_symbol = info.nativeCurrency.symbol;
        updates.native_currency_decimals = String(info.nativeCurrency.decimals);
        if (info.explorers?.[0]?.url) updates.explorer_url = info.explorers[0].url;
        lastFilledChainIdRef.current = form.chain_id;
        triggerSafeCheck(chainId);
      } else {
        // Same chain ID — only fill empty fields
        if (!form.name) updates.name = info.name;
        if (!form.native_currency_name) updates.native_currency_name = info.nativeCurrency.name;
        if (!form.native_currency_symbol) updates.native_currency_symbol = info.nativeCurrency.symbol;
        if (!form.native_currency_decimals) updates.native_currency_decimals = String(info.nativeCurrency.decimals);
        if (!form.explorer_url && info.explorers?.[0]?.url) updates.explorer_url = info.explorers[0].url;
      }

      if (Object.keys(updates).length > 0) {
        onFormChange({ ...form, ...updates });
      }
    } finally {
      setLookingUp(false);
    }
  }, [form, onFormChange, triggerSafeCheck]);

  const handleSubmit = async () => {
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    setSaving(true);
    try {
      await onSubmit(form);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setFormError(null);
    setSafeStatus('idle');
    lastFilledChainIdRef.current = '';
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditing ? t('networks.editEvmNetwork') : t('networks.addEvmNetwork')}
    >
      <div className="flex flex-col gap-4">
        <div ref={dropdownRef} className="relative">
            <Input
              label={t('networks.networkName')}
              value={form.name}
              onChange={(e) => {
                onFormChange({ ...form, name: e.target.value });
                if (!isEditing) setShowDropdown(true);
                if (formError) setFormError(null);
              }}
              onFocus={() => { if (!isEditing) setShowDropdown(true); }}
              onBlur={() => setShowDropdown(false)}
              placeholder={chainsLoading ? t('networks.loadingChains') : t('networks.searchChainPlaceholder')}
              maxLength={128}
            />
          {!isEditing && showDropdown && filteredChains.length > 0 && (
            <ul className="overlay-surface absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-[var(--field-border)] shadow-[var(--shadow-overlay)]">
              {filteredChains.map((chain) => (
                <li
                  key={chain.chainId}
                  className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[var(--row-head-bg)] text-sm text-[var(--text)]"
                  onMouseDown={() => handleSelectChain(chain)}
                >
                  <span className="truncate">{chain.name}</span>
                  <span className="ml-2 shrink-0 text-xs text-[var(--muted)] font-mono">
                    {chain.chainId} · {chain.nativeCurrency.symbol}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Input
          label={t('networks.chainId')}
          type="number"
          value={form.chain_id}
          onChange={(e) => {
            if (isEditing) return;
            onFormChange({ ...form, chain_id: e.target.value });
            if (formError) setFormError(null);
          }}
          onBlur={handleChainIdBlur}
          placeholder="e.g., 1"
          min={1}
          max={4294967295}
          disabled={isEditing}
        />

        {isEditing && (
          <p className="text-xs text-[var(--muted)] -mt-3">
            {t('networks.chainIdReadonly')}
          </p>
        )}

        {!isEditing && safeStatus !== 'idle' && (() => {
          const cfg: Record<string, { color: string; key: string }> = {
            checking:        { color: 'muted',   key: 'networks.safeChecking' },
            deployed:        { color: 'success', key: 'networks.safeDeployed' },
            'not-deployed':  { color: 'danger',  key: 'networks.safeNotDeployed' },
            unknown:         { color: 'warning', key: 'networks.safeCheckUnknown' },
          };
          const c = cfg[safeStatus];
          if (!c) return null;
          return (
            <div className={`p-3 rounded-xl bg-[var(--${c.color})]/5 border border-[var(--${c.color})]/20 text-sm text-[var(--${c.color})]`}>
              {t(c.key)}
            </div>
          );
        })()}

        {/* Native Token (EIP-3085) */}
        <Input
          label={t('networks.nativeTokenName')}
          value={form.native_currency_name}
          onChange={(e) => {
            onFormChange({ ...form, native_currency_name: e.target.value });
            if (formError) setFormError(null);
          }}
          placeholder="e.g., Ether"
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t('networks.nativeTokenSymbol')}
            value={form.native_currency_symbol}
            onChange={(e) => {
              onFormChange({ ...form, native_currency_symbol: e.target.value });
              if (formError) setFormError(null);
            }}
            placeholder="e.g., ETH"
            maxLength={16}
          />
          <Input
            label={t('networks.nativeTokenDecimals')}
            type="number"
            value={form.native_currency_decimals}
            onChange={(e) => {
              onFormChange({ ...form, native_currency_decimals: e.target.value });
              if (formError) setFormError(null);
            }}
            placeholder="18"
            min={0}
            max={255}
          />
        </div>

        <Input
          label={t('networks.explorerUrl')}
          value={form.explorer_url}
          onChange={(e) => {
            onFormChange({ ...form, explorer_url: e.target.value });
            if (formError) setFormError(null);
          }}
          placeholder="https://etherscan.io"
        />

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.is_testnet}
            onChange={(e) => onFormChange({ ...form, is_testnet: e.target.checked })}
            className="accent-[var(--accent)]"
          />
          <span className="text-sm">{t('networks.testnet')}</span>
        </label>

        {formError && (
          <p className="text-sm text-[var(--danger)]">{formError}</p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="ghost" onClick={handleClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={saving || (!isEditing && (safeStatus === 'checking' || safeStatus === 'not-deployed'))}>
            {saving
              ? t('networks.saving')
              : isEditing
                ? t('common.save')
                : t('common.create')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

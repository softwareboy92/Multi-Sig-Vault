import { type ReactNode, useState } from 'react';
import type { NodeConfig, NodeTestResponse } from '../../types';
import { useTranslation } from '../../hooks/useTranslation';
import { useToastStore } from '../../stores/useToastStore';
import { HealthBadge } from './badges/HealthBadge';
import { LatencyBadge } from './badges/LatencyBadge';
import { PriorityBadge } from './badges/PriorityBadge';
import { Badge } from '../ui';

// ---------------------------------------------------------------------------
// Icons (extracted to avoid inline SVG duplication)
// ---------------------------------------------------------------------------

function StarIcon({ size = 18, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function TestIcon({ size = 18, animate = false }: { size?: number; animate?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={animate ? 'animate-pulse' : ''}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function EditIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NodeListProps {
  nodes: NodeConfig[];
  defaultNodeId?: string | null;
  /** Latest test results keyed by node ID. */
  nodeTestResults?: Record<string, NodeTestResponse>;
  /** Custom endpoint renderer; defaults to raw URL display. */
  renderEndpoint?: (node: NodeConfig) => ReactNode;
  /** Text shown when node list is empty. */
  emptyMessage?: string;

  // Callbacks
  onDelete: (nodeId: string) => Promise<void>;
  onEdit: (node: NodeConfig) => void;
  onTest: (nodeId: string) => Promise<NodeTestResponse>;
  onSetDefault: (nodeId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NodeList({
  nodes,
  defaultNodeId,
  nodeTestResults = {},
  renderEndpoint,
  emptyMessage,
  onDelete,
  onEdit,
  onTest,
  onSetDefault,
}: NodeListProps) {
  const { t } = useTranslation();
  const showToast = useToastStore((s) => s.showToast);

  const [testingNodeId, setTestingNodeId] = useState<string | null>(null);
  const [deletingNodeId, setDeletingNodeId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);

  // -- Test Node --
  const handleTest = async (nodeId: string) => {
    setTestingNodeId(nodeId);
    try {
      const result = await onTest(nodeId);
      if (result.success) {
        const latency = result.latency_ms != null ? ` (${Math.round(result.latency_ms)} ms)` : '';
        showToast(`${t('networks.testSuccess')}${latency}`, 'success');
      } else {
        showToast(t('networks.testFailed'), 'error');
      }
    } catch {
      showToast(t('networks.testFailed'), 'error');
    } finally {
      setTestingNodeId(null);
    }
  };

  // -- Delete Node (with safeguards) --
  const handleDelete = async (nodeId: string) => {
    setDeletingNodeId(nodeId);
    try {
      await onDelete(nodeId);

      // If we deleted the default node but others remain, auto-select highest-priority
      const isDefault = defaultNodeId === nodeId;
      const isLast = nodes.length === 1;
      if (isDefault && !isLast) {
        const remaining = nodes.filter((n) => n.id !== nodeId).sort((a, b) => b.priority - a.priority);
        if (remaining.length > 0) {
          try {
            await onSetDefault(remaining[0].id);
            showToast(t('networks.defaultNodeAutoSwitched'), 'info');
          } catch {
            // non-critical — user can set default manually
          }
        }
      }
    } finally {
      setDeletingNodeId(null);
    }
  };

  // -- Set Default Node --
  const handleSetDefault = async (nodeId: string) => {
    setSettingDefaultId(nodeId);
    try {
      await onSetDefault(nodeId);
      showToast(t('networks.defaultNodeSet'), 'success');
    } catch {
      showToast(t('networks.defaultNodeSetFailed'), 'error');
    } finally {
      setSettingDefaultId(null);
    }
  };

  const sortedNodes = [...nodes].sort((a, b) => b.priority - a.priority);

  if (nodes.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--muted)]">
        {emptyMessage ?? t('networks.noNodes')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sortedNodes.map((node) => {
        const isTesting = testingNodeId === node.id;
        const isDeleting = deletingNodeId === node.id;
        const isSettingDefault = settingDefaultId === node.id;
        const isDefault = defaultNodeId === node.id;
        const testResult = nodeTestResults[node.id];

        return (
          <div
            key={node.id}
            className="group/node flex items-center justify-between p-4 border border-[var(--border)] rounded-2xl bg-[var(--panel)] hover:bg-[var(--row-head-bg)] transition-colors"
          >
            {/* Left: endpoint + badges */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                {isDefault && (
                  <span className="text-[var(--accent)] shrink-0">
                    <StarIcon size={16} filled />
                  </span>
                )}
                {renderEndpoint ? (
                  renderEndpoint(node)
                ) : (
                  <code className="text-sm font-mono text-[var(--text)] truncate">
                    {node.endpoint_url}
                  </code>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <HealthBadge isHealthy={node.is_healthy} lastHealthCheck={node.last_health_check} size="sm" />
                <PriorityBadge priority={node.priority} size="sm" />
                {testResult?.latency_ms != null && (
                  <LatencyBadge latencyMs={testResult.latency_ms} size="sm" />
                )}
                {!node.enabled && (
                  <Badge variant="default">{t('networks.disabled')}</Badge>
                )}
              </div>
            </div>

            {/* Right: action buttons — hover/focus-within to reveal; stay visible when any action is in-flight */}
            <div className={`flex items-center gap-2 ml-4 transition-opacity duration-150 ${
              isTesting || isDeleting || isSettingDefault
                ? 'opacity-100'
                : 'opacity-0 group-hover/node:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100'
            }`}>
              {/* Test */}
              <button
                type="button"
                onClick={() => handleTest(node.id)}
                disabled={isTesting}
                className="p-2 text-[var(--accent)] hover:bg-[var(--row-head-bg)] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={t('networks.test')}
              >
                <TestIcon animate={isTesting} />
              </button>

              {/* Set Default */}
              {!isDefault && (
                <button
                  type="button"
                  onClick={() => handleSetDefault(node.id)}
                  disabled={isSettingDefault}
                  className="p-2 text-[var(--accent)] hover:bg-[var(--row-head-bg)] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title={t('networks.setDefault')}
                >
                  {isSettingDefault ? (
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                      <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="32" />
                    </svg>
                  ) : (
                    <StarIcon />
                  )}
                </button>
              )}

              {/* Edit */}
              <button
                type="button"
                onClick={() => onEdit(node)}
                className="p-2 text-[var(--muted)] hover:bg-[var(--row-head-bg)] rounded-lg transition-colors"
                title={t('networks.edit')}
              >
                <EditIcon />
              </button>

              {/* Delete */}
              <button
                type="button"
                onClick={() => handleDelete(node.id)}
                disabled={isDeleting}
                className="p-2 text-[var(--danger)] hover:bg-[var(--row-head-bg)] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={t('networks.delete')}
              >
                <TrashIcon />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertBanner,
  Badge,
  Button,
  Input,
  Modal,
  PageShell,
  SelectMenu,
  Switch,
} from "../components/ui";
import {
  exportData,
  type ExportRequest,
  importData,
  type ValidationResult,
  validateBackup,
} from "../api/backup";
import { useTranslation } from "../hooks/useTranslation";
import { usePreferenceStore } from "../stores/usePreferenceStore";
import { useGuideStore } from "../stores/useGuideStore";
import { useToastStore } from "../stores/useToastStore";
import { TIMEZONE_OPTIONS } from "../utils/time";
import {
  getSimulationConfig,
  updateSimulationConfig,
} from "../api/simulation";
import type { SimulationConfig } from "../types";

type ExportOptions = {
  wallets: boolean;
  signers: boolean;
  networks: boolean;
  address_book: boolean;
};

const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  wallets: true,
  signers: true,
  networks: true,
  address_book: true,
};

function toExportRequest(options: ExportOptions): ExportRequest {
  return {
    include_wallets: options.wallets,
    include_signers: options.signers,
    include_networks: options.networks,
    include_address_book: options.address_book,
  };
}

export const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToastStore();

  const {
    showTestnets,
    setShowTestnets,
    addressBookOnlyTransfers,
    setAddressBookOnlyTransfers,
    autoSyncEnabled,
    setAutoSyncEnabled,
    autoSyncIntervalMinutes,
    setAutoSyncIntervalMinutes,
    timezone,
    setTimezone,
    uiScalePercent,
    setUiScalePercent,
  } = usePreferenceStore();

  const resetAllGuides = useGuideStore((s) => s.resetAll);

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [exportOptions, setExportOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [conflictStrategy, setConflictStrategy] = useState<"skip" | "replace" | "rename">("skip");
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [securityModalOpen, setSecurityModalOpen] = useState(false);
  const [simulationConfig, setSimulationConfig] = useState<SimulationConfig | null>(null);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityForm, setSecurityForm] = useState({
    enabled: true,
    access_key: "",
    account_slug: "",
    project_slug: "",
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getSimulationConfig()
      .then((config) => setSimulationConfig(config))
      .catch(() => setSimulationConfig(null));
  }, []);

  useEffect(() => {
    if (location.hash === "#security") {
      requestAnimationFrame(() => {
        document.getElementById("security")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  }, [location.hash]);

  const openSecurityModal = () => {
    setSecurityForm({
      enabled: simulationConfig?.enabled ?? true,
      access_key: "",
      account_slug: simulationConfig?.account_slug ?? "",
      project_slug: simulationConfig?.project_slug ?? "",
    });
    setSecurityModalOpen(true);
  };

  const handleSaveSecurity = async () => {
    setSecurityLoading(true);
    try {
      const config = await updateSimulationConfig({
        enabled: securityForm.enabled,
        access_key: securityForm.access_key || undefined,
        account_slug: securityForm.account_slug,
        project_slug: securityForm.project_slug,
      });
      setSimulationConfig(config);
      setSecurityModalOpen(false);
      showToast(t("settings.securitySaved"), "success");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : t("settings.securitySaveFailed"),
        "error",
      );
    } finally {
      setSecurityLoading(false);
    }
  };

  const exportFileName = useMemo(() => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `multivault-backup-${stamp}.json`;
  }, []);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const blob = await exportData(toExportRequest(exportOptions));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportModalOpen(false);
      showToast(t("backup.exportSuccess"), "success");
    } catch (err) {
      showToast(
        t("backup.exportFailed").replace(
          "{error}",
          err instanceof Error ? err.message : "Unknown error"
        ),
        "error"
      );
    } finally {
      setIsExporting(false);
    }
  };

  const MAX_BACKUP_SIZE = 50 * 1024 * 1024; // 50 MB

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (file && file.size > MAX_BACKUP_SIZE) {
      showToast(t("backup.fileTooLarge"), "error");
      setImportFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setImportFile(file);
    setValidationResult(null);
  };

  const handleValidate = async () => {
    if (!importFile) return;
    setIsValidating(true);
    try {
      const result = await validateBackup(importFile);
      setValidationResult(result);
      showToast(
        result.is_valid ? t("backup.validationSuccess") : t("backup.validationFailed"),
        result.is_valid ? "success" : "error"
      );
    } catch (err) {
      showToast(
        t("backup.validateFailed").replace(
          "{error}",
          err instanceof Error ? err.message : "Unknown error"
        ),
        "error"
      );
    } finally {
      setIsValidating(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    setIsImporting(true);
    try {
      const result = await importData(importFile, conflictStrategy, false);
      setImportModalOpen(false);
      setImportFile(null);
      setValidationResult(null);

      const importedTotal = Object.values(result.imported ?? {}).reduce((sum, v) => sum + v, 0);
      showToast(
        importedTotal > 0
          ? `${t("backup.importSuccess")} — ${t("backup.importedItems", { count: importedTotal })}`
          : t("backup.importSuccess"),
        "success"
      );
    } catch (err) {
      showToast(
        t("backup.importFailed").replace(
          "{error}",
          err instanceof Error ? err.message : "Unknown error"
        ),
        "error"
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <PageShell
      title={t("settings.title")}
      breadcrumbs={<span className="title-h2 text-[var(--text)]">{t("settings.title")}</span>}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h3 className="title-h3 text-[var(--text)]">{t("settings.networkManagement")}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--panel)] px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold">{t("settings.evmNetworksTitle")}</div>
                  <div className="text-xs text-[var(--muted)]">{t("settings.evmNetworksDesc")}</div>
                </div>
                <Button variant="ghost" onClick={() => navigate("/settings/networks/evm")}>
                  {t("common.manage")}
                </Button>
              </div>
            </div>

            <div className="rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--panel)] px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold">{t("settings.btcNetworksTitle")}</div>
                  <div className="text-xs text-[var(--muted)]">{t("settings.btcNetworksDesc")}</div>
                </div>
                <Button variant="ghost" onClick={() => navigate("/settings/networks/btc")}>
                  {t("common.manage")}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="title-h3 text-[var(--text)]">{t("settings.preferences")}</h3>
          <div className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--panel)] px-5">
            <div className="flex items-center justify-between gap-4 py-4">
              <div>
                <div className="text-sm font-bold">{t("settings.showTestnets")}</div>
                <div className="text-xs text-[var(--muted)]">{t("settings.showTestnetsDesc")}</div>
              </div>
              <Switch checked={showTestnets} onCheckedChange={setShowTestnets} ariaLabel={t("settings.showTestnets")} />
            </div>

            <div className="flex items-center justify-between gap-4 py-4">
              <div>
                <div className="text-sm font-bold">{t("settings.autoSync")}</div>
                <div className="text-xs text-[var(--muted)]">{t("settings.autoSyncDesc")}</div>
              </div>
              <div className="flex items-center gap-3">
                <SelectMenu
                  value={String(autoSyncIntervalMinutes)}
                  onChange={(value) => setAutoSyncIntervalMinutes(Number(value) as 1 | 5 | 10)}
                  options={[
                    { value: "1", label: t("settings.autoSync1m") },
                    { value: "5", label: t("settings.autoSync5m") },
                    { value: "10", label: t("settings.autoSync10m") },
                  ]}
                />
                <Switch checked={autoSyncEnabled} onCheckedChange={setAutoSyncEnabled} ariaLabel={t("settings.autoSync")} />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 py-4">
              <div>
                <div className="text-sm font-bold">{t("settings.timezone")}</div>
                <div className="text-xs text-[var(--muted)]">{t("settings.timezoneDesc")}</div>
              </div>
              <SelectMenu
                value={timezone}
                onChange={(value) => setTimezone(value)}
                options={TIMEZONE_OPTIONS.map((tz) => ({
                  value: tz.value,
                  label: "labelKey" in tz ? t(tz.labelKey) : tz.label,
                }))}
              />
            </div>

            <div className="flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-bold">{t("settings.interfaceScale")}</div>
                <div className="text-xs text-[var(--muted)]">{t("settings.interfaceScaleDesc")}</div>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-3 lg:justify-end">
                <span className="min-w-12 rounded-full bg-[var(--row-head-bg)] px-2.5 py-1 text-center text-sm font-bold tabular-nums text-[var(--text)]">
                  {uiScalePercent}%
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <input
                    type="range"
                    min={80}
                    max={125}
                    step={5}
                    value={uiScalePercent}
                    onChange={(event) =>
                      setUiScalePercent(Number(event.target.value))
                    }
                    className="ui-scale-slider max-w-full"
                    aria-label={t("settings.interfaceScale")}
                    aria-valuetext={`${uiScalePercent}%`}
                    style={
                      {
                        "--ui-scale-progress": `${((uiScalePercent - 80) / 45) * 100}%`,
                      } as React.CSSProperties
                    }
                  />
                  <div className="flex justify-between px-0.5 text-[10px] text-[var(--muted)]" aria-hidden="true">
                    <span>80%</span>
                    <span>125%</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  className="px-3 py-2"
                  onClick={() => setUiScalePercent(100)}
                  disabled={uiScalePercent === 100}
                >
                  {t("settings.resetInterfaceScale")}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 py-4">
              <div>
                <div className="text-sm font-bold">{t("guide.resetGuides")}</div>
                <div className="text-xs text-[var(--muted)]">{t("guide.resetGuidesDesc")}</div>
              </div>
              <Button variant="ghost" onClick={resetAllGuides}>
                {t("guide.resetGuidesButton")}
              </Button>
            </div>
          </div>
        </div>

        <div id="security" className="flex scroll-mt-6 flex-col gap-3">
          <h3 className="title-h3 text-[var(--text)]">{t("settings.securitySettings")}</h3>
          <div className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--panel)] px-5">
            <div className="flex items-center justify-between gap-4 py-4">
              <div>
                <div className="text-sm font-bold">{t("settings.addressBookOnlyTransfers")}</div>
                <div className="text-xs text-[var(--muted)]">{t("settings.addressBookOnlyTransfersDesc")}</div>
              </div>
              <Switch
                checked={addressBookOnlyTransfers}
                onCheckedChange={setAddressBookOnlyTransfers}
                ariaLabel={t("settings.addressBookOnlyTransfers")}
              />
            </div>

            <div className="flex items-center justify-between gap-4 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-bold">{t("settings.transactionSimulation")}</div>
                  <Badge
                    variant={simulationConfig?.configured ? "success" : "default"}
                    dot
                  >
                    {simulationConfig?.configured
                      ? t("settings.configured")
                      : t("settings.notConfigured")}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  {t("settings.transactionSimulationDesc")}
                </div>
              </div>
              <Button variant="ghost" onClick={openSecurityModal}>
                {t("common.manage")}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="title-h3 text-[var(--text)]">{t("backup.title")}</h3>
          <div className="flex flex-col gap-3 rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--panel)] px-5 py-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm font-bold">{t("backup.exportTitle")}</div>
                <div className="text-xs text-[var(--muted)]">{t("backup.exportDesc")}</div>
              </div>
              <Button variant="primary" onClick={() => setExportModalOpen(true)}>
                {t("backup.exportButton")}
              </Button>
            </div>
            <div className="flex items-center justify-between py-2 border-t border-[var(--border)]">
              <div>
                <div className="text-sm font-bold">{t("backup.importTitle")}</div>
                <div className="text-xs text-[var(--muted)]">{t("backup.importDesc")}</div>
              </div>
              <Button variant="ghost" onClick={() => setImportModalOpen(true)}>
                {t("backup.importButton")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Modal
        isOpen={securityModalOpen}
        onClose={() => setSecurityModalOpen(false)}
        title={t("settings.transactionSimulation")}
        showCloseButton
      >
        <div className="space-y-4">
          <AlertBanner severity="info">
            {t("settings.tenderlySecurityNotice")}
          </AlertBanner>

          <div className="flex items-center justify-between gap-4 rounded-[var(--field-radius)] border border-[var(--border)] bg-[var(--surface)] p-3">
            <div>
              <div className="text-sm font-bold">{t("settings.enableSimulation")}</div>
              <div className="text-xs text-[var(--muted)]">
                {t("settings.enableSimulationDesc")}
              </div>
            </div>
            <Switch
              checked={securityForm.enabled}
              onCheckedChange={(enabled) =>
                setSecurityForm((current) => ({ ...current, enabled }))
              }
              ariaLabel={t("settings.enableSimulation")}
            />
          </div>

          <Input
            type="password"
            label={t("settings.tenderlyApiKey")}
            value={securityForm.access_key}
            onChange={(event) =>
              setSecurityForm((current) => ({
                ...current,
                access_key: event.target.value,
              }))
            }
            placeholder={
              simulationConfig?.access_key_set
                ? t("settings.apiKeySavedPlaceholder")
                : t("settings.tenderlyApiKeyPlaceholder")
            }
            autoComplete="off"
            disabled={!securityForm.enabled}
          />
          <Input
            label={t("settings.tenderlyAccount")}
            value={securityForm.account_slug}
            onChange={(event) =>
              setSecurityForm((current) => ({
                ...current,
                account_slug: event.target.value,
              }))
            }
            placeholder={t("settings.tenderlyAccountPlaceholder")}
            disabled={!securityForm.enabled}
          />
          <Input
            label={t("settings.tenderlyProject")}
            value={securityForm.project_slug}
            onChange={(event) =>
              setSecurityForm((current) => ({
                ...current,
                project_slug: event.target.value,
              }))
            }
            placeholder={t("settings.tenderlyProjectPlaceholder")}
            disabled={!securityForm.enabled}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
            <a
              href="https://dashboard.tenderly.co/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-bold text-[var(--accent)] hover:underline"
            >
              {t("settings.openTenderly")}
            </a>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => setSecurityModalOpen(false)}
                disabled={securityLoading}
              >
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={handleSaveSecurity}
                loading={securityLoading}
              >
                {t("common.save")}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={exportModalOpen} onClose={() => setExportModalOpen(false)} title={t("backup.exportTitle")}>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={exportOptions.wallets}
                onChange={(e) => setExportOptions((prev) => ({ ...prev, wallets: e.target.checked }))}
                className="w-4 h-4"
              />
              <span>{t("backup.includeWallets")}</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={exportOptions.signers}
                onChange={(e) => setExportOptions((prev) => ({ ...prev, signers: e.target.checked }))}
                className="w-4 h-4"
              />
              <span>{t("backup.includeSigners")}</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={exportOptions.networks}
                onChange={(e) => setExportOptions((prev) => ({ ...prev, networks: e.target.checked }))}
                className="w-4 h-4"
              />
              <span>{t("backup.includeNetworks")}</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={exportOptions.address_book}
                onChange={(e) => setExportOptions((prev) => ({ ...prev, address_book: e.target.checked }))}
                className="w-4 h-4"
              />
              <span>{t("backup.includeAddressBook")}</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setExportModalOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={handleExport}
              disabled={isExporting || !Object.values(exportOptions).some(Boolean)}
            >
              {isExporting ? t("backup.exporting") : t("backup.exportButton")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={importModalOpen}
        onClose={() => {
          setImportModalOpen(false);
          setImportFile(null);
          setValidationResult(null);
        }}
        title={t("backup.importTitle")}
      >
        <div className="space-y-4">
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button variant="ghost" onClick={() => fileInputRef.current?.click()} className="w-full">
              {importFile ? importFile.name : t("backup.selectFile")}
            </Button>
          </div>

          {importFile && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("backup.conflictStrategy")}</label>
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="conflict-strategy"
                      value="skip"
                      checked={conflictStrategy === "skip"}
                      onChange={(e) => setConflictStrategy(e.target.value as "skip" | "replace" | "rename")}
                      className="w-4 h-4"
                    />
                    <span>{t("backup.strategySkip")}</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="conflict-strategy"
                      value="replace"
                      checked={conflictStrategy === "replace"}
                      onChange={(e) => setConflictStrategy(e.target.value as "skip" | "replace" | "rename")}
                      className="w-4 h-4"
                    />
                    <span>{t("backup.strategyReplace")}</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="conflict-strategy"
                      value="rename"
                      checked={conflictStrategy === "rename"}
                      onChange={(e) => setConflictStrategy(e.target.value as "skip" | "replace" | "rename")}
                      className="w-4 h-4"
                    />
                    <span>{t("backup.strategyRename")}</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="ghost" onClick={handleValidate} disabled={isValidating} className="flex-1">
                  {isValidating ? t("backup.validating") : t("backup.validateButton")}
                </Button>
                <Button
                  variant="primary"
                  onClick={handleImport}
                  disabled={
                    isImporting ||
                    (validationResult ? !validationResult.is_valid : false)
                  }
                  className="flex-1"
                >
                  {isImporting ? t("backup.importing") : t("backup.importButton")}
                </Button>
              </div>

              {validationResult && !validationResult.is_valid && (
                <div className="text-xs text-[var(--danger)]">{t("backup.validationFailed")}</div>
              )}
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => {
                setImportModalOpen(false);
                setImportFile(null);
                setValidationResult(null);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      </Modal>
    </PageShell>
  );
};

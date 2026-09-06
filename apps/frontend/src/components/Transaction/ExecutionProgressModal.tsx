import React from "react";
import { Modal } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { SOURCE_ICON_MAP } from "../../utils/signer";
import type { DeviceType } from "../../types";

interface ExecutionProgressModalProps {
  deviceType: DeviceType | null;
}

export const ExecutionProgressModal: React.FC<ExecutionProgressModalProps> = ({
  deviceType,
}) => {
  const { t } = useTranslation();
  const device = deviceType ? SOURCE_ICON_MAP[deviceType] : undefined;
  const deviceName = device?.label || deviceType || "";

  return (
    <Modal
      isOpen={Boolean(deviceType)}
      onClose={() => {}}
      title={t("transactions.executionModalTitle")}
      maxWidth="28rem"
    >
      <div
        className="flex flex-col items-center px-1 py-3 text-center"
        role="status"
        aria-live="polite"
      >
        <div className="relative mb-6 flex h-24 w-24 items-center justify-center">
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-[var(--border)] border-r-[var(--accent)] border-t-[var(--accent)] motion-reduce:animate-none" />
          <div className="flex h-18 w-18 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--row-head-bg)] shadow-[var(--card-shadow)]">
            {device?.icon ? (
              <img
                src={device.icon}
                alt={deviceName}
                className="h-11 w-11 object-contain"
              />
            ) : (
              <span className="text-lg font-bold text-[var(--accent)]">
                {deviceName.slice(0, 1)}
              </span>
            )}
          </div>
        </div>

        <h4 className="text-base font-bold text-[var(--text)]">
          {t("transactions.executionModalWaiting", { device: deviceName })}
        </h4>
        <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">
          {t("transactions.executionModalInstruction", { device: deviceName })}
        </p>
        <p className="mt-4 text-xs text-[var(--muted)]">
          {t("transactions.executionModalKeepOpen")}
        </p>
      </div>
    </Modal>
  );
};

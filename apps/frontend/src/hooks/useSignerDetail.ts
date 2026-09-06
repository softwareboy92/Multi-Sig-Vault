import { useCallback, useEffect, useState } from "react";
import { getSigner, renameSigner } from "../api";
import { useToastStore } from "../stores/useToastStore";
import { useTranslation } from "./useTranslation";
import type { Signer } from "../types";

export type SignerDetailState = "loading" | "error" | "not-found" | "ready";

export interface UseSignerDetailReturn {
  state: SignerDetailState;
  error: string | null;
  signer: Signer | null;
  reload: () => Promise<void>;
  rename: (newName: string) => Promise<void>;
  isRenaming: boolean;
}

export function useSignerDetail(id: string | undefined): UseSignerDetailReturn {
  const { t } = useTranslation();
  const { showToast } = useToastStore();

  const [signer, setSigner] = useState<Signer | null>(null);
  const [state, setState] = useState<SignerDetailState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setState("not-found");
      return;
    }
    try {
      setState("loading");
      setError(null);
      const data = await getSigner(id);
      setSigner(data);
      setState("ready");
    } catch (err) {
      if (err instanceof Error && err.message.includes("404")) {
        setState("not-found");
      } else {
        setError(err instanceof Error ? err.message : String(err));
        setState("error");
      }
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const rename = useCallback(
    async (newName: string) => {
      if (!id || !signer) return;
      setIsRenaming(true);
      try {
        const updated = await renameSigner(id, newName);
        setSigner(updated);
        showToast(t("wallet.renameSuccess"), "success");
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : t("wallet.renameFailed"),
          "error"
        );
      } finally {
        setIsRenaming(false);
      }
    },
    [id, signer, showToast, t]
  );

  return { state, error, signer, reload: load, rename, isRenaming };
}

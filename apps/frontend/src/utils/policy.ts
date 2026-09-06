/**
 * Map policy action key to i18n translation key.
 */
const POLICY_ACTION_I18N: Record<string, string> = {
  add_owner: "transactions.policyActionAddOwner",
  remove_owner: "transactions.policyActionRemoveOwner",
  swap_owner: "transactions.policyActionSwapOwner",
  change_threshold: "transactions.policyActionChangeThreshold",
};

/**
 * Get translated label for a policy action.
 *
 * @param action - Raw policy_action value from transaction extra
 * @param t - i18n translation function
 * @returns Translated action label
 */
export function getPolicyActionLabel(
  action: string | undefined | null,
  t: (key: string) => string,
): string {
  if (!action) return t("transactions.policyChangeTransaction");
  const key = POLICY_ACTION_I18N[action];
  return key ? t(key) : t("transactions.policyChangeTransaction");
}

/**
 * Backup and restore API client
 */

const API_BASE = '/api/v1';

export interface ExportRequest {
  include_wallets: boolean;
  wallet_ids?: string[];
  include_signers: boolean;
  signer_ids?: string[];
  include_networks: boolean;
  include_address_book: boolean;
}

export interface ValidationResult {
  is_valid: boolean;
  version_compatible: boolean;
  warnings: string[];
  errors: string[];
  items_to_import: Record<string, number>;
}

export interface ImportResult {
  success: boolean;
  imported: Record<string, number>;
  skipped: Record<string, number>;
  replaced: Record<string, number>;
  renamed: Record<string, number>;
  errors: Array<Record<string, any>>;
}

/**
 * Export data to backup file
 */
export async function exportData(request: ExportRequest): Promise<Blob> {
  const response = await fetch(`${API_BASE}/backup/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Export failed: ${response.statusText}`);
  }

  return response.blob();
}

/**
 * Validate backup file
 */
export async function validateBackup(file: File): Promise<ValidationResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/backup/validate`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Validation failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Import data from backup file
 */
export async function importData(
  file: File,
  conflictStrategy: 'skip' | 'replace' | 'rename' = 'skip',
  validateOnly: boolean = false
): Promise<ImportResult> {
  const formData = new FormData();
  formData.append('file', file);

  const url = new URL(`${window.location.origin}${API_BASE}/backup/import`);
  url.searchParams.set('conflict_strategy', conflictStrategy);
  url.searchParams.set('validate_only', String(validateOnly));

  const response = await fetch(url.toString(), {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Import failed: ${response.statusText}`);
  }

  return response.json();
}

// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - KeyVault Provider Implementation
// ═══════════════════════════════════════════════════════════════════════════
//
// Offline QR-based signing provider for the MultiVault KeyVault iOS app.
//
// Key difference from other providers: KeyVault is an air-gapped device,
// so connect() just stores the already-known address (no device I/O),
// while sign flows encode payloads → open QR modal → wait for scan result.
// ═══════════════════════════════════════════════════════════════════════════

import { BaseProvider } from '../../core/base.js';
import { WalletError, WalletErrorCode } from '../../core/errors.js';
import type { Account, ChainType, ConnectOptions, SignResult, WalletType } from '../../types/wallet.js';
import type { SignPayload } from '../../types/payload.js';
import { bcurEncode } from './bcur.js';
import { decodeNxvResponse, extractSignatures, extractSignerAccount } from './decoder.js';
// Side-effect import: registers <keyvault-modal> custom element synchronously
// so that document.createElement('keyvault-modal') returns a real instance.
import './modal/modal.js';
import type { KeyVaultModalElement } from './modal/modal.js';
import type { KeyVaultModalParams } from './types.js';

const DEFAULT_QR_TIMEOUT_MS = 180_000; // 3 minutes

// ─── Config & Extended Options ────────────────────────────────────────────

export interface KeyVaultConfig {
  qrTimeoutMs?: number;
}

/**
 * Extended connect options for KeyVault.
 *
 * Unlike hardware wallets, the address is already known from the backend
 * signer record — it is passed in at connect time rather than read from
 * a device.
 */
export interface KeyVaultConnectOptions extends ConnectOptions {
  address: string;
  publicKey?: string;
  xpub?: string;
  masterFingerprint?: string;
}

// ─── Provider ─────────────────────────────────────────────────────────────

export class KeyVaultProvider extends BaseProvider {
  readonly walletType: WalletType = 'KEYVAULT';
  readonly supportedChains: ChainType[] = ['ETHEREUM', 'BITCOIN'];

  private modal: KeyVaultModalElement | null = null;
  private qrTimeoutMs: number;

  constructor(config?: KeyVaultConfig) {
    super();
    this.qrTimeoutMs = config?.qrTimeoutMs ?? DEFAULT_QR_TIMEOUT_MS;
  }

  async init(): Promise<void> {
    this.updateState('IDLE');
  }

  async connect(options: ConnectOptions): Promise<Account> {
    this.ensureInitialized();
    const kvOptions = options as KeyVaultConnectOptions;

    const account: Account = {
      address: kvOptions.address,
      chain: options.chain,
      walletType: 'KEYVAULT',
      publicKey: kvOptions.publicKey,
      xpub: kvOptions.xpub,
      masterFingerprint: kvOptions.masterFingerprint,
      derivationPath: kvOptions.derivationPath,
    };

    this.updateAccount(account);
    this.updateState('CONNECTED');
    return account;
  }

  async disconnect(): Promise<void> {
    this.modal?.close();
    this.updateAccount(null);
    this.updateState('IDLE');
  }

  async signTransaction(payload: SignPayload, account: Account): Promise<SignResult> {
    this.ensureConnected();
    this.updateState('SIGNING');

    try {
      let payloadJson: string;
      if (payload.type === 'keyvault') {
        payloadJson = payload.payloadJson;
      } else {
        throw new WalletError(
          WalletErrorCode.INVALID_PAYLOAD,
          `Unsupported payload type for KeyVault: ${payload.type}`,
        );
      }

      const frames = bcurEncode(payloadJson);
      const json = await this.showModalAndWaitForResult({ frames, action: 'sign' });

      const response = decodeNxvResponse(json);
      if (response.nxv_action !== 'sign_result') {
        throw new WalletError(
          WalletErrorCode.SIGNING_FAILED,
          `Expected sign_result but got ${response.nxv_action}`,
        );
      }
      const signatures = extractSignatures(response);

      const sig = signatures[0];
      if (!sig || !sig.signature) {
        throw new WalletError(WalletErrorCode.SIGNING_FAILED, 'No signature received from KeyVault');
      }

      this.updateState('CONNECTED');
      return {
        signature: sig.signature,
        signerAddress: account.address,
        signedAt: new Date(),
      };
    } catch (error) {
      this.updateState('CONNECTED');
      throw this.wrapError(error, WalletErrorCode.SIGNING_FAILED);
    }
  }

  async signMessage(message: string, account: Account): Promise<SignResult> {
    this.ensureConnected();
    this.updateState('SIGNING');

    try {
      const frames = bcurEncode(message);
      const json = await this.showModalAndWaitForResult({ frames, action: 'import' });

      const response = decodeNxvResponse(json);
      if (response.nxv_action !== 'import_signer_result') {
        throw new WalletError(
          WalletErrorCode.SIGNING_FAILED,
          `Expected import_signer_result but got ${response.nxv_action}`,
        );
      }
      const signerAccount = extractSignerAccount(response);

      // Update account with data from KeyVault device.
      // Use `??` (not `||`) to preserve empty-string values from the device.
      const updatedAccount: Account = {
        ...account,
        address: signerAccount.address ?? account.address,
        publicKey: signerAccount.publicKey ?? account.publicKey,
        xpub: signerAccount.xpub ?? account.xpub,
        masterFingerprint: signerAccount.masterFingerprint ?? account.masterFingerprint,
        derivationPath: signerAccount.derivationPath ?? account.derivationPath,
      };
      this.updateAccount(updatedAccount);

      this.updateState('CONNECTED');
      return {
        signature: signerAccount.challengeSignature,
        signerAddress: signerAccount.address ?? account.address,
        signedAt: new Date(),
      };
    } catch (error) {
      this.updateState('CONNECTED');
      throw this.wrapError(error, WalletErrorCode.SIGNING_FAILED);
    }
  }

  // ─── Modal Management ───────────────────────────────────────────────────

  private getModal(): KeyVaultModalElement {
    if (!this.modal) {
      // Custom element is already registered via the top-level side-effect import.
      this.modal = document.createElement('keyvault-modal') as KeyVaultModalElement;
      document.body.appendChild(this.modal);
    }
    return this.modal;
  }

  private showModalAndWaitForResult(params: KeyVaultModalParams): Promise<string> {
    const modal = this.getModal();

    const resultPromise = new Promise<string>((resolve, reject) => {
      modal.onResult = (json: string) => {
        modal.close();
        resolve(json);
      };
      modal.onCancel = () => {
        modal.close();
        reject(new WalletError(WalletErrorCode.USER_REJECTED, 'User cancelled KeyVault signing'));
      };
    });

    modal.open(params);

    return this.withTimeout(resultPromise, this.qrTimeoutMs, WalletErrorCode.OPERATION_TIMEOUT);
  }
}

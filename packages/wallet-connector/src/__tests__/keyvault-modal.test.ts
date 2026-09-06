import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock canvas-dependent modules to avoid jsdom limitations
// (QRCode.toCanvas needs a real canvas context, getUserMedia needs a real device)
vi.mock('qrcode', () => ({
  default: { toCanvas: vi.fn().mockResolvedValue(undefined) },
}));

// Import will register the custom element
import '../providers/keyvault/modal/modal.js';

describe('KeyVaultModalElement', () => {
  let modal: any; // KeyVaultModalElement

  beforeEach(() => {
    modal = document.createElement('keyvault-modal');
    document.body.appendChild(modal);
  });

  afterEach(() => {
    modal.close();
    modal.remove();
    document.documentElement.lang = 'en';
  });

  it('registers as custom element', () => {
    expect(customElements.get('keyvault-modal')).toBeDefined();
  });

  it('has shadow root', () => {
    expect(modal.shadowRoot).toBeTruthy();
  });

  it('is not visible before open()', () => {
    expect(modal.classList.contains('open')).toBe(false);
  });

  it('becomes visible after open()', () => {
    modal.open({ frames: ['ur:bytes/1-1/test'], action: 'sign' });
    expect(modal.classList.contains('open')).toBe(true);
  });

  it('hides after close()', () => {
    modal.open({ frames: ['ur:bytes/1-1/test'], action: 'sign' });
    modal.close();
    expect(modal.classList.contains('open')).toBe(false);
  });

  it('calls onCancel when cancel clicked', () => {
    let cancelled = false;
    modal.onCancel = () => { cancelled = true; };
    modal.open({ frames: ['ur:bytes/1-1/test'], action: 'sign' });

    const cancelBtn = modal.shadowRoot?.querySelector('.btn.ghost') as HTMLButtonElement;
    cancelBtn?.click();
    expect(cancelled).toBe(true);
  });

  it('singleton: element stays in DOM after close', () => {
    modal.open({ frames: ['ur:bytes/1-1/test'], action: 'sign' });
    modal.close();
    expect(document.querySelector('keyvault-modal')).toBeTruthy();
  });

  it('closes on Escape key', () => {
    let cancelled = false;
    modal.onCancel = () => { cancelled = true; };
    modal.open({ frames: ['ur:bytes/1-1/test'], action: 'sign' });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(cancelled).toBe(true);
    expect(modal.classList.contains('open')).toBe(false);
  });

  it('renders display phase content after open', () => {
    modal.open({ frames: ['ur:bytes/1-1/test'], action: 'sign' });

    expect(modal.shadowRoot?.querySelector('.modal-card')).toBeTruthy();
    expect(modal.shadowRoot?.querySelector('.title')).toBeTruthy();
    expect(modal.shadowRoot?.querySelector('.qr-canvas')).toBeTruthy();
    expect(modal.shadowRoot?.querySelector('.btn.primary')?.textContent).toBe('Scan Result');
  });

  it('shows correct title for sign action', () => {
    modal.open({ frames: ['ur:bytes/1-1/test'], action: 'sign' });
    expect(modal.shadowRoot?.querySelector('.title')?.textContent).toBe('Sign with KeyVault');
  });

  it('shows correct title for import action', () => {
    modal.open({ frames: ['ur:bytes/1-1/test'], action: 'import' });
    expect(modal.shadowRoot?.querySelector('.title')?.textContent).toBe('Import Signer from KeyVault');
  });

  it('uses the current document language for modal content', () => {
    document.documentElement.lang = 'zh-CN';
    modal.open({ frames: ['ur:bytes/1-1/test'], action: 'import' });

    expect(modal.shadowRoot?.querySelector('.title')?.textContent).toBe('从 KeyVault 导入签名地址');
    expect(modal.shadowRoot?.querySelector('.hint')?.textContent).toBe(
      '请使用 KeyVault 扫描下方二维码以继续。',
    );
    expect(modal.shadowRoot?.querySelector('.btn.primary')?.textContent).toBe('扫描返回结果');
    expect(modal.shadowRoot?.querySelector('.close-btn')?.getAttribute('aria-label')).toBe('关闭');
  });

  it('offers local video upload in the scan phase', () => {
    document.documentElement.lang = 'zh-CN';
    modal.open({ frames: ['ur:bytes/1-1/test'], action: 'import' });

    const scanBtn = modal.shadowRoot?.querySelector('.btn.primary') as HTMLButtonElement;
    scanBtn.click();

    const videoInput = modal.shadowRoot?.querySelector('.video-input') as HTMLInputElement;
    expect(videoInput).toBeTruthy();
    expect(videoInput.type).toBe('file');
    expect(videoInput.accept).toContain('video/mp4');
    expect(modal.shadowRoot?.querySelector('.upload-btn')?.textContent).toBe('上传手机录屏');
    expect(modal.shadowRoot?.querySelector('.upload-help')?.textContent).toContain(
      '视频仅在当前浏览器中解析',
    );
  });

  it('removes Escape listener after close', () => {
    let cancelCount = 0;
    modal.onCancel = () => { cancelCount++; };

    modal.open({ frames: ['ur:bytes/1-1/test'], action: 'sign' });
    modal.close();

    // Escape after close should NOT trigger cancel again
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cancelCount).toBe(0);
  });
});

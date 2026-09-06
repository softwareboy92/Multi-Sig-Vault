import { MODAL_STYLES } from './styles.js';
import { QRDisplay } from './qr-display.js';
import { QRScanner } from './qr-scanner.js';
import type { KeyVaultModalParams } from '../types.js';

type Phase = 'display' | 'scan';

type SupportedLocale = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko';

interface ModalMessages {
  titleSign: string;
  titleImport: string;
  displayHint: string;
  scanHint: string;
  noKeyVault: string;
  download: string;
  attestationTip: string;
  cancel: string;
  scanResult: string;
  back: string;
  close: string;
  cameraDenied: string;
  cameraError: string;
  uploadVideo: string;
  videoHelp: string;
  videoProcessing: string;
  videoIncomplete: string;
  videoUnsupported: string;
  videoTooLarge: string;
}

const MESSAGES: Record<SupportedLocale, ModalMessages> = {
  'zh-CN': {
    titleSign: '使用 KeyVault 签名',
    titleImport: '从 KeyVault 导入签名地址',
    displayHint: '请使用 KeyVault 扫描下方二维码以继续。',
    scanHint: '请将摄像头对准 KeyVault 返回的二维码。',
    noKeyVault: '还没有安装 KeyVault？',
    download: '下载 KeyVault',
    attestationTip: '扫描前，请在 KeyVault 设置中关闭“平台认证”。',
    cancel: '取消',
    scanResult: '扫描返回结果',
    back: '返回',
    close: '关闭',
    cameraDenied: '摄像头访问被拒绝，请允许摄像头权限后重试。',
    cameraError: '摄像头发生错误',
    uploadVideo: '上传手机录屏',
    videoHelp: '没有摄像头？请录制至少一个完整的动态二维码循环，视频仅在当前浏览器中解析。',
    videoProcessing: '正在本地解析录屏，请保持页面打开。',
    videoIncomplete: '视频结束时仍未收集完整数据，请上传时间更长、画面更清晰的录屏。',
    videoUnsupported: '无法读取该视频，请尝试 MP4、MOV 或 WebM 格式。',
    videoTooLarge: '视频文件不能超过 200 MB。',
  },
  'zh-TW': {
    titleSign: '使用 KeyVault 簽名',
    titleImport: '從 KeyVault 匯入簽名地址',
    displayHint: '請使用 KeyVault 掃描下方 QR Code 以繼續。',
    scanHint: '請將相機對準 KeyVault 返回的 QR Code。',
    noKeyVault: '尚未安裝 KeyVault？',
    download: '下載 KeyVault',
    attestationTip: '掃描前，請在 KeyVault 設定中關閉「平台認證」。',
    cancel: '取消',
    scanResult: '掃描返回結果',
    back: '返回',
    close: '關閉',
    cameraDenied: '相機存取遭拒，請允許相機權限後重試。',
    cameraError: '相機發生錯誤',
    uploadVideo: '上傳手機錄影',
    videoHelp: '沒有相機？請錄製至少一個完整的動態 QR Code 循環，影片僅在目前瀏覽器中解析。',
    videoProcessing: '正在本機解析錄影，請保持頁面開啟。',
    videoIncomplete: '影片結束時仍未收集完整資料，請上傳時間更長、畫面更清晰的錄影。',
    videoUnsupported: '無法讀取該影片，請嘗試 MP4、MOV 或 WebM 格式。',
    videoTooLarge: '影片檔案不能超過 200 MB。',
  },
  en: {
    titleSign: 'Sign with KeyVault',
    titleImport: 'Import Signer from KeyVault',
    displayHint: 'Scan the QR code below with KeyVault to continue.',
    scanHint: 'Point your camera at the QR code returned by KeyVault.',
    noKeyVault: 'Don’t have KeyVault yet?',
    download: 'Download KeyVault',
    attestationTip: 'Before scanning, disable “Platform Attestation” in KeyVault Settings.',
    cancel: 'Cancel',
    scanResult: 'Scan Result',
    back: 'Back',
    close: 'Close',
    cameraDenied: 'Camera access denied. Please allow camera permission and try again.',
    cameraError: 'Camera error',
    uploadVideo: 'Upload Phone Recording',
    videoHelp: 'No camera? Record at least one full animated QR cycle. The video is processed only in this browser.',
    videoProcessing: 'Processing the recording locally. Keep this page open.',
    videoIncomplete: 'The video ended before all data was collected. Upload a longer, clearer recording.',
    videoUnsupported: 'This video could not be read. Try MP4, MOV, or WebM.',
    videoTooLarge: 'The video file must be 200 MB or smaller.',
  },
  ja: {
    titleSign: 'KeyVaultで署名',
    titleImport: 'KeyVaultから署名アドレスをインポート',
    displayHint: 'KeyVaultで下のQRコードをスキャンして続行してください。',
    scanHint: 'KeyVaultから返されたQRコードにカメラを向けてください。',
    noKeyVault: 'KeyVaultをまだお持ちでない場合',
    download: 'KeyVaultをダウンロード',
    attestationTip: 'スキャン前に、KeyVaultの設定で「Platform Attestation」を無効にしてください。',
    cancel: 'キャンセル',
    scanResult: '結果をスキャン',
    back: '戻る',
    close: '閉じる',
    cameraDenied: 'カメラへのアクセスが拒否されました。権限を許可して再試行してください。',
    cameraError: 'カメラエラー',
    uploadVideo: 'スマートフォンの録画をアップロード',
    videoHelp: 'カメラがない場合は、動的QRコードを最低1周録画してください。動画はこのブラウザ内でのみ処理されます。',
    videoProcessing: '録画をローカルで解析しています。このページを開いたままにしてください。',
    videoIncomplete: 'すべてのデータを収集する前に動画が終了しました。より長く鮮明な録画をアップロードしてください。',
    videoUnsupported: 'この動画を読み込めません。MP4、MOV、またはWebMをお試しください。',
    videoTooLarge: '動画ファイルは200 MB以下にしてください。',
  },
  ko: {
    titleSign: 'KeyVault로 서명',
    titleImport: 'KeyVault에서 서명 주소 가져오기',
    displayHint: '계속하려면 KeyVault로 아래 QR 코드를 스캔하세요.',
    scanHint: 'KeyVault에서 반환된 QR 코드를 카메라로 비추세요.',
    noKeyVault: 'KeyVault가 아직 없으신가요?',
    download: 'KeyVault 다운로드',
    attestationTip: '스캔 전에 KeyVault 설정에서 “Platform Attestation”을 비활성화하세요.',
    cancel: '취소',
    scanResult: '결과 스캔',
    back: '뒤로',
    close: '닫기',
    cameraDenied: '카메라 접근이 거부되었습니다. 권한을 허용한 후 다시 시도하세요.',
    cameraError: '카메라 오류',
    uploadVideo: '휴대폰 화면 녹화 업로드',
    videoHelp: '카메라가 없다면 동적 QR 코드가 한 번 이상 완전히 반복되도록 녹화하세요. 영상은 이 브라우저에서만 처리됩니다.',
    videoProcessing: '화면 녹화를 로컬에서 분석 중입니다. 이 페이지를 열어 두세요.',
    videoIncomplete: '모든 데이터를 수집하기 전에 영상이 끝났습니다. 더 길고 선명한 녹화를 업로드하세요.',
    videoUnsupported: '이 영상을 읽을 수 없습니다. MP4, MOV 또는 WebM을 사용해 보세요.',
    videoTooLarge: '영상 파일은 200 MB 이하여야 합니다.',
  },
};

/**
 * Self-contained <keyvault-modal> Web Component with Shadow DOM.
 *
 * Two-phase flow:
 *   1. Display — animated QR code for the KeyVault device to scan
 *   2. Scan   — camera feed to read the KeyVault response QR
 *
 * Lifecycle: singleton pattern — open() / close() toggle visibility
 * without adding/removing from the DOM.
 */
export class KeyVaultModalElement extends HTMLElement {
  private shadow: ShadowRoot;
  private qrDisplay = new QRDisplay();
  private qrScanner = new QRScanner();
  private phase: Phase = 'display';
  private params: KeyVaultModalParams | null = null;
  private boundEscHandler: ((e: KeyboardEvent) => void) | null = null;

  /** Called when the scanner successfully decodes a complete result. */
  onResult: ((json: string) => void) | null = null;

  /** Called when the user cancels (button, Escape, or backdrop click). */
  onCancel: (() => void) | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `<style>${MODAL_STYLES}</style>`;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  open(params: KeyVaultModalParams): void {
    this.params = params;
    this.phase = 'display';
    this.renderPhase();
    this.classList.add('open');
    this.attachEscListener();
  }

  close(): void {
    this.classList.remove('open');
    this.qrDisplay.stop();
    this.qrScanner.stop();
    this.detachEscListener();
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  private renderPhase(): void {
    if (this.phase === 'display') {
      this.renderDisplayPhase();
    } else {
      this.renderScanPhase();
    }
  }

  private renderDisplayPhase(): void {
    if (!this.params) return;

    const messages = this.getMessages();
    const title = this.params.action === 'import' ? messages.titleImport : messages.titleSign;

    // Keep <style> and rebuild content
    this.clearContent();

    const backdrop = this.el('div', 'backdrop');
    backdrop.addEventListener('click', () => this.handleCancel());

    const card = this.createCard(title, messages);

    const body = this.el('div', 'modal-body');

    const qrWrap = this.el('div', 'qr-canvas');
    const canvas = document.createElement('canvas');
    qrWrap.appendChild(canvas);

    const counter = this.el('div', 'frame-counter');

    const hintEl = this.el('div', 'hint');
    hintEl.textContent = messages.displayHint;

    const guide = this.el('div', 'guide');
    const downloadRow = this.el('div', 'guide-row');
    const downloadLink = document.createElement('a');
    downloadLink.href = 'https://apps.apple.com/us/app/keyvault/id6504899031';
    downloadLink.target = '_blank';
    downloadLink.rel = 'noopener noreferrer';
    downloadLink.textContent = messages.download;
    downloadRow.append(document.createTextNode(`${messages.noKeyVault} `), downloadLink);
    const tip = this.el('div', 'guide-tip');
    tip.textContent = messages.attestationTip;
    guide.append(downloadRow, tip);

    const actions = this.el('div', 'actions');

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn ghost';
    cancelBtn.textContent = messages.cancel;
    cancelBtn.addEventListener('click', () => this.handleCancel());

    const scanBtn = document.createElement('button');
    scanBtn.className = 'btn primary';
    scanBtn.textContent = messages.scanResult;
    scanBtn.addEventListener('click', () => this.switchToScan());

    actions.appendChild(cancelBtn);
    actions.appendChild(scanBtn);

    body.append(qrWrap, counter, hintEl, guide, actions);
    card.appendChild(body);

    const container = this.el('div', 'container');
    container.appendChild(card);

    this.shadow.append(backdrop, container);

    // Start QR animation
    this.qrDisplay.start(canvas, counter, this.params.frames);
  }

  private renderScanPhase(): void {
    if (!this.params) return;

    const messages = this.getMessages();
    const title = this.params.action === 'import' ? messages.titleImport : messages.titleSign;

    this.clearContent();

    const backdrop = this.el('div', 'backdrop');
    backdrop.addEventListener('click', () => this.handleCancel());

    const card = this.createCard(title, messages);
    const body = this.el('div', 'modal-body');

    const camera = this.el('div', 'camera');
    const video = document.createElement('video');
    video.setAttribute('autoplay', '');
    video.setAttribute('playsinline', '');
    video.muted = true;
    camera.appendChild(video);

    const progressBar = this.el('div', 'progress-bar');
    const progressFill = this.el('div', 'progress-fill');
    progressFill.style.width = '0%';
    progressBar.appendChild(progressFill);

    const hintEl = this.el('div', 'hint');
    hintEl.textContent = messages.scanHint;

    const errorEl = this.el('div', 'error');
    errorEl.style.display = 'none';

    const uploadSection = this.el('div', 'upload-section');
    const uploadInput = document.createElement('input');
    uploadInput.className = 'video-input';
    uploadInput.type = 'file';
    uploadInput.accept = 'video/mp4,video/quicktime,video/webm,video/*';
    uploadInput.setAttribute('aria-label', messages.uploadVideo);

    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'btn secondary upload-btn';
    uploadBtn.type = 'button';
    uploadBtn.textContent = messages.uploadVideo;
    uploadBtn.addEventListener('click', () => uploadInput.click());

    const uploadHelp = this.el('div', 'upload-help');
    uploadHelp.textContent = messages.videoHelp;

    uploadInput.addEventListener('change', () => {
      const file = uploadInput.files?.[0];
      if (!file) return;

      if (file.size > 200 * 1024 * 1024) {
        errorEl.textContent = messages.videoTooLarge;
        errorEl.style.display = '';
        uploadInput.value = '';
        return;
      }

      errorEl.style.display = 'none';
      progressFill.style.width = '0%';
      hintEl.textContent = messages.videoProcessing;
      uploadBtn.textContent = file.name;
      uploadBtn.title = file.name;
      camera.classList.add('file-preview');
      void this.qrScanner.startFile(video, file);
    });

    uploadSection.append(uploadInput, uploadBtn, uploadHelp);

    const actions = this.el('div', 'actions');

    const backBtn = document.createElement('button');
    backBtn.className = 'btn ghost';
    backBtn.textContent = messages.back;
    backBtn.addEventListener('click', () => this.switchToDisplay());

    actions.appendChild(backBtn);

    body.append(camera, progressBar, hintEl, errorEl, uploadSection, actions);
    card.appendChild(body);

    const container = this.el('div', 'container');
    container.appendChild(card);

    this.shadow.append(backdrop, container);

    // Wire scanner callbacks
    this.qrScanner.onProgress = (progress: number) => {
      progressFill.style.width = `${Math.round(progress * 100)}%`;
    };
    this.qrScanner.onComplete = (json: string) => {
      this.onResult?.(json);
      this.close();
    };
    this.qrScanner.onError = (message: string) => {
      if (message === 'VIDEO_INCOMPLETE') {
        errorEl.textContent = messages.videoIncomplete;
      } else if (message === 'VIDEO_UNSUPPORTED') {
        errorEl.textContent = messages.videoUnsupported;
      } else if (message.startsWith('Camera access denied')) {
        errorEl.textContent = messages.cameraDenied;
      } else {
        errorEl.textContent = `${messages.cameraError}: ${message.replace(/^Camera error:\s*/, '')}`;
      }
      errorEl.style.display = '';
    };

    // Start camera
    this.qrScanner.start(video);
  }

  // ── Phase transitions ───────────────────────────────────────────────────

  private switchToScan(): void {
    this.qrDisplay.stop();
    this.phase = 'scan';
    this.renderPhase();
  }

  private switchToDisplay(): void {
    this.qrScanner.stop();
    this.phase = 'display';
    this.renderPhase();
  }

  // ── Cancellation ────────────────────────────────────────────────────────

  private handleCancel(): void {
    this.onCancel?.();
    this.close();
  }

  // ── Keyboard ────────────────────────────────────────────────────────────

  private attachEscListener(): void {
    this.detachEscListener();
    this.boundEscHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.handleCancel();
      }
    };
    document.addEventListener('keydown', this.boundEscHandler);
  }

  private detachEscListener(): void {
    if (this.boundEscHandler) {
      document.removeEventListener('keydown', this.boundEscHandler);
      this.boundEscHandler = null;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  /** Remove all children except the <style> element. */
  private clearContent(): void {
    const style = this.shadow.querySelector('style');
    this.shadow.innerHTML = '';
    if (style) this.shadow.appendChild(style);
  }

  /** Create an element with a class name. */
  private el(tag: string, className: string): HTMLElement {
    const el = document.createElement(tag);
    el.className = className;
    return el;
  }

  private getMessages(): ModalMessages {
    const language = document.documentElement.lang;
    if (language.toLowerCase().startsWith('zh-tw')) return MESSAGES['zh-TW'];
    if (language.toLowerCase().startsWith('zh')) return MESSAGES['zh-CN'];
    if (language.toLowerCase().startsWith('ja')) return MESSAGES.ja;
    if (language.toLowerCase().startsWith('ko')) return MESSAGES.ko;
    return MESSAGES.en;
  }

  private createCard(title: string, messages: ModalMessages): HTMLElement {
    const card = this.el('div', 'modal-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'keyvault-modal-title');

    const header = this.el('div', 'modal-header');
    const titleEl = this.el('h2', 'title');
    titleEl.id = 'keyvault-modal-title';
    titleEl.textContent = title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', messages.close);
    closeBtn.title = messages.close;
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => this.handleCancel());

    header.append(titleEl, closeBtn);
    card.appendChild(header);
    return card;
  }
}

// Register as custom element (singleton-safe)
if (!customElements.get('keyvault-modal')) {
  customElements.define('keyvault-modal', KeyVaultModalElement);
}

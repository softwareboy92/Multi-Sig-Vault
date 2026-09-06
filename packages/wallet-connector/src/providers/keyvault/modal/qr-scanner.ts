import jsQR from 'jsqr';
import { BcurDecoder } from '../bcur.js';

/**
 * QR scanner that captures frames from either a live camera or a local video
 * file, recognises them with jsQR, and reassembles BC-UR fountain-coded
 * payloads using BcurDecoder.
 *
 * Plain class (no React) — suitable for use inside Shadow DOM.
 */
export class QRScanner {
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private scanCanvas: HTMLCanvasElement;
  private scanCtx: CanvasRenderingContext2D;
  private decoder: BcurDecoder;
  private animFrameId: number | null = null;
  private completed = false;
  private objectUrl: string | null = null;
  private endedHandler: (() => void) | null = null;

  onProgress: ((progress: number) => void) | null = null;
  onComplete: ((json: string) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  constructor() {
    this.decoder = new BcurDecoder();
    this.scanCanvas = document.createElement('canvas');
    this.scanCtx = this.scanCanvas.getContext('2d')!;
  }

  async start(video: HTMLVideoElement): Promise<void> {
    this.stop();
    this.video = video;
    this.completed = false;
    this.decoder.reset();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      video.srcObject = this.stream;
      await video.play();
      this.scanLoop();
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        this.onError?.('Camera access denied. Please allow camera permission.');
      } else {
        this.onError?.(`Camera error: ${err.message}`);
      }
    }
  }

  async startFile(video: HTMLVideoElement, file: File): Promise<void> {
    this.stop();
    this.video = video;
    this.completed = false;
    this.decoder.reset();

    try {
      this.objectUrl = URL.createObjectURL(file);
      video.srcObject = null;
      video.src = this.objectUrl;
      video.muted = true;
      video.loop = false;
      video.playbackRate = 1;

      this.endedHandler = () => {
        if (!this.completed) {
          this.completed = true;
          this.onError?.('VIDEO_INCOMPLETE');
        }
      };
      video.addEventListener('ended', this.endedHandler);

      await video.play();
      this.scanLoop();
    } catch {
      this.completed = true;
      this.onError?.('VIDEO_UNSUPPORTED');
    }
  }

  stop(): void {
    this.completed = true;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) {
      if (this.endedHandler) {
        this.video.removeEventListener('ended', this.endedHandler);
      }
      this.video.pause();
      this.video.srcObject = null;
      this.video.removeAttribute('src');
      this.video.load();
      this.video = null;
    }
    this.endedHandler = null;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  reset(): void {
    this.decoder.reset();
    this.completed = false;
  }

  private scanLoop = (): void => {
    if (this.completed || !this.video) return;

    if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
      this.scanCanvas.width = this.video.videoWidth;
      this.scanCanvas.height = this.video.videoHeight;
      this.scanCtx.drawImage(this.video, 0, 0);
      const imageData = this.scanCtx.getImageData(
        0,
        0,
        this.scanCanvas.width,
        this.scanCanvas.height,
      );
      const qrCode = jsQR(imageData.data, imageData.width, imageData.height);

      if (qrCode?.data) {
        try {
          const frame = qrCode.data;
          if (frame.toLowerCase().startsWith('ur:')) {
            this.decoder.push(frame);
            this.onProgress?.(this.decoder.progress);

            if (this.decoder.isComplete()) {
              this.completed = true;
              const result = this.decoder.getResult();
              this.onComplete?.(result);
              return;
            }
          } else {
            // Plain QR code (non-UR) — return as-is
            this.completed = true;
            this.onComplete?.(frame);
            return;
          }
        } catch {
          // Ignore individual frame errors, continue scanning
        }
      }
    }

    this.animFrameId = requestAnimationFrame(this.scanLoop);
  };
}

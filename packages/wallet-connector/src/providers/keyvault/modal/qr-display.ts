import QRCode from 'qrcode';
import { ANIMATED_QR_INTERVAL_MS } from '../bcur.js';

export class QRDisplay {
  private canvas: HTMLCanvasElement | null = null;
  private counterEl: HTMLElement | null = null;
  private frames: string[] = [];
  private currentFrame = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  start(
    canvas: HTMLCanvasElement,
    counterEl: HTMLElement,
    frames: string[],
    interval = ANIMATED_QR_INTERVAL_MS,
  ): void {
    this.stop();
    this.canvas = canvas;
    this.counterEl = counterEl;
    this.frames = frames;
    this.currentFrame = 0;
    this.renderFrame();

    if (frames.length > 1) {
      this.intervalId = setInterval(() => {
        this.currentFrame = (this.currentFrame + 1) % this.frames.length;
        this.renderFrame();
      }, interval);
    }
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  reset(): void {
    this.stop();
    this.currentFrame = 0;
  }

  private renderFrame(): void {
    if (!this.canvas || this.frames.length === 0) return;
    const data = this.frames[this.currentFrame];
    QRCode.toCanvas(this.canvas, data, {
      width: 280,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'L',
    });
    if (this.counterEl) {
      this.counterEl.textContent = `${this.currentFrame + 1} / ${this.frames.length}`;
    }
  }
}

import { UREncoder, URDecoder, UR } from '@ngraveio/bc-ur';

/** Interval (ms) between animated QR frames during display. */
export const ANIMATED_QR_INTERVAL_MS = 200;

/**
 * Encode a JSON string into BC-UR fountain-coded frames
 * suitable for animated QR display.
 */
export function bcurEncode(json: string, maxFragmentLength = 200): string[] {
  const ur = UR.fromBuffer(Buffer.from(json, 'utf-8'));
  const encoder = new UREncoder(ur, maxFragmentLength);
  const frameCount = encoder.fragmentsLength;
  const frames: string[] = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push(encoder.nextPart());
  }
  return frames;
}

/**
 * Stateful decoder that collects scanned BC-UR QR frames
 * and reassembles them into the original JSON payload.
 *
 * Includes mixed-scan detection: if the expected frame count
 * changes mid-scan (user pointed camera at a different QR),
 * the decoder automatically resets.
 */
export class BcurDecoder {
  private decoder: URDecoder;
  private expectedParts: number | null = null;
  private _progress = 0;

  constructor() {
    this.decoder = new URDecoder();
  }

  /** Feed a single scanned QR frame string. */
  push(frame: string): void {
    this.decoder.receivePart(frame);

    // Mixed-scan detection: if expected part count changes, the user
    // is scanning a different payload — reset and re-feed this frame.
    const currentExpected = this.decoder.expectedPartCount();
    if (this.expectedParts !== null && currentExpected !== this.expectedParts) {
      this.reset();
      this.decoder.receivePart(frame);
    }
    this.expectedParts = this.decoder.expectedPartCount();

    this.updateProgress();
  }

  /** Whether all frames have been received and decoded. */
  isComplete(): boolean {
    return !!this.decoder.isComplete();
  }

  /** Decode progress from 0 (no frames) to 1 (complete). */
  get progress(): number {
    return this._progress;
  }

  /**
   * Return the decoded JSON string.
   * Must only be called after `isComplete()` returns true.
   */
  getResult(): string {
    const ur = this.decoder.resultUR();
    const decoded = ur.decodeCBOR();
    if (typeof decoded === 'string') return decoded;
    return decoded.toString();
  }

  /** Discard all state and start over. */
  reset(): void {
    this.decoder = new URDecoder();
    this.expectedParts = null;
    this._progress = 0;
  }

  // -----------------------------------------------------------
  // Internal
  // -----------------------------------------------------------

  private updateProgress(): void {
    if (this.decoder.isComplete()) {
      this._progress = 1;
      return;
    }

    const expected = this.expectedParts ?? 0;
    if (expected <= 0) {
      this._progress = 0;
      return;
    }

    // receivedPartIndexes() may return number[] or Set<number> depending
    // on the @ngraveio/bc-ur version; handle both.
    const parts = this.decoder.receivedPartIndexes();
    const received = Array.isArray(parts)
      ? parts.length
      : (parts as unknown as Set<number>).size;
    this._progress = Math.min(received / expected, 1);
  }
}

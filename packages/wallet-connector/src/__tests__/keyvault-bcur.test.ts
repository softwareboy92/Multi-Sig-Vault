import { describe, it, expect } from 'vitest';
import { bcurEncode, BcurDecoder } from '../providers/keyvault/bcur.js';

describe('bcur', () => {
  const testJson = JSON.stringify({ nxv_action: 'multi_sign', b_data: { chain_type: 'ETH' } });

  it('roundtrip: encode then decode recovers original JSON', () => {
    const frames = bcurEncode(testJson, 50);
    expect(frames.length).toBeGreaterThan(0);

    const decoder = new BcurDecoder();
    for (const frame of frames) {
      decoder.push(frame);
    }
    expect(decoder.isComplete()).toBe(true);
    expect(decoder.getResult()).toBe(testJson);
  });

  it('partial scan: not complete until all frames pushed', () => {
    const frames = bcurEncode(testJson, 20); // small fragments → many frames
    const decoder = new BcurDecoder();

    if (frames.length > 1) {
      decoder.push(frames[0]);
      expect(decoder.isComplete()).toBe(false);
      expect(decoder.progress).toBeGreaterThan(0);
      expect(decoder.progress).toBeLessThan(1);
    }
  });

  it('progress goes from 0 to 1', () => {
    const frames = bcurEncode(testJson, 20);
    const decoder = new BcurDecoder();
    expect(decoder.progress).toBe(0);

    for (const frame of frames) {
      decoder.push(frame);
    }
    expect(decoder.progress).toBe(1);
  });

  it('reset clears state', () => {
    const frames = bcurEncode(testJson, 50);
    const decoder = new BcurDecoder();
    decoder.push(frames[0]);
    decoder.reset();
    expect(decoder.progress).toBe(0);
    expect(decoder.isComplete()).toBe(false);
  });
});

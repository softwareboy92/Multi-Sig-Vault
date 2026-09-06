// ═══════════════════════════════════════════════════════════════════════════
// Event Emitter Tests
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WalletEventEmitter } from '../core/events.js';
import type { WalletEvent, WalletEventPayloads } from '../types/events.js';

// Testable subclass that exposes emit method
class TestableEventEmitter extends WalletEventEmitter {
  public testEmit<E extends WalletEvent>(
    event: E,
    payload: WalletEventPayloads[E]
  ): void {
    this.emit(event, payload);
  }
}

describe('WalletEventEmitter', () => {
  let emitter: TestableEventEmitter;

  beforeEach(() => {
    emitter = new TestableEventEmitter();
  });

  describe('on / emit', () => {
    it('should register and call event handler', () => {
      const handler = vi.fn();

      emitter.on('stateChange', handler);
      emitter.testEmit('stateChange', {
        previousState: 'IDLE',
        currentState: 'CONNECTING',
      });

      expect(handler).toHaveBeenCalledWith({
        previousState: 'IDLE',
        currentState: 'CONNECTING',
      });
    });

    it('should support multiple handlers for same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      emitter.on('stateChange', handler1);
      emitter.on('stateChange', handler2);
      emitter.testEmit('stateChange', {
        previousState: 'IDLE',
        currentState: 'CONNECTED',
      });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should pass correct payload to handler', () => {
      const handler = vi.fn();

      emitter.on('accountChange', handler);
      emitter.testEmit('accountChange', {
        previousAccount: null,
        currentAccount: {
          address: '0x123',
          chain: 'ETHEREUM',
          walletType: 'METAMASK',
        },
      });

      expect(handler).toHaveBeenCalledWith({
        previousAccount: null,
        currentAccount: {
          address: '0x123',
          chain: 'ETHEREUM',
          walletType: 'METAMASK',
        },
      });
    });
  });

  describe('off', () => {
    it('should remove event handler', () => {
      const handler = vi.fn();

      emitter.on('stateChange', handler);
      emitter.off('stateChange', handler);
      emitter.testEmit('stateChange', {
        previousState: 'IDLE',
        currentState: 'CONNECTING',
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should not affect other handlers when removing one', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      emitter.on('stateChange', handler1);
      emitter.on('stateChange', handler2);
      emitter.off('stateChange', handler1);
      emitter.testEmit('stateChange', {
        previousState: 'IDLE',
        currentState: 'CONNECTING',
      });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('once', () => {
    it('should call handler only once', () => {
      const handler = vi.fn();

      emitter.once('stateChange', handler);
      emitter.testEmit('stateChange', {
        previousState: 'IDLE',
        currentState: 'CONNECTING',
      });
      emitter.testEmit('stateChange', {
        previousState: 'CONNECTING',
        currentState: 'CONNECTED',
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        previousState: 'IDLE',
        currentState: 'CONNECTING',
      });
    });
  });

  describe('removeAllListeners', () => {
    it('should remove all listeners for a specific event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const disconnectHandler = vi.fn();

      emitter.on('stateChange', handler1);
      emitter.on('stateChange', handler2);
      emitter.on('disconnect', disconnectHandler);

      emitter.removeAllListeners('stateChange');

      emitter.testEmit('stateChange', {
        previousState: 'IDLE',
        currentState: 'CONNECTING',
      });
      emitter.testEmit('disconnect', { reason: 'user' });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
      expect(disconnectHandler).toHaveBeenCalled();
    });

    it('should remove all listeners when no event specified', () => {
      const stateHandler = vi.fn();
      const disconnectHandler = vi.fn();

      emitter.on('stateChange', stateHandler);
      emitter.on('disconnect', disconnectHandler);

      emitter.removeAllListeners();

      emitter.testEmit('stateChange', {
        previousState: 'IDLE',
        currentState: 'CONNECTING',
      });
      emitter.testEmit('disconnect', { reason: 'user' });

      expect(stateHandler).not.toHaveBeenCalled();
      expect(disconnectHandler).not.toHaveBeenCalled();
    });
  });

  describe('different event types', () => {
    it('should handle chainChange event', () => {
      const handler = vi.fn();

      emitter.on('chainChange', handler);
      emitter.testEmit('chainChange', {
        previousChainId: 1,
        currentChainId: 137,
      });

      expect(handler).toHaveBeenCalledWith({
        previousChainId: 1,
        currentChainId: 137,
      });
    });

    it('should handle disconnect event', () => {
      const handler = vi.fn();

      emitter.on('disconnect', handler);
      emitter.testEmit('disconnect', { reason: 'device' });

      expect(handler).toHaveBeenCalledWith({ reason: 'device' });
    });

    it('should handle error event', () => {
      const handler = vi.fn();
      const error = { error: { code: 1001, message: 'Test error' } };

      emitter.on('error', handler);
      emitter.testEmit('error', error as any);

      expect(handler).toHaveBeenCalledWith(error);
    });
  });
});

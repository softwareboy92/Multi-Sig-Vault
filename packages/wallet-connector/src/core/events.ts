// ═══════════════════════════════════════════════════════════════════════════
// @multivault/wallet-connector - Event Emitter
// ═══════════════════════════════════════════════════════════════════════════

import type {
  WalletEvent,
  WalletEventPayloads,
  WalletEventHandler,
} from '../types/events.js';

type ListenerFn = (payload: unknown) => void;

/**
 * Type-safe event emitter for wallet events
 */
export class WalletEventEmitter {
  private listeners: Map<WalletEvent, Set<ListenerFn>> = new Map();

  /**
   * Subscribe to an event
   */
  on<E extends WalletEvent>(event: E, handler: WalletEventHandler<E>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as ListenerFn);
  }

  /**
   * Unsubscribe from an event
   */
  off<E extends WalletEvent>(event: E, handler: WalletEventHandler<E>): void {
    this.listeners.get(event)?.delete(handler as ListenerFn);
  }

  /**
   * Subscribe to an event once
   */
  once<E extends WalletEvent>(event: E, handler: WalletEventHandler<E>): void {
    const wrapper = ((payload: WalletEventPayloads[E]) => {
      this.off(event, wrapper as WalletEventHandler<E>);
      handler(payload);
    }) as WalletEventHandler<E>;
    this.on(event, wrapper);
  }

  /**
   * Emit an event
   */
  protected emit<E extends WalletEvent>(
    event: E,
    payload: WalletEventPayloads[E]
  ): void {
    this.listeners.get(event)?.forEach((handler) => {
      try {
        handler(payload);
      } catch (err) {
        console.error(`Event handler error for ${event}:`, err);
      }
    });
  }

  /**
   * Remove all listeners
   */
  removeAllListeners(event?: WalletEvent): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get listener count for an event
   */
  listenerCount(event: WalletEvent): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

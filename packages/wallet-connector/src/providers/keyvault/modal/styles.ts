/**
 * Scoped CSS for the <keyvault-modal> Shadow DOM web component.
 *
 * Theme variables inherit through the host so the SDK modal follows the
 * consuming MultiVault application's active light, dark, tech, or matrix theme.
 */
export const MODAL_STYLES = `
  *,
  *::before,
  *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :host {
    display: none;
    font-family: var(--font-body, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    font-size: 14px;
    line-height: 1.5;
    color: var(--text, #1d1b17);
    -webkit-font-smoothing: antialiased;
  }

  :host(.open) {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 100000;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }

  .container {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--page-gutter, 24px);
    pointer-events: none;
  }

  .container > * {
    pointer-events: auto;
  }

  .modal-card {
    position: relative;
    display: flex;
    width: 100%;
    max-width: 440px;
    max-height: 88dvh;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border, rgba(37, 31, 20, 0.13));
    border-radius: var(--radius-modal, 14px);
    background: var(--panel, #fff);
    color: var(--text, #1d1b17);
    box-shadow: var(--shadow-overlay, 0 25px 50px -12px rgba(0, 0, 0, 0.25));
    animation: kv-scale-in 150ms ease-out;
  }

  .modal-header {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    border-bottom: 1px solid var(--border, rgba(37, 31, 20, 0.13));
    padding: var(--modal-padding, 20px);
  }

  .title {
    min-width: 0;
    color: var(--text, #1d1b17);
    font-size: 18px;
    font-weight: 700;
    line-height: 1.35;
  }

  .close-btn {
    display: inline-flex;
    width: 32px;
    height: 32px;
    flex: none;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border, rgba(37, 31, 20, 0.13));
    border-radius: var(--field-radius, 10px);
    background: transparent;
    color: var(--text, #1d1b17);
    cursor: pointer;
    font: inherit;
    font-size: 21px;
    line-height: 1;
    transition: background-color 150ms ease, border-color 150ms ease;
  }

  .close-btn:hover {
    border-color: color-mix(in srgb, var(--accent, #9a6b0f) 40%, var(--border));
    background: var(--row-head-bg, rgba(37, 31, 20, 0.05));
  }

  .modal-body {
    display: flex;
    min-height: 0;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    overflow-y: auto;
    padding: var(--modal-padding, 20px);
  }

  .hint {
    max-width: 340px;
    color: var(--muted, #706b61);
    font-size: 13px;
    line-height: 1.6;
    text-align: center;
  }

  .frame-counter {
    color: var(--muted, #706b61);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .guide {
    width: 100%;
    max-width: 360px;
    border: 1px solid var(--border, rgba(37, 31, 20, 0.13));
    border-radius: var(--field-radius, 10px);
    background: var(--surface, #f8f7f3);
    color: var(--muted, #706b61);
    font-size: 12px;
    line-height: 1.65;
    padding: 12px 14px;
    text-align: center;
  }

  .guide-row + .guide-tip {
    margin-top: 4px;
  }

  .guide a {
    color: var(--accent, #9a6b0f);
    font-weight: 700;
    text-decoration: none;
  }

  .guide a:hover {
    text-decoration: underline;
  }

  .qr-canvas {
    display: flex;
    width: min(100%, 320px);
    aspect-ratio: 1;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border, rgba(37, 31, 20, 0.13));
    border-radius: calc(var(--field-radius, 10px) + 2px);
    background: #fff;
    padding: 14px;
  }

  .qr-canvas canvas {
    display: block;
    width: 100% !important;
    max-width: 280px;
    height: auto !important;
  }

  .camera {
    position: relative;
    width: min(100%, 320px);
    aspect-ratio: 1;
    overflow: hidden;
    border: 1px solid var(--border, rgba(37, 31, 20, 0.13));
    border-radius: calc(var(--field-radius, 10px) + 2px);
    background: #000;
  }

  .camera::after {
    content: "";
    position: absolute;
    inset: 12%;
    border: 2px solid var(--accent, #9a6b0f);
    border-radius: var(--field-radius, 10px);
    box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.18);
    pointer-events: none;
  }

  .camera video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
  }

  .camera.file-preview video {
    transform: none;
  }

  .progress-bar {
    width: min(100%, 320px);
    height: 4px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--border, rgba(37, 31, 20, 0.13));
  }

  .progress-fill {
    height: 100%;
    border-radius: inherit;
    background: var(--accent, #9a6b0f);
    transition: width 300ms ease;
  }

  .error {
    width: 100%;
    border: 1px solid color-mix(in srgb, var(--danger, #ef4444) 30%, transparent);
    border-radius: var(--field-radius, 10px);
    background: color-mix(in srgb, var(--danger, #ef4444) 10%, transparent);
    color: var(--danger, #ef4444);
    font-size: 13px;
    padding: 10px 12px;
    text-align: center;
  }

  .upload-section {
    display: flex;
    width: 100%;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    border: 1px dashed color-mix(in srgb, var(--accent, #9a6b0f) 34%, var(--border));
    border-radius: var(--field-radius, 10px);
    background: var(--accent-soft, rgba(154, 107, 15, 0.09));
    padding: 12px;
  }

  .video-input {
    display: none;
  }

  .upload-btn {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .upload-help {
    max-width: 360px;
    color: var(--muted, #706b61);
    font-size: 12px;
    line-height: 1.55;
    text-align: center;
  }

  .actions {
    display: flex;
    width: 100%;
    justify-content: flex-end;
    gap: 10px;
    border-top: 1px solid var(--border, rgba(37, 31, 20, 0.13));
    margin-top: 2px;
    padding-top: 14px;
  }

  .btn {
    display: inline-flex;
    min-height: 40px;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border, rgba(37, 31, 20, 0.13));
    border-radius: var(--field-radius, 10px);
    padding: 9px 18px;
    color: var(--text, #1d1b17);
    cursor: pointer;
    font: inherit;
    font-weight: 700;
    line-height: 1.2;
    outline: none;
    transition: background-color 150ms ease, border-color 150ms ease,
      transform 100ms ease;
  }

  .btn:active {
    transform: scale(0.97);
  }

  .btn:focus-visible,
  .close-btn:focus-visible,
  .guide a:focus-visible {
    outline: 2px solid var(--accent, #9a6b0f);
    outline-offset: 2px;
  }

  .btn.primary {
    border-color: var(--accent, #9a6b0f);
    background: var(--accent, #9a6b0f);
    color: var(--on-accent, #fff);
  }

  .btn.primary:hover {
    border-color: var(--accent-2, #7d5509);
    background: var(--accent-2, #7d5509);
  }

  .btn.ghost {
    background: transparent;
  }

  .btn.secondary {
    border-color: var(--border, rgba(37, 31, 20, 0.13));
    background: var(--surface, #f8f7f3);
  }

  .btn.secondary:hover {
    border-color: color-mix(in srgb, var(--accent, #9a6b0f) 40%, var(--border));
    background: var(--row-head-bg, rgba(37, 31, 20, 0.05));
  }

  .btn.ghost:hover {
    background: var(--row-head-bg, rgba(37, 31, 20, 0.05));
  }

  @keyframes kv-scale-in {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @media (max-width: 480px) {
    .container {
      align-items: flex-end;
      padding: 12px;
    }

    .modal-card {
      max-width: 100%;
      max-height: calc(100dvh - 24px);
    }

    .modal-header,
    .modal-body {
      padding: 16px;
    }

    .title {
      font-size: 16px;
    }

    .qr-canvas,
    .camera {
      width: min(100%, 280px);
    }

    .actions {
      flex-direction: column-reverse;
    }

    .btn {
      width: 100%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .modal-card {
      animation: none;
    }

    .btn,
    .close-btn,
    .progress-fill {
      transition: none;
    }
  }
`;

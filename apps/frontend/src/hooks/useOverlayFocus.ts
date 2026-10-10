import { useEffect, useRef } from "react";

const overlayStack: symbol[] = [];
const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useOverlayFocus(isOpen: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const id = Symbol("overlay");
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    overlayStack.push(id);
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      if (overlayStack.at(-1) !== id) return;
      const first = panelRef.current?.querySelector<HTMLElement>(focusableSelector);
      (first ?? panelRef.current)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (overlayStack.at(-1) !== id) return;
      if (event.key === "Escape") {
        if (event.target instanceof Element && event.target.closest("[data-escape-handled]")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
      } else if (event.key === "Tab") {
        const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
          .filter((item) => item.getClientRects().length > 0);
        if (items.length === 0) {
          event.preventDefault();
          panelRef.current?.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown, true);
      const index = overlayStack.indexOf(id);
      if (index !== -1) overlayStack.splice(index, 1);
      if (overlayStack.length === 0) document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [isOpen]);

  return panelRef;
}

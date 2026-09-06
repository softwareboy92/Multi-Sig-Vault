import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useTransition } from "../../hooks/useTransition";
import { Button } from "../ui";
import type { GuideStep } from "./tourSteps";

const RESIZE_THROTTLE = 100;

interface GuideTourProps {
  steps: GuideStep[];
  isOpen: boolean;
  onComplete: () => void;
}

const HIGHLIGHT_PAD = 6;
const TOOLTIP_GAP = 16;
const TOOLTIP_W = 300;

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
  borderRadius: string;
}

export const GuideTour: React.FC<GuideTourProps> = ({
  steps,
  isOpen,
  onComplete,
}) => {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const { mounted, visible } = useTransition(isOpen, 200);
  const prevOpenRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const stableComplete = useCallback(() => onCompleteRef.current(), []);

  const current = steps[step];

  // ── Reset on open ──
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      setStep(0);
      setRect(null);
    }
    prevOpenRef.current = isOpen;
  }, [isOpen]);

  // ── Locate target element ──
  const locateTarget = useCallback(() => {
    if (!current) return;
    const el = document.querySelector<HTMLElement>(
      `[data-tour="${current.target}"]`,
    );
    if (el) {
      const r = el.getBoundingClientRect();
      setRect({
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
        bottom: r.bottom,
        right: r.right,
        borderRadius: getComputedStyle(el).borderRadius || "0px",
      });
      return true;
    }
    return false;
  }, [current]);

  useEffect(() => {
    if (!isOpen || !current) {
      setRect(null);
      return;
    }

    let retries = 0;
    let timer: ReturnType<typeof setTimeout>;

    const locate = () => {
      if (locateTarget()) return;
      if (retries < 3) {
        retries++;
        timer = setTimeout(locate, 300);
      } else {
        // Skip missing target
        if (step < steps.length - 1) setStep((s) => s + 1);
        else stableComplete();
      }
    };

    // Small delay for DOM to settle (esp. mobile sidebar open)
    timer = setTimeout(locate, 60);
    return () => clearTimeout(timer);
  }, [isOpen, current, step, steps.length, stableComplete, locateTarget]);

  // ── Refresh rect on resize / scroll ──
  useEffect(() => {
    if (!isOpen || !rect) return;
    let rafId = 0;
    let last = 0;
    const refresh = () => {
      const now = Date.now();
      if (now - last < RESIZE_THROTTLE) return;
      last = now;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => locateTarget());
    };
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [isOpen, rect, locateTarget]);

  // ── Navigation ──
  const next = useCallback(() => {
    if (step >= steps.length - 1) stableComplete();
    else setStep((s) => s + 1);
  }, [step, steps.length, stableComplete]);

  const prev = useCallback(() => {
    if (step > 0) setStep((s) => s - 1);
  }, [step]);

  // ── Keyboard ──
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "Escape") {
        e.preventDefault();
        stableComplete();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, next, prev, stableComplete]);

  // ── Lock scroll ──
  useEffect(() => {
    if (!isOpen) return;
    const sc = document.querySelector<HTMLElement>(".custom-scrollbar");
    if (sc) sc.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      if (sc) sc.style.overflow = "";
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // ── Mobile sidebar: open for sidebar steps, close for topbar steps ──
  useEffect(() => {
    if (!isOpen || window.innerWidth >= 1024) return;
    const needSidebar = current?.placement === "right";
    window.dispatchEvent(
      new Event(needSidebar ? "guide:open-sidebar" : "guide:close-sidebar"),
    );
    return () => {
      window.dispatchEvent(new Event("guide:close-sidebar"));
    };
  }, [isOpen, current]);

  if (!mounted || !current) return null;

  // ── clip-path overlay with hole ──
  const pad = HIGHLIGHT_PAD;
  const clipPath = rect
    ? (() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const x = rect.left - pad;
        const y = rect.top - pad;
        const w = rect.width + pad * 2;
        const h = rect.height + pad * 2;
        // Outer clockwise, inner counter-clockwise → hole via nonzero winding
        return `polygon(0px 0px,${vw}px 0px,${vw}px ${vh}px,0px ${vh}px,0px 0px,${x}px ${y}px,${x}px ${y + h}px,${x + w}px ${y + h}px,${x + w}px ${y}px,${x}px ${y}px)`;
      })()
    : undefined;

  // ── Tooltip position ──
  const tip: React.CSSProperties = {
    position: "fixed",
    zIndex: 1000,
    width: TOOLTIP_W,
    maxWidth: "calc(100vw - 24px)",
  };
  if (rect) {
    if (current.placement === "right") {
      tip.left = rect.right + TOOLTIP_GAP;
      tip.top = rect.top;
    } else {
      tip.top = rect.bottom + TOOLTIP_GAP;
      tip.left = Math.max(12, rect.right - TOOLTIP_W);
    }
  }

  return (
    <>
      {/* Dim overlay with clip-path hole */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(current.titleKey)}
        className={`fixed inset-0 transition-opacity duration-normal ${visible ? "opacity-100" : "opacity-0"}`}
        style={{
          zIndex: 998,
          background: "var(--guide-overlay, rgba(0,0,0,0.5))",
          clipPath,
        }}
        onClick={stableComplete}
      />

      {/* Highlight ring + click shield over target */}
      {rect && (
        <div
          className={`fixed cursor-pointer transition-all duration-normal ${visible ? "opacity-100" : "opacity-0"}`}
          style={{
            zIndex: 999,
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            borderRadius: rect.borderRadius,
            boxShadow: "0 0 0 3px var(--accent)",
          }}
          onClick={next}
        />
      )}

      {/* Tooltip */}
      <div
        role="tooltip"
        style={tip}
        className={`transition-all duration-normal ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"}`}
      >
        {/* Arrow */}
        {rect && current.placement === "right" && (
          <div
            className="absolute w-2.5 h-2.5 bg-[var(--surface)] border-l border-b border-[var(--border)] rotate-45"
            style={{ left: -6, top: 18 }}
          />
        )}
        {rect && current.placement === "bottom" && (
          <div
            className="absolute w-2.5 h-2.5 bg-[var(--surface)] border-l border-t border-[var(--border)] rotate-45"
            style={{ top: -6, right: 20 }}
          />
        )}

        {/* Card */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-modal)] shadow-[var(--shadow-overlay)] p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-[var(--text)]">
              {t(current.titleKey)}
            </h4>
            <span className="text-xs text-[var(--muted)] tabular-nums">
              {step + 1}/{steps.length}
            </span>
          </div>

          <p className="text-xs text-[var(--muted)] leading-relaxed mb-4">
            {t(current.descriptionKey)}
          </p>

          <div className="flex items-center justify-between">
            <button
              onClick={stableComplete}
              className="text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors"
            >
              {t("guide.skip")}
            </button>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <Button
                  variant="ghost"
                  onClick={prev}
                  className="!px-3 !py-1.5 !text-xs"
                >
                  {t("guide.prev")}
                </Button>
              )}
              <Button
                variant="primary"
                onClick={next}
                className="!px-3 !py-1.5 !text-xs"
              >
                {step === steps.length - 1
                  ? t("guide.done")
                  : t("guide.next")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

import React, { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useThemeStore } from "../../stores/useThemeStore.ts";
import { useLanguageStore } from "../../stores/useLanguageStore.ts";
import { useToastStore } from "../../stores/useToastStore.ts";
import { useGuideStore } from "../../stores/useGuideStore.ts";
import { useTransactionConfirmationWatcher } from "../../hooks/useTransactionConfirmationWatcher";
import { usePreferenceStore } from "../../stores/usePreferenceStore.ts";
import { Sidebar } from "./Sidebar.tsx";
import { Topbar } from "./Topbar.tsx";
import { ToastContainer } from "../ui/Toast.tsx";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { GuideTour, tourSteps } from "../guide";

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { theme } = useThemeStore();
  const { language } = useLanguageStore();
  const { toasts, removeToast } = useToastStore();
  const { tourCompleted, markTourCompleted } = useGuideStore();
  const uiScalePercent = usePreferenceStore((state) => state.uiScalePercent);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const location = useLocation();

  useTransactionConfirmationWatcher();

  // Auto-open tour on first visit
  useEffect(() => {
    if (!tourCompleted) {
      const timer = setTimeout(() => setTourOpen(true), 800);
      return () => clearTimeout(timer);
    }
  }, [tourCompleted]);

  const handleTourComplete = useCallback(() => {
    setTourOpen(false);
    markTourCompleted();
  }, [markTourCompleted]);

  // Sidebar events for mobile tour
  useEffect(() => {
    const openSidebar = () => setIsSidebarOpen(true);
    const closeSidebar = () => setIsSidebarOpen(false);
    window.addEventListener("guide:open-sidebar", openSidebar);
    window.addEventListener("guide:close-sidebar", closeSidebar);
    return () => {
      window.removeEventListener("guide:open-sidebar", openSidebar);
      window.removeEventListener("guide:close-sidebar", closeSidebar);
    };
  }, []);

  useEffect(() => {
    document.body.classList.remove("theme-dark", "theme-tech", "theme-matrix");
    if (theme === "dark") document.body.classList.add("theme-dark");
    if (theme === "tech") document.body.classList.add("theme-tech");
    if (theme === "matrix") document.body.classList.add("theme-matrix");
    document.documentElement.style.colorScheme =
      theme === "dark" || theme === "matrix" ? "dark" : "light";
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    const scale = uiScalePercent / 100;
    const root = document.documentElement;
    root.style.setProperty("--ui-font-min", `${15 * scale}px`);
    root.style.setProperty("--ui-font-base", `${12.5 * scale}px`);
    root.style.setProperty("--ui-font-vw", `${0.35 * scale}vw`);
    root.style.setProperty("--ui-font-max", `${17 * scale}px`);
  }, [uiScalePercent]);

  return (
    <div className="app-shell relative z-[1] w-full min-h-screen h-[100dvh] bg-[var(--bg)] flex overflow-hidden">
      <div
        className={`
        fixed inset-0 z-50 bg-black/50 transition-opacity lg:hidden
        ${
          isSidebarOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }
      `}
        onClick={() => setIsSidebarOpen(false)}
      />

      <div
        className={`
        fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 lg:relative lg:translate-x-0
        ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}
      >
        <div className="lg:sticky lg:top-0 lg:h-full">
          <Sidebar onClose={() => setIsSidebarOpen(false)} />
        </div>
      </div>

      <main className="flex-1 min-w-0 min-h-0 h-full flex flex-col overflow-hidden relative">
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar overscroll-contain [scrollbar-gutter:stable] [overflow-anchor:none]">
          <div
            className="mx-auto flex w-full max-w-[100rem] flex-col gap-[var(--section-gap)] px-[var(--page-gutter)] py-[var(--section-gap)] sm:w-[96%]"
          >
            <Topbar onMenuClick={() => setIsSidebarOpen(true)} />
            <ErrorBoundary key={location.key}>
              <div className="animate-fade-in contents">
                {children}
              </div>
            </ErrorBoundary>
          </div>
        </div>
      </main>
      
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <GuideTour
        steps={tourSteps}
        isOpen={tourOpen}
        onComplete={handleTourComplete}
      />
    </div>
  );
};

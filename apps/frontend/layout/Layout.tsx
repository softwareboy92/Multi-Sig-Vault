import React, { useEffect, useState } from "react";
import { useThemeStore } from "../../stores/useThemeStore.ts";
import { useToastStore } from "../../stores/useToastStore.ts";
import { Sidebar } from "./Sidebar.tsx";
import { Topbar } from "./Topbar.tsx";
import { ToastContainer } from "../ui/Toast.ts";

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { theme } = useThemeStore();
  const { toasts, removeToast } = useToastStore();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    if (theme === "dark") {
      document.body.classList.add("theme-dark");
    } else {
      document.body.classList.remove("theme-dark");
    }
  }, [theme]);

  return (
    <div className="relative z-[1] w-full lg:max-w-[1200px] lg:mx-auto lg:my-4 h-screen lg:h-[calc(100vh-32px)] bg-[var(--surface)] lg:rounded-2xl flex border border-[var(--border)] overflow-hidden">
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
        <Sidebar onClose={() => setIsSidebarOpen(false)} />
      </div>

      <main className="flex-1 p-4 lg:p-5 flex flex-col gap-4 min-h-0 overflow-hidden relative">
        <Topbar onMenuClick={() => setIsSidebarOpen(true)} />
        <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-auto">
          {children}
        </div>
      </main>
      
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
};

import React, { useEffect, useRef, useState } from "react";
import { useTransition } from "../../hooks/useTransition";

interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
}

export const Dropdown: React.FC<DropdownProps> = ({
  trigger,
  children,
  align = "right",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { mounted, visible } = useTransition(isOpen, 150);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <div onClick={() => setIsOpen(!isOpen)}>{trigger}</div>
      {mounted && (
        <div
          onClick={() => setIsOpen(false)}
          className={`
            overlay-surface absolute top-full mt-2 w-56 border border-[var(--border)]
            overlay-surface rounded-xl shadow-lg p-2 z-50 origin-top
            ${align === "right" ? "right-0" : "left-0"}
            ${visible ? "animate-scale-in" : "animate-scale-out"}
          `}
        >
          {children}
        </div>
      )}
    </div>
  );
};

interface DropdownItemProps {
  onClick: () => void;
  children: React.ReactNode;
}

export const DropdownItem: React.FC<DropdownItemProps> = ({
  onClick,
  children,
}) => {
  return (
    <div
      onClick={onClick}
      className="px-3 py-2.5 rounded-lg cursor-pointer hover:bg-[var(--row-head-bg)] border border-transparent hover:border-[var(--border)] transition-colors text-sm font-bold text-[var(--text)]"
    >
      {children}
    </div>
  );
};

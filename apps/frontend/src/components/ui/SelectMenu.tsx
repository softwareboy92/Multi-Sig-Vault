import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTransition } from "../../hooks/useTransition";

interface SelectMenuOption {
  value: string;
  label: string;
  icon?: string;
}

interface SelectMenuProps {
  label?: string;
  value: string;
  options: SelectMenuOption[];
  onChange: (value: string) => void;
  className?: string;
  menuClassName?: string;
  disabled?: boolean;
  placeholderValue?: string;
}

interface MenuPosition {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
}

export const SelectMenu: React.FC<SelectMenuProps> = ({
  label,
  value,
  options,
  onChange,
  className = "",
  menuClassName = "",
  disabled = false,
  placeholderValue,
}) => {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const isPlaceholder = placeholderValue !== undefined && value === placeholderValue;
  const { mounted: menuMounted, visible: menuVisible } = useTransition(open, 150);

  const selectedOption = useMemo(() => {
    return options.find((option) => option.value === value);
  }, [options, value]);

  const selectedLabel = selectedOption?.label || value;
  const selectedIcon = selectedOption?.icon;

  const updateMenuPosition = useCallback(() => {
    if (!buttonRef.current) return;

    const rect = buttonRef.current.getBoundingClientRect();
    const viewportPadding = 8;
    const menuGap = 8;
    const estimatedMenuHeight = Math.min(224, Math.max(52, options.length * 58));
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const shouldDropUp = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;
    const width = Math.min(rect.width, window.innerWidth - viewportPadding * 2);
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - width - viewportPadding,
    );

    setDropUp(shouldDropUp);
    setMenuPosition(
      shouldDropUp
        ? {
            left,
            width,
            bottom: window.innerHeight - rect.top + menuGap,
          }
        : {
            left,
            width,
            top: rect.bottom + menuGap,
          },
    );
  }, [options.length]);

  const renderLabel = (labelText: string) => {
    if (!labelText.includes("\n")) return <span>{labelText}</span>;
    const [title, ...rest] = labelText.split("\n");
    return (
      <span className="flex flex-col gap-1 text-left min-w-0">
        <span className="font-semibold text-[var(--font-body)] break-words whitespace-normal">{title}</span>
        <span className="text-[var(--font-small)] text-[var(--muted)] break-words whitespace-pre-wrap">{rest.join("\n")}</span>
      </span>
    );
  };

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const toggleOpen = () => {
    if (disabled) return;
    const next = !open;
    if (next) updateMenuPosition();
    setOpen(next);
  };

  const focusOption = (index: number) => {
    requestAnimationFrame(() => {
      menuRef.current?.querySelectorAll<HTMLButtonElement>("button[data-option]")[index]?.focus();
    });
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (!open) {
      updateMenuPosition();
      setOpen(true);
    }
    focusOption(event.key === "ArrowDown" ? 0 : options.length - 1);
  };

  const handleOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusOption((index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(event.key === "Home" ? 0 : options.length - 1);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="field">
      {label && <label className="field-label">{label}</label>}
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          onClick={toggleOpen}
          onKeyDown={handleTriggerKeyDown}
          aria-expanded={open}
          aria-controls={menuId}
          aria-haspopup="listbox"
          aria-label={label}
          disabled={disabled}
          className={`field-control w-full flex items-center justify-between gap-3 text-[var(--font-body)] ${
            isPlaceholder ? "select-placeholder text-[var(--field-muted)]" : "text-[var(--field-text)]"
          } ${className}`}
        >
          {selectedIcon && (
            <img src={selectedIcon} alt="" className="w-5 h-5 object-contain flex-shrink-0" />
          )}
          <span className={`flex-1 min-w-0 text-left ${selectedLabel.includes('\n') ? '' : 'truncate'}`}>{renderLabel(selectedLabel)}</span>
          <svg
            viewBox="0 0 24 24"
            className="w-4 h-4 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      {menuMounted && menuPosition && createPortal(
        <div
          id={menuId}
          data-escape-handled
          ref={menuRef}
          role="listbox"
          aria-label={label}
          style={menuPosition}
          className={`overlay-surface fixed z-[1000] max-h-56 overflow-y-auto rounded-xl border border-[var(--border)] shadow-[var(--shadow-overlay)] custom-scrollbar ${
            dropUp ? "origin-bottom" : "origin-top"
          } ${menuVisible ? "animate-scale-in" : "animate-scale-out"} ${menuClassName}`}
        >
          {options.map((option, idx) => (
            <button
              data-option
              role="option"
              aria-selected={option.value === value}
              key={`${idx}-${option.value}`}
              type="button"
              onKeyDown={(event) => handleOptionKeyDown(event, idx)}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                buttonRef.current?.focus();
              }}
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-[var(--font-body)] leading-tight transition-colors hover:bg-[var(--row-head-bg)] ${
                option.value === value
                  ? "font-semibold text-[var(--text)]"
                  : "select-option-muted"
              }`}
            >
              {option.icon && (
                <img src={option.icon} alt="" className="h-5 w-5 flex-shrink-0 object-contain" />
              )}
              <span className="min-w-0 flex-1">{renderLabel(option.label)}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
};

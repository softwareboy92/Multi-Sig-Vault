import React from "react";

interface TableProps {
  children: React.ReactNode;
  className?: string;
}

interface TableRowProps extends TableProps {
  onClick?: () => void;
}

interface TableCellProps {
  children: React.ReactNode;
  className?: string;
  align?: "left" | "center" | "right";
  colSpan?: number;
}

interface TableHeadProps extends TableCellProps {
  sortable?: boolean;
  sortKey?: string;
  sortDirection?: "asc" | "desc" | null;
  onSort?: (key: string) => void;
}

export const Table: React.FC<TableProps> = ({ children, className = "" }) => {
  return (
    <div className="overflow-x-auto rounded-[var(--field-radius)] border border-[var(--border)] bg-[var(--row-bg)]">
      <table className={`w-full text-[var(--table-font)] ${className}`}>{children}</table>
    </div>
  );
};

export const TableHead: React.FC<TableHeadProps> = ({
  children,
  className = "",
  align = "left",
  colSpan,
  sortable,
  sortKey,
  sortDirection,
  onSort,
}) => {
  const alignClass =
    align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";

  const handleClick = () => {
    if (sortable && sortKey && onSort) {
      onSort(sortKey);
    }
  };

  return (
    <th
      colSpan={colSpan}
      className={`px-[clamp(1rem,1.4vw,1.35rem)] py-4 text-[clamp(0.8rem,0.77rem+0.1vw,0.9rem)] font-bold text-[var(--row-head-text)] tracking-[0.02em] ${alignClass} ${
        sortable ? "cursor-pointer select-none hover:text-[var(--text)] transition-colors" : ""
      } ${className}`}
      onClick={sortable ? handleClick : undefined}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortable && sortDirection === "asc" && <span className="text-[var(--accent)]">▲</span>}
        {sortable && sortDirection === "desc" && <span className="text-[var(--accent)]">▼</span>}
        {sortable && sortDirection == null && <span className="opacity-0 group-hover:opacity-30">▲</span>}
      </span>
    </th>
  );
};

export const TableCell: React.FC<TableCellProps> = ({
  children,
  className = "",
  align = "left",
  colSpan,
}) => {
  const alignClass =
    align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
  return (
    <td
      colSpan={colSpan}
      className={`h-[var(--table-row-height)] px-[clamp(1rem,1.4vw,1.35rem)] align-middle text-[var(--table-font)] ${alignClass} ${className}`}
    >
      {children}
    </td>
  );
};

export const TableRow: React.FC<TableRowProps> = ({
  children,
  className = "",
  onClick,
}) => {
  const clickableClass = onClick
    ? "cursor-pointer hover:bg-[var(--row-head-bg)] active:bg-[var(--row-head-bg)]/80 transition-colors duration-fast"
    : "";

  return (
    <tr
      className={`border-b border-[var(--border)] last:border-0 h-[var(--table-row-height)] ${clickableClass} ${className}`}
      onClick={onClick}
      tabIndex={onClick ? 0 : undefined}
      role={onClick ? "link" : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {children}
    </tr>
  );
};

export const TableHeader: React.FC<TableProps> = ({ children, className = "" }) => {
  return <thead className={`bg-[var(--row-head-bg)] ${className}`}>{children}</thead>;
};

export const TableBody: React.FC<TableProps> = ({ children, className = "" }) => {
  return <tbody className={className}>{children}</tbody>;
};

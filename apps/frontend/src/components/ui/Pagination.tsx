import React from "react";
import { Button } from "./Button";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  prevLabel?: string;
  nextLabel?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  page,
  totalPages,
  onPageChange,
  prevLabel = "Prev",
  nextLabel = "Next",
}) => {
  return (
    <div className="mt-4 flex items-center justify-center gap-4 border-t border-[var(--border)] pt-4">
      <Button
        variant="ghost"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="min-w-20 px-4 py-2 text-sm"
      >
        {prevLabel}
      </Button>
      <span className="min-w-16 text-center text-sm font-semibold text-[var(--muted)]">
        {page} / {totalPages}
      </span>
      <Button
        variant="ghost"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="min-w-20 px-4 py-2 text-sm"
      >
        {nextLabel}
      </Button>
    </div>
  );
};

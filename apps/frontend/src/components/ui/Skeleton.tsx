import React from "react";

interface SkeletonProps {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = "" }) => {
  return (
    <div
      className={`bg-[var(--border)] rounded animate-shimmer ${className}`}
      style={{
        background:
          "linear-gradient(90deg, var(--border) 0%, var(--row-head-bg) 50%, var(--border) 100%)",
        backgroundSize: "200% 100%",
      }}
    />
  );
};

/**
 * Table skeleton loader
 */
export const TableSkeleton: React.FC<{
  rows?: number;
  columns?: number;
}> = ({ rows = 5, columns = 4 }) => {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton key={colIndex} className="h-10 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
};

/**
 * Card skeleton loader
 */
export const CardSkeleton: React.FC<{
  count?: number;
}> = ({ count = 3 }) => {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="p-6 rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--surface)]"
        >
          <Skeleton className="h-6 w-1/3 mb-4" />
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
};

/**
 * List skeleton loader
 */
export const ListSkeleton: React.FC<{
  rows?: number;
}> = ({ rows = 5 }) => {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="p-4 rounded-[var(--radius-modal)] border border-[var(--border)] flex items-center justify-between"
        >
          <div className="flex-1">
            <Skeleton className="h-5 w-1/4 mb-2" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  );
};

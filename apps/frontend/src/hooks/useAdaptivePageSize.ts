import { useState, useEffect, useRef } from "react";

interface UseAdaptivePageSizeOptions {
  /** Estimated row height in pixels (default: 65) */
  rowHeight?: number;
  /** Minimum page size (default: 5) */
  minPageSize?: number;
  /** Maximum page size (default: 50) */
  maxPageSize?: number;
  /** Fixed height offset to subtract (toolbar, pagination, etc.) in pixels (default: 200) */
  fixedOffset?: number;
  /** Extra safety offset to avoid tiny overflow scroll (default: 24) */
  safetyOffset?: number;
}

/**
 * Calculate adaptive page size based on available viewport height
 * This hook dynamically adjusts the number of items per page to fit the screen
 * and avoid scrollbars when possible
 */
export function useAdaptivePageSize(options: UseAdaptivePageSizeOptions = {}) {
  const {
    rowHeight = 65,
    minPageSize = 5,
    maxPageSize = 50,
    fixedOffset = 200,
    safetyOffset = 24,
  } = options;

  const [pageSize, setPageSize] = useState(10);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const calculatePageSize = () => {
      // Get available height
      const availableHeight = window.innerHeight;
      
      // Calculate usable height for table rows
      // Subtract: fixed offset (toolbar, pagination, card padding, etc.)
      const usableHeight = availableHeight - fixedOffset - safetyOffset;

      // Calculate how many rows can fit
      const calculatedSize = Math.floor(usableHeight / rowHeight);
      
      // Clamp to min/max range
      const finalSize = Math.max(minPageSize, Math.min(maxPageSize, calculatedSize));
      
      setPageSize(finalSize);
    };

    // Calculate initially
    calculatePageSize();

    // Recalculate on window resize
    window.addEventListener("resize", calculatePageSize);
    
    return () => {
      window.removeEventListener("resize", calculatePageSize);
    };
  }, [rowHeight, minPageSize, maxPageSize, fixedOffset, safetyOffset]);

  return { pageSize, containerRef };
}

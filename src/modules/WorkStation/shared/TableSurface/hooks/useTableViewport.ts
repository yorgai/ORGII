import {
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  TABLE_DEFAULT_COLUMN_WIDTH,
  TABLE_HEADER_HEIGHT,
  TABLE_OVERSCAN,
  TABLE_ROW_HEIGHT,
  TABLE_ROW_NUMBER_WIDTH,
} from "../tableSurfaceUtils";
import type { TableCellAddress, TableSurfaceColumn } from "../types";

interface UseTableViewportArgs {
  rowCount: number;
  columns: TableSurfaceColumn[];
}

export function useTableViewport({ rowCount, columns }: UseTableViewportArgs) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });

  const columnOffsets = useMemo(
    () =>
      columns.reduce<number[]>((offsets, column, index) => {
        const previousOffset = offsets[index - 1] ?? TABLE_ROW_NUMBER_WIDTH;
        const previousWidth =
          index === 0
            ? 0
            : (columns[index - 1]?.width ?? TABLE_DEFAULT_COLUMN_WIDTH);
        return [...offsets, previousOffset + previousWidth];
      }, []),
    [columns]
  );

  const totalWidth = useMemo(() => {
    return (
      TABLE_ROW_NUMBER_WIDTH +
      columns.reduce(
        (total, column) => total + (column.width ?? TABLE_DEFAULT_COLUMN_WIDTH),
        0
      )
    );
  }, [columns]);

  const totalHeight = TABLE_HEADER_HEIGHT + rowCount * TABLE_ROW_HEIGHT;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateSize = () => {
      setViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      });
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(viewport);
    return () => resizeObserver.disconnect();
  }, []);

  const visibleRowStart = Math.max(
    0,
    Math.floor(scrollTop / TABLE_ROW_HEIGHT) - TABLE_OVERSCAN
  );
  const visibleRowEnd = Math.min(
    rowCount - 1,
    Math.ceil(
      (scrollTop + viewportSize.height - TABLE_HEADER_HEIGHT) / TABLE_ROW_HEIGHT
    ) + TABLE_OVERSCAN
  );

  const visibleColumnIndexes = useMemo(() => {
    const left = scrollLeft + TABLE_ROW_NUMBER_WIDTH;
    const right = scrollLeft + viewportSize.width;
    return columns
      .map((column, index) => ({ column, index }))
      .filter(({ column, index }) => {
        const columnLeft = columnOffsets[index] ?? TABLE_ROW_NUMBER_WIDTH;
        const columnRight =
          columnLeft + (column.width ?? TABLE_DEFAULT_COLUMN_WIDTH);
        return (
          columnRight >= left - TABLE_DEFAULT_COLUMN_WIDTH * TABLE_OVERSCAN &&
          columnLeft <= right + TABLE_DEFAULT_COLUMN_WIDTH * TABLE_OVERSCAN
        );
      })
      .map(({ index }) => index);
  }, [columnOffsets, columns, scrollLeft, viewportSize.width]);

  const visibleRows = useMemo(
    () =>
      Array.from(
        { length: Math.max(0, visibleRowEnd - visibleRowStart + 1) },
        (_, index) => visibleRowStart + index
      ),
    [visibleRowEnd, visibleRowStart]
  );

  const focusViewport = useCallback(() => {
    viewportRef.current?.focus({ preventScroll: true });
  }, []);

  const scrollCellIntoView = useCallback(
    (cell: TableCellAddress) => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const cellTop = TABLE_HEADER_HEIGHT + cell.rowIndex * TABLE_ROW_HEIGHT;
      const cellBottom = cellTop + TABLE_ROW_HEIGHT;
      const cellLeft =
        columnOffsets[cell.columnIndex] ?? TABLE_ROW_NUMBER_WIDTH;
      const cellRight =
        cellLeft +
        (columns[cell.columnIndex]?.width ?? TABLE_DEFAULT_COLUMN_WIDTH);

      if (cellTop < viewport.scrollTop + TABLE_HEADER_HEIGHT) {
        viewport.scrollTop = Math.max(0, cellTop - TABLE_HEADER_HEIGHT);
      } else if (cellBottom > viewport.scrollTop + viewport.clientHeight) {
        viewport.scrollTop = cellBottom - viewport.clientHeight;
      }

      if (cellLeft < viewport.scrollLeft + TABLE_ROW_NUMBER_WIDTH) {
        viewport.scrollLeft = Math.max(0, cellLeft - TABLE_ROW_NUMBER_WIDTH);
      } else if (cellRight > viewport.scrollLeft + viewport.clientWidth) {
        viewport.scrollLeft = cellRight - viewport.clientWidth;
      }
    },
    [columnOffsets, columns]
  );

  const handleViewportScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
    setScrollLeft(event.currentTarget.scrollLeft);
    setViewportSize({
      width: event.currentTarget.clientWidth,
      height: event.currentTarget.clientHeight,
    });
  }, []);

  return {
    viewportRef,
    scrollTop,
    scrollLeft,
    viewportSize,
    visibleRows,
    visibleColumnIndexes,
    columnOffsets,
    totalWidth,
    totalHeight,
    focusViewport,
    scrollCellIntoView,
    handleViewportScroll,
  };
}

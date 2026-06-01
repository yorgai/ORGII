import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type React from "react";

import { TableSurfaceFooter } from "./TableSurfaceFooter";
import { useTableClipboard } from "./hooks/useTableClipboard";
import { useTableEditing } from "./hooks/useTableEditing";
import { useTableSelection } from "./hooks/useTableSelection";
import { useTableViewport } from "./hooks/useTableViewport";
import {
  TABLE_DEFAULT_COLUMN_WIDTH,
  TABLE_HEADER_HEIGHT,
  TABLE_ROW_HEIGHT,
  TABLE_ROW_NUMBER_WIDTH,
  type TableNavigationDirection,
  defaultFormatTableCellValue,
  getTableCellAfterMove,
  getTablePrintableCharacter,
  isCellInTableRange,
  tableCellKey,
  tableColumnLabel,
  tableRange,
} from "./tableSurfaceUtils";
import type {
  TableCellAddress,
  TableCellRange,
  TableSurfaceColumn,
  TableSurfacePagination,
  TableSurfaceRow,
  TableSurfaceSortState,
} from "./types";

interface VirtualTableGridProps {
  columns: TableSurfaceColumn[];
  rows: TableSurfaceRow[];
  editable: boolean;
  hasMoreRows: boolean;
  loadingMoreRows: boolean;
  pagination?: TableSurfacePagination;
  sortState?: TableSurfaceSortState;
  onSortColumn?: (columnId: string) => void;
  formatCellValue?: (value: unknown, address: TableCellAddress) => string;
  getCellClassName?: (
    address: TableCellAddress,
    value: unknown
  ) => string | undefined;
  onCellChange?: (address: TableCellAddress, value: string) => void;
  onPasteCells?: (
    address: TableCellAddress,
    values: string[][],
    activeRange: TableCellRange | null
  ) => void;
  onClearRange?: (range: TableCellRange) => void;
  onLoadMoreRows?: () => void | Promise<void>;
  onActiveCellChange: (
    label: string,
    value: string,
    updateValue: (value: string) => void
  ) => void;
}

export function VirtualTableGrid({
  columns,
  rows,
  editable,
  hasMoreRows,
  loadingMoreRows,
  pagination,
  sortState,
  onSortColumn,
  formatCellValue = defaultFormatTableCellValue,
  getCellClassName,
  onCellChange,
  onPasteCells,
  onClearRange,
  onLoadMoreRows,
  onActiveCellChange,
}: VirtualTableGridProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draggingSelection, setDraggingSelection] = useState(false);
  const rowCount = rows.length;
  const columnCount = columns.length;
  const {
    viewportRef,
    scrollTop,
    scrollLeft,
    viewportSize,
    visibleRows,
    visibleColumnIndexes,
    columnOffsets,
    totalWidth,
    focusViewport,
    scrollCellIntoView,
    handleViewportScroll,
  } = useTableViewport({ rowCount, columns });

  const getCellValue = useCallback(
    (cell: TableCellAddress) =>
      formatCellValue(rows[cell.rowIndex]?.cells[cell.columnIndex], cell),
    [formatCellValue, rows]
  );

  const selection = useTableSelection({
    rowCount,
    columnCount,
    onRevealCell: scrollCellIntoView,
  });

  const editing = useTableEditing({
    editable,
    rowCount,
    columnCount,
    getCellValue,
    onCellChange,
    onSelectCell: selection.selectCell,
    onFocusViewport: focusViewport,
  });

  const moveActiveCell = useCallback(
    (direction: TableNavigationDirection) => {
      const sourceCell = selection.activeCell ?? {
        rowIndex: 0,
        columnIndex: 0,
      };
      selection.selectCell(
        getTableCellAfterMove(sourceCell, direction, rowCount, columnCount)
      );
    },
    [columnCount, rowCount, selection]
  );

  const extendSelection = useCallback(
    (direction: TableNavigationDirection) => {
      const sourceCell = selection.activeCell ?? {
        rowIndex: 0,
        columnIndex: 0,
      };
      selection.extendSelectionTo(
        getTableCellAfterMove(sourceCell, direction, rowCount, columnCount)
      );
    },
    [columnCount, rowCount, selection]
  );

  const handleClearRange = useCallback(() => {
    const activeRange = selection.getActiveRange();
    if (!editable || !activeRange || !onClearRange) return;
    onClearRange(activeRange);
  }, [editable, onClearRange, selection]);

  const clipboard = useTableClipboard({
    editable,
    activeCell: selection.activeCell,
    getActiveRange: selection.getActiveRange,
    getCellValue,
    onPasteCells,
  });

  const handleCellPointerDown = useCallback(
    (cell: TableCellAddress, event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      if (editing.editingCell) {
        editing.updateCellValue(editing.editingCell, editing.draftValue);
      }
      setDraggingSelection(true);
      editing.resetEditing();
      selection.setActiveCell(cell);
      selection.setSelectionAnchor(cell);
      selection.setSelectionRange(tableRange(cell, cell));
      focusViewport();
    },
    [editing, focusViewport, selection]
  );

  const handleCellPointerEnter = useCallback(
    (cell: TableCellAddress) => {
      if (!draggingSelection || !selection.selectionAnchor) return;
      selection.setActiveCell(cell);
      selection.setSelectionRange(tableRange(selection.selectionAnchor, cell));
    },
    [draggingSelection, selection]
  );

  const handleViewportKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (editing.editingCell) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const endCell = {
          rowIndex: Math.max(0, rowCount - 1),
          columnIndex: Math.max(0, columnCount - 1),
        };
        selection.setActiveCell(endCell);
        selection.setSelectionAnchor({ rowIndex: 0, columnIndex: 0 });
        selection.setSelectionRange(
          tableRange({ rowIndex: 0, columnIndex: 0 }, endCell)
        );
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const navigationByKey: Record<string, TableNavigationDirection> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const direction = navigationByKey[event.key];
      if (direction) {
        event.preventDefault();
        if (event.shiftKey) extendSelection(direction);
        else moveActiveCell(direction);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        editing.startEditing(
          selection.activeCell ?? { rowIndex: 0, columnIndex: 0 }
        );
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        moveActiveCell(event.shiftKey ? "left" : "right");
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        selection.activeCell &&
        editable
      ) {
        event.preventDefault();
        handleClearRange();
        return;
      }

      const printableCharacter = getTablePrintableCharacter(event.key);
      if (printableCharacter && selection.activeCell && editable) {
        event.preventDefault();
        editing.startEditing(selection.activeCell, printableCharacter);
      }
    },
    [
      columnCount,
      editable,
      editing,
      extendSelection,
      handleClearRange,
      moveActiveCell,
      rowCount,
      selection,
    ]
  );

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (!editing.editingCell) return;
      const input = event.currentTarget;
      const valueLength = input.value.length;
      const selectionStart = input.selectionStart ?? 0;
      const selectionEnd = input.selectionEnd ?? 0;
      const hasSelection = selectionStart !== selectionEnd;

      const commitMove = (direction: TableNavigationDirection) => {
        event.preventDefault();
        editing.commitEditing(
          getTableCellAfterMove(
            editing.editingCell!,
            direction,
            rowCount,
            columnCount
          )
        );
      };

      if (event.key === "Escape") {
        event.preventDefault();
        editing.cancelEditing();
        return;
      }
      if (event.key === "Enter") return commitMove("down");
      if (event.key === "Tab")
        return commitMove(event.shiftKey ? "left" : "right");
      if (event.key === "ArrowUp") return commitMove("up");
      if (event.key === "ArrowDown") return commitMove("down");
      if (event.key === "ArrowLeft" && !hasSelection && selectionStart === 0) {
        return commitMove("left");
      }
      if (
        event.key === "ArrowRight" &&
        !hasSelection &&
        selectionEnd === valueLength
      ) {
        commitMove("right");
      }
    },
    [columnCount, editing, rowCount]
  );

  useEffect(() => {
    if (!editing.editingCell) return;
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      input?.focus();
      if (editing.selectDraftOnFocus) {
        input?.select();
      } else {
        const cursorPosition = input?.value.length ?? 0;
        input?.setSelectionRange(cursorPosition, cursorPosition);
      }
    });
  }, [editing.editingCell, editing.selectDraftOnFocus]);

  useEffect(() => {
    if (!draggingSelection || !selection.selectionAnchor) return;

    const handlePointerUp = () => setDraggingSelection(false);
    window.addEventListener("pointerup", handlePointerUp, { passive: false });
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, [draggingSelection, selection.selectionAnchor]);

  useEffect(() => {
    const activeCell = selection.activeCell;
    if (!activeCell) {
      onActiveCellChange("", "", () => undefined);
      return;
    }

    const isEditingActiveCell = editing.editingCell
      ? tableCellKey(editing.editingCell) === tableCellKey(activeCell)
      : false;
    const value = isEditingActiveCell
      ? editing.draftValue
      : getCellValue(activeCell);

    onActiveCellChange(
      `${tableColumnLabel(activeCell.columnIndex)}${activeCell.rowIndex + 1}`,
      value,
      (nextValue) => {
        if (isEditingActiveCell) {
          editing.setDraftValue(nextValue);
        }
        editing.updateCellValue(activeCell, nextValue);
      }
    );
  }, [
    editing,
    editing.draftValue,
    editing.editingCell,
    editing.setDraftValue,
    editing.updateCellValue,
    getCellValue,
    onActiveCellChange,
    selection.activeCell,
  ]);

  const loadMoreTop = TABLE_HEADER_HEIGHT + rowCount * TABLE_ROW_HEIGHT;
  const totalHeight = loadMoreTop + (hasMoreRows ? TABLE_ROW_HEIGHT : 0);

  return (
    <div
      ref={viewportRef}
      className="table-surface__viewport min-h-0 flex-1"
      tabIndex={0}
      onScroll={handleViewportScroll}
      onKeyDown={handleViewportKeyDown}
      onCopy={clipboard.handleCopy}
      onPaste={clipboard.handlePaste}
    >
      <div
        className="table-surface__canvas"
        style={{ width: totalWidth, height: totalHeight }}
      >
        <div
          className="table-surface__corner-cell"
          style={{
            width: TABLE_ROW_NUMBER_WIDTH,
            height: TABLE_HEADER_HEIGHT,
            transform: `translate3d(${scrollLeft}px, ${scrollTop}px, 0)`,
          }}
        />

        {visibleColumnIndexes.map((columnIndex) => {
          const column = columns[columnIndex];
          const sorted = sortState?.columnId === column.id;
          return (
            <button
              key={`header-${column.id}`}
              type="button"
              className={[
                "table-surface__column-header",
                onSortColumn ? "table-surface__column-header--sortable" : null,
                sorted ? "table-surface__column-header--sorted" : null,
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                width: column.width ?? TABLE_DEFAULT_COLUMN_WIDTH,
                height: TABLE_HEADER_HEIGHT,
                transform: `translate3d(${columnOffsets[columnIndex]}px, ${scrollTop}px, 0)`,
              }}
              title={column.metaLabel}
              onClick={() => onSortColumn?.(column.id)}
            >
              <span className="table-surface__column-header-label">
                {column.label}
              </span>
              {column.badge && (
                <span className="table-surface__column-badge">
                  {column.badge}
                </span>
              )}
              {sorted && (
                <span className="table-surface__sort-indicator">
                  {sortState.direction === "asc" ? "↑" : "↓"}
                </span>
              )}
            </button>
          );
        })}

        {visibleRows.map((rowIndex) => (
          <div
            key={`row-${rows[rowIndex]?.id ?? rowIndex}`}
            className="table-surface__row-header"
            style={{
              width: TABLE_ROW_NUMBER_WIDTH,
              height: TABLE_ROW_HEIGHT,
              transform: `translate3d(${scrollLeft}px, ${TABLE_HEADER_HEIGHT + rowIndex * TABLE_ROW_HEIGHT}px, 0)`,
            }}
          >
            {rowIndex + 1}
          </div>
        ))}

        {visibleRows.map((rowIndex) =>
          visibleColumnIndexes.map((columnIndex) => {
            const cell = { rowIndex, columnIndex };
            const value = rows[rowIndex]?.cells[columnIndex];
            const isActive = selection.activeCell
              ? tableCellKey(selection.activeCell) === tableCellKey(cell)
              : false;
            const isEditing = editing.editingCell
              ? tableCellKey(editing.editingCell) === tableCellKey(cell)
              : false;
            const isSelected = selection.selectionRange
              ? isCellInTableRange(cell, selection.selectionRange)
              : false;
            return (
              <div
                key={`${rowIndex}-${columns[columnIndex]?.id ?? columnIndex}`}
                className={[
                  "table-surface__cell",
                  isSelected ? "table-surface__cell--selected" : null,
                  isActive ? "table-surface__cell--active" : null,
                  isEditing ? "table-surface__cell--editing" : null,
                  getCellClassName?.(cell, value),
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{
                  width:
                    columns[columnIndex]?.width ?? TABLE_DEFAULT_COLUMN_WIDTH,
                  height: TABLE_ROW_HEIGHT,
                  transform: `translate3d(${columnOffsets[columnIndex]}px, ${TABLE_HEADER_HEIGHT + rowIndex * TABLE_ROW_HEIGHT}px, 0)`,
                }}
                onPointerDown={(event) => handleCellPointerDown(cell, event)}
                onPointerEnter={() => handleCellPointerEnter(cell)}
                onDoubleClick={() => editing.startEditing(cell)}
              >
                {isEditing ? (
                  <input
                    ref={inputRef}
                    className="table-surface__cell-input"
                    value={editing.draftValue}
                    readOnly={!editable}
                    onChange={(event) =>
                      editing.setDraftValue(event.target.value)
                    }
                    onKeyDown={handleInputKeyDown}
                    onPointerDown={(event) => event.stopPropagation()}
                    onBlur={() => editing.commitEditing()}
                  />
                ) : (
                  <span className="table-surface__cell-text">
                    {formatCellValue(value, cell)}
                  </span>
                )}
              </div>
            );
          })
        )}

        <TableSurfaceFooter
          hasMoreRows={hasMoreRows}
          loadingMoreRows={loadingMoreRows}
          loadMoreTop={loadMoreTop}
          scrollLeft={scrollLeft}
          viewportWidth={viewportSize.width}
          pagination={pagination}
          onLoadMoreRows={onLoadMoreRows}
        />
      </div>
    </div>
  );
}

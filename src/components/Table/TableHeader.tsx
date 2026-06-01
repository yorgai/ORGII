import { Header, HeaderGroup, flexRender } from "@tanstack/react-table";

import { SortIcon } from "./helpers";
import type { ColumnMeta } from "./types";

interface TableHeaderProps<T> {
  headerGroups: HeaderGroup<T>[];
  hasExpandable: boolean;
  columnWidths?: number[];
}

export function TableHeader<T>({
  headerGroups,
  hasExpandable,
  columnWidths,
}: TableHeaderProps<T>) {
  return (
    <thead className="table-thead">
      {headerGroups.map((headerGroup) => (
        <tr key={headerGroup.id}>
          {hasExpandable && <th className="table-th" style={{ width: 32 }} />}
          {headerGroup.headers.map((header: Header<T, unknown>, index) => {
            const meta = header.column.columnDef.meta as ColumnMeta | undefined;
            const thHideClass = meta?.hideBelow
              ? `table-col-hide-${meta.hideBelow}`
              : "";
            return (
              <th
                key={header.id}
                style={{
                  width:
                    columnWidths?.[index] ?? meta?.width ?? header.getSize(),
                  textAlign: meta?.align || "left",
                }}
                className={[
                  "table-th",
                  header.column.getCanSort() && "table-th-sortable",
                  thHideClass,
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={header.column.getToggleSortingHandler()}
              >
                <div
                  className={[
                    "table-th-content",
                    meta?.align === "right" && "table-th-content-right",
                    meta?.align === "center" && "table-th-content-center",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext()
                  )}
                  {header.column.getCanSort() && (
                    <span className="table-sorter">
                      <SortIcon
                        size={14}
                        sorted={header.column.getIsSorted() || false}
                      />
                    </span>
                  )}
                </div>
              </th>
            );
          })}
        </tr>
      ))}
    </thead>
  );
}

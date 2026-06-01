import { useTranslation } from "react-i18next";

import { TABLE_ROW_HEIGHT } from "./tableSurfaceUtils";
import type { TableSurfacePagination } from "./types";

interface TableSurfaceFooterProps {
  hasMoreRows: boolean;
  loadingMoreRows: boolean;
  loadMoreTop: number;
  scrollLeft: number;
  viewportWidth: number;
  pagination?: TableSurfacePagination;
  onLoadMoreRows?: () => void | Promise<void>;
}

export function TableSurfaceFooter({
  hasMoreRows,
  loadingMoreRows,
  loadMoreTop,
  scrollLeft,
  viewportWidth,
  pagination,
  onLoadMoreRows,
}: TableSurfaceFooterProps) {
  const { t } = useTranslation();

  if (pagination) {
    const totalPages = Math.max(
      1,
      Math.ceil(pagination.totalCount / pagination.pageSize)
    );
    return (
      <div className="table-surface__pagination">
        <button
          type="button"
          className="table-surface__pagination-button"
          disabled={pagination.page <= 1}
          onClick={() => pagination.onPageChange(pagination.page - 1)}
        >
          {t("common:actions.previous")}
        </button>
        <span className="table-surface__pagination-label">
          {pagination.page} / {totalPages}
        </span>
        <button
          type="button"
          className="table-surface__pagination-button"
          disabled={pagination.page >= totalPages}
          onClick={() => pagination.onPageChange(pagination.page + 1)}
        >
          {t("common:actions.next")}
        </button>
      </div>
    );
  }

  if (!hasMoreRows || !onLoadMoreRows) return null;

  return (
    <button
      type="button"
      className="table-surface__load-more-row"
      style={{
        width: viewportWidth,
        height: TABLE_ROW_HEIGHT,
        transform: `translate3d(${scrollLeft}px, ${loadMoreTop}px, 0)`,
      }}
      disabled={loadingMoreRows}
      onClick={() => void onLoadMoreRows()}
    >
      <span>{t("common:actions.loadMore")}</span>
    </button>
  );
}

export type GridHydrationWindowOptions = {
  categoryId: string;
  itemIds: string[];
  cols: number;
  scrollTop: number;
  clientHeight: number;
  rowHeight: number;
  bufferRows?: number;
  fallbackVisibleRows?: number;
};

export function collectVisibleGridHydrationTargets(
  options: GridHydrationWindowOptions,
): Array<{ categoryId: string; itemId: string }> {
  const {
    categoryId,
    itemIds,
    cols,
    scrollTop,
    clientHeight,
    rowHeight,
    bufferRows = 1,
    fallbackVisibleRows = 3,
  } = options;

  const safeCols = Math.max(1, Math.floor(cols || 1));
  const safeBufferRows = Math.max(0, Math.floor(bufferRows));
  const safeFallbackRows = Math.max(1, Math.floor(fallbackVisibleRows));

  let startRow = 0;
  let endRow = safeFallbackRows - 1;

  if (clientHeight > 0 && rowHeight > 0) {
    const visibleStartRow = Math.max(0, Math.floor(scrollTop / rowHeight));
    const visibleRowCount = Math.max(1, Math.ceil(clientHeight / rowHeight));
    startRow = Math.max(0, visibleStartRow - safeBufferRows);
    endRow = visibleStartRow + visibleRowCount - 1 + safeBufferRows;
  } else {
    endRow = safeFallbackRows - 1 + safeBufferRows;
  }

  const startIndex = startRow * safeCols;
  const endExclusive = Math.min(itemIds.length, (endRow + 1) * safeCols);

  return itemIds.slice(startIndex, endExclusive).map((itemId) => ({
    categoryId,
    itemId,
  }));
}

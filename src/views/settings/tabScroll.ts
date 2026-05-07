type ComputeActiveTabScrollLeftInput = {
  currentScrollLeft: number;
  viewportWidth: number;
  tabOffsetLeft: number;
  tabWidth: number;
  edgePadding: number;
  tailWidth: number;
};

export function computeActiveTabScrollLeft(
  input: ComputeActiveTabScrollLeftInput
): number {
  const {
    currentScrollLeft,
    viewportWidth,
    tabOffsetLeft,
    tabWidth,
    edgePadding,
    tailWidth,
  } = input;

  const visibleLeft = currentScrollLeft + edgePadding;
  const visibleRight = currentScrollLeft + viewportWidth - edgePadding;
  const idealScrollLeft = tabOffsetLeft + tabWidth / 2 - viewportWidth / 2;
  const minScrollLeft = Math.max(
    0,
    tabOffsetLeft + tabWidth + tailWidth + edgePadding - viewportWidth
  );
  const maxScrollLeft = Math.max(0, tabOffsetLeft - tailWidth - edgePadding);

  if (minScrollLeft <= maxScrollLeft) {
    return Math.max(minScrollLeft, Math.min(idealScrollLeft, maxScrollLeft));
  }

  if (tabOffsetLeft < visibleLeft) {
    return Math.max(0, tabOffsetLeft - tailWidth - edgePadding);
  }

  if (tabOffsetLeft + tabWidth > visibleRight) {
    return Math.max(0, tabOffsetLeft + tabWidth + tailWidth + edgePadding - viewportWidth);
  }

  return Math.max(0, idealScrollLeft);
}

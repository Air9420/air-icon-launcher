export type WindowVisibilityState = "visible" | "hidden";

type VisibleHydrationHints = {
  documentVisibilityState?: WindowVisibilityState;
  documentHasFocus?: boolean;
};

type VisibleHydrationState = {
  visibilityState: WindowVisibilityState;
  isWindowFocused: boolean;
};

export function reconcileVisibleHydrationState(
  visibilityState: WindowVisibilityState,
  isWindowFocused: boolean,
  hints: VisibleHydrationHints = {},
): VisibleHydrationState {
  if (
    hints.documentVisibilityState === "visible"
    && hints.documentHasFocus === true
  ) {
    return {
      visibilityState: "visible",
      isWindowFocused: true,
    };
  }

  if (hints.documentVisibilityState === "hidden") {
    return {
      visibilityState: "hidden",
      isWindowFocused: false,
    };
  }

  return {
    visibilityState,
    isWindowFocused,
  };
}

export function shouldSkipVisibleHydration(
  visibilityState: WindowVisibilityState,
  isWindowFocused: boolean,
  hints: VisibleHydrationHints = {},
): boolean {
  const reconciled = reconcileVisibleHydrationState(
    visibilityState,
    isWindowFocused,
    hints,
  );
  return reconciled.visibilityState !== "visible" || !reconciled.isWindowFocused;
}

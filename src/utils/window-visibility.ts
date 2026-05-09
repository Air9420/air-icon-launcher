export type WindowVisibilityState = "visible" | "hidden";

export function shouldSkipVisibleHydration(
  visibilityState: WindowVisibilityState,
  isWindowFocused: boolean,
): boolean {
  return visibilityState !== "visible" || !isWindowFocused;
}

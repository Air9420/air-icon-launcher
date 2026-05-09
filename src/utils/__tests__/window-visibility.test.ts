import { describe, expect, it } from "vitest";

import {
    reconcileVisibleHydrationState,
    shouldSkipVisibleHydration,
} from "../window-visibility";

describe("reconcileVisibleHydrationState", () => {
    it("recovers from stale hidden state when the document is visibly focused", () => {
        expect(
            reconcileVisibleHydrationState("hidden", false, {
                documentVisibilityState: "visible",
                documentHasFocus: true,
            })
        ).toEqual({
            visibilityState: "visible",
            isWindowFocused: true,
        });

        expect(
            shouldSkipVisibleHydration("hidden", false, {
                documentVisibilityState: "visible",
                documentHasFocus: true,
            })
        ).toBe(false);
    });

    it("treats hidden documents as non-hydratable", () => {
        expect(
            reconcileVisibleHydrationState("visible", true, {
                documentVisibilityState: "hidden",
                documentHasFocus: false,
            })
        ).toEqual({
            visibilityState: "hidden",
            isWindowFocused: false,
        });

        expect(
            shouldSkipVisibleHydration("visible", true, {
                documentVisibilityState: "hidden",
                documentHasFocus: false,
            })
        ).toBe(true);
    });

    it("falls back to stored window state when no document hints are available", () => {
        expect(reconcileVisibleHydrationState("visible", false)).toEqual({
            visibilityState: "visible",
            isWindowFocused: false,
        });
        expect(shouldSkipVisibleHydration("visible", false)).toBe(true);
    });
});

import { defineStore } from "pinia";
import { ref } from "vue";
import { enumContextMenuType } from "../menus/contextMenuTypes";
export type { enumContextMenuType };
export type HomeLayoutSectionKey = "pinned" | "recent";
export type HomeLayoutPresetKey =
  | "1x4"
  | "2x4"
  | "1x5"
  | "2x5"
  | "1x6"
  | "2x6"
  | "1x7"
  | "2x7";
export type CategorySortMode = "manual" | "smart";

export const CATEGORY_COLS_PRESETS: ReadonlyArray<number> = [4, 5, 6, 7];
export const LAUNCHER_COLS_PRESETS: ReadonlyArray<number> = [4, 5, 6];

export type HomeSectionLayout = {
  preset: HomeLayoutPresetKey;
  rows: number;
  cols: number;
};

export type HomeSectionLayouts = Record<
  HomeLayoutSectionKey,
  HomeSectionLayout
>;

export const HOME_LAYOUT_PRESETS: ReadonlyArray<HomeSectionLayout> = [
  { preset: "1x4", rows: 1, cols: 4 },
  { preset: "1x5", rows: 1, cols: 5 },
  { preset: "1x6", rows: 1, cols: 6 },
  { preset: "1x7", rows: 1, cols: 7 },
  { preset: "2x4", rows: 2, cols: 4 },
  { preset: "2x5", rows: 2, cols: 5 },
  { preset: "2x6", rows: 2, cols: 6 },
  { preset: "2x7", rows: 2, cols: 7 },
];

const DEFAULT_HOME_LAYOUT_PRESET: HomeLayoutPresetKey = "1x5";

function getDefaultHomeSectionLayout(): HomeSectionLayout {
  const preset =
    HOME_LAYOUT_PRESETS.find((x) => x.preset === DEFAULT_HOME_LAYOUT_PRESET) ||
    HOME_LAYOUT_PRESETS[0];
  return { ...preset };
}

function getDefaultHomeSectionLayouts(): HomeSectionLayouts {
  return {
    pinned: getDefaultHomeSectionLayout(),
    recent: getDefaultHomeSectionLayout(),
  };
}

function findPresetByValue(
  rows: number,
  cols: number,
): HomeSectionLayout | null {
  return (
    HOME_LAYOUT_PRESETS.find((x) => x.rows === rows && x.cols === cols) || null
  );
}

function normalizeHomeSectionLayout(
  raw: unknown,
  fallback: HomeSectionLayout,
): HomeSectionLayout {
  if (!raw || typeof raw !== "object") return { ...fallback };
  const source = raw as Record<string, unknown>;
  const preset = source.preset;
  if (typeof preset === "string") {
    const matched = HOME_LAYOUT_PRESETS.find((x) => x.preset === preset);
    if (matched) return { ...matched };
  }
  const rows = Number(source.rows);
  const cols = Number(source.cols);
  if (Number.isFinite(rows) && Number.isFinite(cols)) {
    const normalizedRows = Math.floor(rows);
    const normalizedCols = Math.floor(cols);
    const matched = findPresetByValue(normalizedRows, normalizedCols);
    if (matched) return { ...matched };
  }
  return { ...fallback };
}

function normalizeHomeSectionLayouts(raw: unknown): HomeSectionLayouts {
  const fallback = getDefaultHomeSectionLayouts();
  if (!raw || typeof raw !== "object") return fallback;
  const source = raw as Record<string, unknown>;
  return {
    pinned: normalizeHomeSectionLayout(source.pinned, fallback.pinned),
    recent: normalizeHomeSectionLayout(source.recent, fallback.recent),
  };
}

function readPersistedStoreSnapshot(
  storeId: string,
): Record<string, unknown> | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  const raw = window.localStorage.getItem(storeId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pickLegacySectionLayout(
  snapshot: Record<string, unknown>,
  section: HomeLayoutSectionKey,
): HomeSectionLayout | null {
  const fallback = getDefaultHomeSectionLayout();
  const sectionName = section === "pinned" ? "pinned" : "recent";
  const legacyObjectKeys = [
    `${sectionName}SectionLayout`,
    `${sectionName}Layout`,
    `${sectionName}UsedLayout`,
  ];
  for (const key of legacyObjectKeys) {
    const normalized = normalizeHomeSectionLayout(snapshot[key], fallback);
    if (
      normalized.preset !== fallback.preset ||
      normalized.rows !== fallback.rows ||
      normalized.cols !== fallback.cols
    ) {
      return normalized;
    }
  }
  const rows = Number(
    snapshot[`${sectionName}Rows`] ??
      snapshot[`${sectionName}SectionRows`] ??
      snapshot[`${sectionName}LayoutRows`],
  );
  const cols = Number(
    snapshot[`${sectionName}Cols`] ??
      snapshot[`${sectionName}SectionCols`] ??
      snapshot[`${sectionName}LayoutCols`],
  );
  const matched = findPresetByValue(Math.floor(rows), Math.floor(cols));
  if (matched) return { ...matched };
  const preset = snapshot[`${sectionName}LayoutPreset`];
  if (typeof preset === "string") {
    const presetMatched = HOME_LAYOUT_PRESETS.find((x) => x.preset === preset);
    if (presetMatched) return { ...presetMatched };
  }
  return null;
}

function migrateHomeSectionLayouts(
  storeId: string,
  currentLayouts: unknown,
): HomeSectionLayouts {
  const normalizedCurrent = normalizeHomeSectionLayouts(currentLayouts);
  const snapshot = readPersistedStoreSnapshot(storeId);
  if (!snapshot) return normalizedCurrent;
  if (snapshot.homeSectionLayouts) {
    return normalizeHomeSectionLayouts(snapshot.homeSectionLayouts);
  }
  const pinned = pickLegacySectionLayout(snapshot, "pinned");
  const recent = pickLegacySectionLayout(snapshot, "recent");
  if (!pinned && !recent) return normalizedCurrent;
  return {
    pinned: pinned || getDefaultHomeSectionLayout(),
    recent: recent || getDefaultHomeSectionLayout(),
  };
}

type ContextMenuState =
  | {
      visible: false;
      x: 0;
      y: 0;
    }
  | {
      visible: true;
      x: number;
      y: number;
    };

export const useUIStore = defineStore(
  "ui",
  () => {
    const ContextMenu = ref<ContextMenuState>({
      visible: false,
      x: 0,
      y: 0,
    });
    const ContextMenuType = ref<enumContextMenuType>(
      enumContextMenuType.HomeGroupView,
    );
    const categoryCols = ref<number>(5);
    const launcherCols = ref<number>(5);
    const categorySortMode = ref<CategorySortMode>("manual");
    const homeSectionLayouts = ref<HomeSectionLayouts>(
      migrateHomeSectionLayouts("ui", getDefaultHomeSectionLayouts()),
    );

    function openContextMenu(x: number, y: number) {
      ContextMenu.value = { visible: true, x, y };
    }

    function closeContextMenu() {
      ContextMenu.value = { visible: false, x: 0, y: 0 };
    }

    function setCategoryCols(cols: number) {
      const next = Math.min(8, Math.max(4, Math.floor(cols)));
      categoryCols.value = next;
    }

    function setLauncherCols(cols: number) {
      const next = Math.min(8, Math.max(4, Math.floor(cols)));
      launcherCols.value = next;
    }

    function setCategorySortMode(mode: CategorySortMode) {
      categorySortMode.value = mode === "smart" ? "smart" : "manual";
    }

    function setHomeSectionLayoutPreset(
      section: HomeLayoutSectionKey,
      preset: HomeLayoutPresetKey,
    ) {
      const matched = HOME_LAYOUT_PRESETS.find((x) => x.preset === preset);
      if (!matched) return;
      homeSectionLayouts.value = {
        ...homeSectionLayouts.value,
        [section]: { ...matched },
      };
    }

    function setHomeSectionLayouts(next: unknown) {
      homeSectionLayouts.value = normalizeHomeSectionLayouts(next);
    }

    function getHomeSectionLayout(
      section: HomeLayoutSectionKey,
    ): HomeSectionLayout {
      return homeSectionLayouts.value[section];
    }

    function getHomeSectionLimit(section: HomeLayoutSectionKey): number {
      const target = homeSectionLayouts.value[section];
      return target.rows * target.cols;
    }

    return {
      ContextMenu,
      ContextMenuType,
      categoryCols,
      launcherCols,
      categorySortMode,
      homeSectionLayouts,
      openContextMenu,
      closeContextMenu,
      setCategoryCols,
      setLauncherCols,
      setCategorySortMode,
      setHomeSectionLayoutPreset,
      setHomeSectionLayouts,
      getHomeSectionLayout,
      getHomeSectionLimit,
    };
  },
  {
    persist: {
      pick: ["categoryCols", "launcherCols", "homeSectionLayouts"],
      afterHydrate: (ctx) => {
        const targetStore = ctx.store as unknown as {
          $id: string;
          homeSectionLayouts: unknown;
        };
        targetStore.homeSectionLayouts = migrateHomeSectionLayouts(
          targetStore.$id,
          targetStore.homeSectionLayouts,
        );
      },
    },
  },
);

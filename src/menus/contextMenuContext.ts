import type { HomeLayoutPresetKey } from "../stores/uiStore";
import type { ScenarioKey } from "../stores/launcherStore";
import type { MenuAction, MenuContext, MenuItem } from "./contextMenuTypes";
import { enumContextMenuType } from "./contextMenuTypes";
import { SCENARIO_KEYS } from "./contextMenu";

export interface ContextMenuViewProps {
  currentItemId?: string;
  currentItemPath?: string;
  currentClipboardRecordId?: string;
  currentClipboardContentType?: "text" | "image";
  isCurrentItemFavorite?: boolean;
  hasCustomIconProp?: boolean;
  hasCurrentCategoryCustomIcon?: boolean;
  categoryCols?: number;
  launcherCols?: number;
  currentHomeSection?: "pinned" | "recent";
  currentCategorySortMode?: "manual" | "smart";
  pinnedLayoutPreset?: HomeLayoutPresetKey;
  recentLayoutPreset?: HomeLayoutPresetKey;
  currentCategoryId?: string;
}

export type ItemScenarioChecker = (
  scenario: ScenarioKey,
  itemId: string,
) => boolean;

export function buildMenuContextFromProps(
  props: ContextMenuViewProps,
  menuType: enumContextMenuType,
  isItemInScenario: ItemScenarioChecker,
): MenuContext {
  const currentItemId = props.currentItemId;
  const itemScenarios = currentItemId
    ? SCENARIO_KEYS.filter((scenario) =>
        isItemInScenario(scenario, currentItemId),
      )
    : [];

  const item = props.currentItemId
    ? {
        pinned: !!props.isCurrentItemFavorite,
        favorite: !!props.isCurrentItemFavorite,
        customIcon: !!props.hasCustomIconProp,
        scenarios: itemScenarios,
      }
    : undefined;

  const layout = {
    categoryCols: props.categoryCols ?? 5,
    launcherCols: props.launcherCols ?? 5,
    pinnedPreset: props.pinnedLayoutPreset ?? "1x5",
    recentPreset: props.recentLayoutPreset ?? "1x5",
  };

  return {
    menuType,
    categoryId: props.currentCategoryId ?? null,
    itemId: props.currentItemId ?? null,
    itemPath: props.currentItemPath ?? null,
    clipboardRecordId: props.currentClipboardRecordId ?? null,
    clipboardContentType: props.currentClipboardContentType ?? null,
    homeSection: props.currentHomeSection ?? null,
    categorySortMode: props.currentCategorySortMode ?? "manual",
    item,
    category: props.currentCategoryId
      ? {
          id: props.currentCategoryId,
          customIcon: !!props.hasCurrentCategoryCustomIcon,
        }
      : undefined,
    layout,
  };
}

export type ContextMenuActionEmitter = (
  event: "action",
  action: MenuAction,
  ctx: MenuContext,
) => void | Promise<void>;

export function emitContextMenuItemAction(
  item: MenuItem,
  ctx: MenuContext,
  emit: ContextMenuActionEmitter,
) {
  if (item.type !== "item") return;
  return emit("action", item.action, ctx);
}

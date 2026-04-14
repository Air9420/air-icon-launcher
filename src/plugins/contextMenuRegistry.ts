import type { enumContextMenuType } from "../menus/contextMenuTypes";
import type { MenuContext } from "../menus/contextMenuTypes";
import type { VisibilityCondition, LabelValue } from "../menus/conditions";

type MenuLabel = LabelValue;
type MenuPredicate = VisibilityCondition;

export type ContextMenuItemInput =
    | {
          type: "item";
          id: string;
          label: MenuLabel;
          commandId?: string;
          onClick?: (ctx: MenuContext) => void | Promise<void>;
          order?: number;
          mode?: "normal" | "checkbox" | "radio";
          visible?: MenuPredicate;
          disabled?: MenuPredicate;
          checked?: MenuPredicate;
          before?: string;
          after?: string;
      }
    | {
          type: "separator";
          id: string;
          order?: number;
          visible?: MenuPredicate;
          before?: string;
          after?: string;
      }
    | {
          type: "group";
          id: string;
          title: MenuLabel;
          order?: number;
          visible?: MenuPredicate;
          before?: string;
          after?: string;
          children: ContextMenuItemInput[];
      };

export type RegisteredContextMenuItem =
    | ({
          pluginId: string;
          order: number;
      } & Omit<Extract<ContextMenuItemInput, { type: "item" }>, "order">)
    | ({
          pluginId: string;
          order: number;
      } & Omit<Extract<ContextMenuItemInput, { type: "separator" }>, "order">)
    | ({
          pluginId: string;
          order: number;
          children: RegisteredContextMenuItem[];
      } & Omit<Extract<ContextMenuItemInput, { type: "group" }>, "order" | "children">);

type PluginMenuRegistry = Map<string, Map<enumContextMenuType, RegisteredContextMenuItem[]>>;

const registry: PluginMenuRegistry = new Map();

/**
 * 注册插件贡献的右键菜单项。
 */
export function registerContextMenuItems(
    pluginId: string,
    menuType: enumContextMenuType,
    items: ContextMenuItemInput[]
) {
    const byType = registry.get(pluginId) ?? new Map();
    const normalized = items.map((x, index) => normalizeItem(pluginId, x, index));
    byType.set(menuType, normalized);
    registry.set(pluginId, byType);
}

/**
 * 注销插件贡献的右键菜单项。
 */
export function unregisterContextMenuItems(pluginId: string, menuType?: enumContextMenuType) {
    if (!registry.has(pluginId)) return;
    if (!menuType) {
        registry.delete(pluginId);
        return;
    }
    const byType = registry.get(pluginId);
    if (!byType) return;
    byType.delete(menuType);
    if (byType.size === 0) registry.delete(pluginId);
}

/**
 * 清理某个插件的全部菜单贡献项（通常用于卸载/禁用/报错回收）。
 */
export function clearContextMenuItemsByPlugin(pluginId: string) {
    registry.delete(pluginId);
}

/**
 * 获取指定 menuType 下的所有插件贡献项（已做稳定排序）。
 */
export function getContextMenuContributions(menuType: enumContextMenuType): RegisteredContextMenuItem[] {
    const all: RegisteredContextMenuItem[] = [];
    for (const [, byType] of registry) {
        const items = byType.get(menuType);
        if (!items?.length) continue;
        for (const item of items) {
            all.push(item);
        }
    }

    all.sort((a, b) => a.order - b.order || stableKey(a).localeCompare(stableKey(b)));
    return all;
}

/**
 * 为排序提供稳定 key（相同 order 下保证顺序可复现）。
 */
function stableKey(item: RegisteredContextMenuItem): string {
    return `${item.pluginId}:${item.id}`;
}

/**
 * 规范化插件贡献项：注入 pluginId，并补全 order（未提供则按声明顺序回退）。
 */
function normalizeItem(
    pluginId: string,
    item: ContextMenuItemInput,
    index: number
): RegisteredContextMenuItem {
    const order = typeof item.order === "number" ? item.order : 1000 + index;
    if (item.type === "group") {
        return {
            ...item,
            pluginId,
            order,
            children: item.children.map((x, childIndex) =>
                normalizeItem(pluginId, x, childIndex)
            ),
        };
    }
    return { ...item, pluginId, order };
}

export type { MenuContext };

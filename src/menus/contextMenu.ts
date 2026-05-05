import { enumContextMenuType } from "./contextMenuTypes";
import { HOME_LAYOUT_PRESETS } from "../stores";
import { useLauncherStore, type ScenarioKey } from "../stores/launcherStore";
import { getContextMenuContributions } from "../plugins/contextMenuRegistry";
import type { MenuContext, MenuItem } from "./contextMenuTypes";
import { evaluateCondition } from "./conditions";

/**
 * 构建当前右键上下文下的菜单模型（内置 + 插件贡献项）。
 */
export function buildContextMenuModel(ctx: MenuContext): MenuItem[] {
  const builtin = buildBuiltinMenuModel(ctx);
  const plugin = getContextMenuContributions(ctx.menuType).map((x) => {
    return contributionToMenuItem(x, ctx);
  });
  const sorted = sortAndFilterMenuItems([...builtin, ...plugin], ctx);
  return cleanupSeparators(sorted);
}

/**
 * 构建应用内置的右键菜单模型（不含插件项）。
 */
function buildBuiltinMenuModel(ctx: MenuContext): MenuItem[] {
  const launcherStore = useLauncherStore();
  const scenarioKeys: ScenarioKey[] = ["work", "dev", "play"];
  const toCheckedCondition = (checked: boolean) =>
    checked ? { and: [] as const } : { not: { and: [] as const } };
  const isScenarioChecked = (scenario: ScenarioKey) =>
    !!ctx.itemId && launcherStore.isItemInScenario(scenario, ctx.itemId);

  const items: MenuItem[] = [
    {
      type: "item",
      id: "builtin:add-item",
      label: "添加项目",
      action: { kind: "add-item" },
      order: 10,
      visible: { menuType: enumContextMenuType.IconView },
    },
    {
      type: "item",
      id: "builtin:edit-item",
      label: "编辑",
      action: { kind: "edit-item" },
      order: 20,
      visible: {
        and: [
          { menuType: enumContextMenuType.IconItem },
          { category: true },
        ],
      },
    },
    {
      type: "item",
      id: "builtin:toggle-pinned",
      label: {
        if: { item: { pinned: true } },
        then: "取消固定启动项",
        else: "固定启动项",
      },
      action: { kind: "toggle-pinned" },
      order: 30,
      visible: {
        and: [
          { menuType: enumContextMenuType.IconItem },
          { category: true },
        ],
      },
    },
    {
      type: "item",
      id: "builtin:change-icon",
      label: "更换图标",
      action: { kind: "change-icon" },
      order: 40,
      visible: {
        and: [
          { menuType: enumContextMenuType.IconItem },
          { category: true },
        ],
      },
    },
    {
      type: "item",
      id: "builtin:reset-icon",
      label: "重置图标",
      action: { kind: "reset-icon" },
      order: 50,
      visible: {
        and: [
          { menuType: enumContextMenuType.IconItem },
          { category: true },
          { item: { customIcon: true } },
        ],
      },
    },
    {
      type: "group",
      id: "builtin:group:scenario-membership",
      title: "加入场景",
      order: 55,
      visible: {
        and: [
          { menuType: enumContextMenuType.IconItem },
          { category: true },
        ],
      },
      children: scenarioKeys.map((scenario, index) => ({
        type: "item" as const,
        id: `builtin:toggle-scenario-membership:${scenario}`,
        label: scenario,
        action: { kind: "toggle-scenario-membership", scenario },
        order: 55 + index,
        mode: "checkbox" as const,
        checked: toCheckedCondition(isScenarioChecked(scenario)),
      })),
    },
    {
      type: "item",
      id: "builtin:delete-item",
      label: "删除",
      action: { kind: "delete-item" },
      order: 60,
      visible: {
        and: [
          { menuType: enumContextMenuType.IconItem },
          { category: true },
        ],
      },
    },
    {
      type: "item",
      id: "builtin:copy-clipboard-item",
      label: "复制到剪贴板",
      action: { kind: "copy-clipboard-item" },
      order: 62,
      visible: { menuType: enumContextMenuType.SearchClipboardItem },
    },
    {
      type: "item",
      id: "builtin:locate-clipboard-item",
      label: "在剪贴板历史中定位",
      action: { kind: "locate-clipboard-item" },
      order: 63,
      visible: { menuType: enumContextMenuType.SearchClipboardItem },
    },
    {
      type: "item",
      id: "builtin:open-in-explorer",
      label: "在资源管理器中打开",
      action: { kind: "open-in-explorer" },
      order: 64,
      visible: {
        and: [
          {
            menuType: [
              enumContextMenuType.IconItem,
              enumContextMenuType.SearchRecentFileItem,
              enumContextMenuType.SearchScannedItem,
            ],
          },
          { itemPath: true },
        ],
      },
    },
    {
      type: "item",
      id: "builtin:block-external-item",
      label: "屏蔽此外部项",
      action: { kind: "block-external-item" },
      order: 65,
      visible: {
        and: [
          { menuType: enumContextMenuType.IconItem },
          { homeSection: "recent" },
          { itemPath: true },
          { not: { category: true } },
        ],
      },
    },
    {
      type: "item",
      id: "builtin:convert-external-item",
      label: "添加到分类---长按或点击",
      action: { kind: "convert-external-item" },
      order: 66,
      visible: {
        and: [
          { menuType: enumContextMenuType.IconItem },
          { homeSection: "recent" },
          { itemPath: true },
          { not: { category: true } },
        ],
      },
    },
    {
      type: "item",
      id: "builtin:add-category",
      label: "添加类目",
      action: { kind: "add-category" },
      order: 70,
      visible: { menuType: enumContextMenuType.HomeGroupView },
    },
    {
      type: "item",
      id: "builtin:rename-category",
      label: "重命名",
      action: { kind: "rename-category" },
      order: 80,
      visible: { menuType: enumContextMenuType.HomeGroupItem },
    },
    {
      type: "item",
      id: "builtin:change-category-icon",
      label: "更换图标",
      action: { kind: "change-category-icon" },
      order: 90,
      visible: { menuType: enumContextMenuType.HomeGroupItem },
    },
    {
      type: "item",
      id: "builtin:reset-category-icon",
      label: "重置图标",
      action: { kind: "reset-category-icon" },
      order: 100,
      visible: {
        and: [
          { menuType: enumContextMenuType.HomeGroupItem },
          { category: { customIcon: true } },
        ],
      },
    },
    {
      type: "item",
      id: "builtin:delete-category",
      label: "删除",
      action: { kind: "delete-category" },
      order: 110,
      visible: { menuType: enumContextMenuType.HomeGroupItem },
    },
    {
      type: "separator",
      id: "builtin:sep:main",
      order: 111,
      visible: {
        menuType: [
          enumContextMenuType.HomeGroupView,
          enumContextMenuType.HomeGroupItem,
          enumContextMenuType.IconView,
          enumContextMenuType.IconItem,
          enumContextMenuType.HomePinnedView,
          enumContextMenuType.HomeRecentUsedView,
        ],
      },
    },
    {
      type: "item",
      id: "builtin:hide-window",
      label: "隐藏启动台",
      action: { kind: "hide-window" },
      order: 120,
      visible: {
        menuType: [
          enumContextMenuType.HomeGroupView,
          enumContextMenuType.Home,
          enumContextMenuType.HomePinnedView,
          enumContextMenuType.HomeRecentUsedView,
        ],
      },
    },
    {
      type: "item",
      id: "builtin:start-dragging-window",
      label: "拖拽窗口",
      action: { kind: "start-dragging-window" },
      order: 130,
    },
    {
      type: "item",
      id: "builtin:open-settings",
      label: "设置",
      action: { kind: "open-settings" },
      order: 140,
    },
    {
      type: "item",
      id: "builtin:open-guide",
      label: "使用指南",
      action: { kind: "open-guide" },
      order: 150,
    },
    {
      type: "separator",
      id: "builtin:sep:cols",
      order: 200,
      visible: {
        menuType: [
          enumContextMenuType.HomeGroupView,
          enumContextMenuType.HomeGroupItem,
          enumContextMenuType.IconView,
          enumContextMenuType.IconItem,
        ],
      },
    },
    {
      type: "group",
      id: "builtin:group:category-cols",
      title: "分类图标",
      order: 210,
      visible: {
        menuType: [
          enumContextMenuType.HomeGroupView,
          enumContextMenuType.HomeGroupItem,
        ],
      },
      children: [4, 5, 6, 7].map((cols) => ({
        type: "item" as const,
        id: `builtin:set-category-cols:${cols}`,
        label: String(cols),
        action: { kind: "set-category-cols", cols },
        order: 210 + cols,
        mode: "radio" as const,
        checked: { layout: { categoryCols: cols } },
      })),
    },
    {
      type: "group",
      id: "builtin:group:launcher-cols",
      title: "启动项图标",
      order: 220,
      visible: {
        and: [
          {
            menuType: [
              enumContextMenuType.IconView,
              enumContextMenuType.IconItem,
            ],
          },
          { not: { homeSection: ["pinned", "recent"] } },
        ],
      },
      children: [4, 5, 6].map((cols) => ({
        type: "item" as const,
        id: `builtin:set-launcher-cols:${cols}`,
        label: String(cols),
        action: { kind: "set-launcher-cols", cols },
        order: 220 + cols,
        mode: "radio" as const,
        checked: { layout: { launcherCols: cols } },
      })),
    },
    {
      type: "group",
      id: "builtin:group:category-sort-mode",
      title: "排序方式",
      order: 225,
      visible: {
        and: [
          {
            menuType: [
              enumContextMenuType.IconView,
              enumContextMenuType.IconItem,
            ],
          },
          { not: { homeSection: ["pinned", "recent"] } },
        ],
      },
      children: [
        {
          type: "item",
          id: "builtin:set-category-sort-mode:manual",
          label: "手动",
          action: { kind: "set-category-sort-mode", mode: "manual" },
          order: 225,
          mode: "radio",
          checked: { categorySortMode: "manual" },
        },
        {
          type: "item",
          id: "builtin:set-category-sort-mode:smart",
          label: "智能",
          action: { kind: "set-category-sort-mode", mode: "smart" },
          order: 226,
          mode: "radio",
          checked: { categorySortMode: "smart" },
        },
      ],
    },
    {
      type: "group",
      id: "builtin:group:home-layout-preset",
      title: {
        if: { homeSection: "pinned" },
        then: "固定启动项布局",
        else: {
          if: { homeSection: "recent" },
          then: "最近使用布局",
          else: "首页布局",
        },
      },
      order: 230,
      visible: {
        and: [
          {
            menuType: [
              enumContextMenuType.IconItem,
              enumContextMenuType.HomePinnedView,
              enumContextMenuType.HomeRecentUsedView,
            ],
          },
          { homeSection: ["pinned", "recent"] },
        ],
      },
      children: HOME_LAYOUT_PRESETS.map((layout, index) => ({
        type: "item" as const,
        id: `builtin:set-home-layout-preset:${layout.preset}`,
        label: layout.preset,
        action: {
          kind: "set-home-layout-preset",
          section: "pinned",
          preset: layout.preset,
        },
        order: 230 + index,
        mode: "radio" as const,
        checked: {
          if: { homeSection: "pinned" },
          then: { layout: { pinnedPreset: layout.preset } },
          else: {
            if: { homeSection: "recent" },
            then: { layout: { recentPreset: layout.preset } },
            else: { layout: { pinnedPreset: layout.preset } },
          },
        },
      })),
    },
  ];

  return items;
}

/**
 * 过滤不可见项、递归处理子项，并进行稳定排序与锚点调整。
 */
function sortAndFilterMenuItems(
  items: MenuItem[],
  ctx: MenuContext,
): MenuItem[] {
  const visibleItems = items
    .map((x) => normalizeChildren(x, ctx))
    .filter((x): x is MenuItem => {
      if (x.type === "group" && x.children.length === 0) return false;
      if (x.visible && !evaluateCondition(x.visible, ctx)) return false;
      return true;
    });

  visibleItems.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return applyAnchors(visibleItems);
}

/**
 * 递归规范化 group.children（对子项做相同的过滤与排序）。
 */
function normalizeChildren(item: MenuItem, ctx: MenuContext): MenuItem {
  if (item.type !== "group") return item;
  const children = sortAndFilterMenuItems(item.children, ctx);
  return { ...item, children };
}

/**
 * 将插件贡献项转换为菜单渲染模型（并注入统一的 action）。
 */
function contributionToMenuItem(
  c: ReturnType<typeof getContextMenuContributions>[number],
  ctx: MenuContext,
): MenuItem {
  if (c.type === "separator") {
    return {
      type: "separator",
      id: `plugin:${c.pluginId}:${c.id}`,
      order: (c.order ?? 0) + 1000,
      before: c.before,
      after: c.after,
      visible: c.visible,
    };
  }

  if (c.type === "group") {
    return {
      type: "group",
      id: `plugin:${c.pluginId}:${c.id}`,
      title: c.title,
      order: (c.order ?? 0) + 1000,
      before: c.before,
      after: c.after,
      visible: c.visible,
      children: c.children.map((x) =>
        contributionToMenuItem({ ...x, pluginId: c.pluginId }, ctx),
      ),
    };
  }

  return {
    type: "item",
    id: `plugin:${c.pluginId}:${c.id}`,
    label: c.label,
    order: (c.order ?? 0) + 1000,
    before: c.before,
    after: c.after,
    visible: c.visible,
    disabled: c.disabled,
    checked: c.checked,
    mode: c.mode,
    action: c.commandId
      ? { kind: "plugin-command", pluginId: c.pluginId, commandId: c.commandId }
      : c.onClick
        ? { kind: "plugin-onclick", pluginId: c.pluginId, onClick: c.onClick }
        : { kind: "plugin-command", pluginId: c.pluginId, commandId: c.id },
  };
}

/**
 * 按 before/after 锚点在同层级内调整菜单项位置（在 order 排序之后执行）。
 * 包含循环检测，防止 A after B，B after A 导致的死循环。
 */
function applyAnchors(items: MenuItem[]): MenuItem[] {
  const list = [...items];
  const moveCount = new Map<string, number>();
  const maxMoves = items.length;

  for (const item of items) {
    const anchorId = item.before || item.after;
    if (!anchorId) continue;

    const currentMoveCount = moveCount.get(item.id) || 0;
    if (currentMoveCount >= maxMoves) {
      break;
    }

    const fromIndex = list.findIndex((x) => x.id === item.id);
    if (fromIndex === -1) continue;
    const anchorIndex = list.findIndex((x) => x.id === anchorId);
    if (anchorIndex === -1) continue;

    list.splice(fromIndex, 1);
    const nextAnchorIndex = list.findIndex((x) => x.id === anchorId);
    const insertIndex = item.before ? nextAnchorIndex : nextAnchorIndex + 1;
    list.splice(Math.max(0, Math.min(insertIndex, list.length)), 0, item);

    moveCount.set(item.id, currentMoveCount + 1);
  }
  return list;
}

/**
 * 清理菜单中的无效分隔符
 * - 开头不能是 separator
 * - 结尾不能是 separator
 * - 不能有连续的 separator
 */
function cleanupSeparators(items: MenuItem[]): MenuItem[] {
  const processed = items.map((item) => {
    if (item.type === "group") {
      return { ...item, children: cleanupSeparators(item.children) };
    }
    return item;
  });

  let start = 0;
  while (start < processed.length && processed[start].type === "separator") {
    start++;
  }

  let end = processed.length;
  while (end > start && processed[end - 1].type === "separator") {
    end--;
  }

  const result: MenuItem[] = [];
  let prevWasSeparator = true;
  for (let i = start; i < end; i++) {
    const item = processed[i];
    if (item.type === "separator") {
      if (!prevWasSeparator) {
        result.push(item);
        prevWasSeparator = true;
      }
    } else {
      result.push(item);
      prevWasSeparator = false;
    }
  }

  return result;
}

import type { Category, LauncherItem } from "../stores";

export interface PluginCategory {
  id: string;
  name: string;
}

export interface PluginLauncherItem {
  id: string;
  name: string;
  categoryId: string;
}

export interface PluginClipboardRecord {
  id: string;
  type: "text" | "image";
  timestamp: number;
  preview?: string;
}

export function toPluginCategory(category: Category): PluginCategory {
  return {
    id: category.id,
    name: category.name,
  };
}

export function toPluginLauncherItem(
  item: LauncherItem,
  categoryId: string
): PluginLauncherItem {
  return {
    id: item.id,
    name: item.name,
    categoryId,
  };
}

export function toPluginCategories(categories: Category[]): PluginCategory[] {
  return categories.map(toPluginCategory);
}

export function toPluginLauncherItems(
  items: LauncherItem[],
  categoryId: string
): PluginLauncherItem[] {
  return items.map((item) => toPluginLauncherItem(item, categoryId));
}

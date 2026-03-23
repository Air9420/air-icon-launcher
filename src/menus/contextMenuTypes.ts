import type {
    enumContextMenuType,
    HomeLayoutPresetKey,
    HomeLayoutSectionKey,
} from "../stores";
import type { VisibilityCondition, ResolveContext, LabelValue, ConditionValue } from "./conditions";

export type { VisibilityCondition, ResolveContext, LabelValue, ConditionValue };
export { evaluateCondition, resolveConditionValue, resolveLabel, resolveLabel as resolveMenuLabel } from "./conditions";

export type MenuContext = ResolveContext;

export type BuiltinMenuAction =
    | { kind: "add-item" }
    | { kind: "edit-item" }
    | { kind: "delete-item" }
    | { kind: "add-category" }
    | { kind: "delete-category" }
    | { kind: "rename-category" }
    | { kind: "hide-window" }
    | { kind: "set-category-cols"; cols: number }
    | { kind: "set-launcher-cols"; cols: number }
    | {
          kind: "set-home-layout-preset";
          section: HomeLayoutSectionKey;
          preset: HomeLayoutPresetKey;
      }
    | { kind: "change-icon" }
    | { kind: "reset-icon" }
    | { kind: "change-category-icon" }
    | { kind: "reset-category-icon" }
    | { kind: "toggle-pinned" }
    | { kind: "toggle-favorite" }
    | { kind: "open-settings" }
    | { kind: "open-about" }
    | { kind: "open-guide" }
    | { kind: "start-dragging-window" };

export type PluginMenuAction = {
    kind: "plugin-command";
    pluginId: string;
    commandId: string;
};

export type PluginOnClickAction = {
    kind: "plugin-onclick";
    pluginId: string;
    onClick: (ctx: MenuContext) => void | Promise<void>;
};

export type MenuAction = BuiltinMenuAction | PluginMenuAction | PluginOnClickAction;

export type MenuItem =
    | {
          type: "item";
          id: string;
          label: LabelValue;
          action: MenuAction;
          order: number;
          before?: string;
          after?: string;
          visible?: VisibilityCondition;
          disabled?: ConditionValue<VisibilityCondition>;
          checked?: ConditionValue<VisibilityCondition>;
          mode?: "normal" | "checkbox" | "radio";
      }
    | {
          type: "separator";
          id: string;
          order: number;
          before?: string;
          after?: string;
          visible?: VisibilityCondition;
      }
    | {
          type: "group";
          id: string;
          title: LabelValue;
          order: number;
          before?: string;
          after?: string;
          visible?: VisibilityCondition;
          children: MenuItem[];
      };

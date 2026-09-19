/**
 * Menu action dispatcher — maps MenuAction.kind to domain handlers.
 */
import { selectAndConvertIcon } from "../../utils/iconUtils";
import { executeLegacyPluginCommand } from "../../menus/legacy-plugin-command";
import type { MenuAction, MenuActionDeps, MenuActionsBundle, MenuContext } from "./types";

export function createMenuActionDispatch(
    deps: MenuActionDeps,
    bundle: Omit<MenuActionsBundle, "onMenuAction">
): (action: MenuAction, ctx: MenuContext) => Promise<void> {
    const { apps, category, clipboard, system, display } = bundle;
    const { router } = deps;

    return async function onMenuAction(action: MenuAction, ctx: MenuContext) {
        if (action.kind === "add-item") return apps.onAddItem();
        if (action.kind === "edit-item") return apps.onEditItem();
        if (action.kind === "delete-item") return apps.onDeleteItem();
        if (action.kind === "add-category") return category.onAddCategory();
        if (action.kind === "delete-category") return category.onDeleteCategory();
        if (action.kind === "rename-category") return category.onRenameCategory();
        if (action.kind === "hide-window") return system.onHideWindow();
        if (action.kind === "set-category-cols") return display.onSetCategoryCols(action.cols);
        if (action.kind === "set-launcher-cols") return display.onSetLauncherCols(action.cols);
        if (action.kind === "set-category-sort-mode") {
            return display.onSetCategorySortMode(action.mode);
        }
        if (action.kind === "toggle-scenario-membership") {
            return apps.onToggleScenarioMembership(action.scenario);
        }
        if (action.kind === "clear-scenario-membership") return apps.onClearScenarioMembership();
        if (action.kind === "set-home-layout-preset") {
            const section = ctx.homeSection ?? action.section;
            return display.onSetHomeLayoutPreset(section, action.preset);
        }
        if (action.kind === "toggle-pinned" || action.kind === "toggle-favorite") {
            return apps.onTogglePinned();
        }
        if (action.kind === "copy-clipboard-item") return clipboard.onCopyClipboardItem();
        if (action.kind === "locate-clipboard-item") return clipboard.onLocateClipboardItem();
        if (action.kind === "locate-clipboard-item-in-history") {
            return clipboard.onLocateClipboardItemInHistory();
        }
        if (action.kind === "delete-clipboard-item") return clipboard.onDeleteClipboardItem();
        if (action.kind === "open-in-explorer") return system.onOpenInExplorer();
        if (action.kind === "block-external-item") return system.onBlockExternalItem();
        if (action.kind === "convert-external-item") return system.onConvertExternalItem();
        if (action.kind === "open-settings") return system.onOpenSettings();
        if (action.kind === "open-about") return system.onOpenAbout();
        if (action.kind === "open-guide") {
            router.push("/guide");
            return;
        }

        if (action.kind === "change-icon") {
            const base64 = await selectAndConvertIcon();
            if (base64) apps.onChangeIcon(base64);
            return;
        }

        if (action.kind === "reset-icon") return apps.onResetIcon();

        if (action.kind === "change-category-icon") {
            const base64 = await selectAndConvertIcon();
            if (base64) category.onChangeCategoryIcon(base64);
            return;
        }

        if (action.kind === "reset-category-icon") return category.onResetCategoryIcon();

        if (action.kind === "plugin-onclick") {
            await action.onClick(ctx);
            return;
        }

        if (action.kind === "plugin-command") {
            const commandId = action.commandId.includes(":")
                ? action.commandId
                : `${action.pluginId}:${action.commandId}`;
            // IR: iframe command registry removed; bridge warns + no-ops.
            executeLegacyPluginCommand(commandId, ctx);
        }
    };
}

import type { MenuAction, MenuContext } from "./contextMenuTypes";

/**
 * Optional DI action-handler registry (P6 预留 / P7 可用).
 *
 * 默认分发仍在 `useMenuActions.onMenuAction`（经 `menuAppsGateway` → `ctx.apps`）。
 * kernel 插件可 `registerActionHandler(kind, handler)` 注入自定义动作，
 * 由未来瘦 App.vue / 菜单插件在 dispatch 前查询 `getActionHandler`。
 *
 * 约束：handler 不得直写 store 内部 map；领域写走 `ctx.apps` / invoke-wrapper。
 */
export type ActionHandler = (
    action: MenuAction,
    ctx: MenuContext
) => void | Promise<void>;

const actionHandlers = new Map<string, ActionHandler>();

export function registerActionHandler(
    kind: string,
    handler: ActionHandler
): () => void {
    actionHandlers.set(kind, handler);
    return () => {
        if (actionHandlers.get(kind) === handler) {
            actionHandlers.delete(kind);
        }
    };
}

export function getActionHandler(kind: string): ActionHandler | undefined {
    return actionHandlers.get(kind);
}

export async function executeAction(
    action: MenuAction,
    ctx: MenuContext
): Promise<void> {
    const handler = actionHandlers.get(action.kind);
    if (handler) {
        await handler(action, ctx);
    }
}

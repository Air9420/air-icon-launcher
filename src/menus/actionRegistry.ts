import type { MenuAction, MenuContext } from "./contextMenuTypes";

export type ActionHandler = (
    action: MenuAction,
    ctx: MenuContext
) => void | Promise<void>;

const actionHandlers = new Map<string, ActionHandler>();

export function registerActionHandler(
    kind: string,
    handler: ActionHandler
) {
    actionHandlers.set(kind, handler);
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

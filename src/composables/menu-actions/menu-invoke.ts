/**
 * IPC for menu paths: prefer `ctx.ipc` (invoke-wrapper) when kernel is up;
 * fall back to invoke-wrapper directly. Never `@tauri-apps/api/core`.
 */
import { invokeOrThrow } from "../../utils/invoke-wrapper";
import { getKernelContext } from "../../kernel/context-access";

export async function menuInvoke<T>(
    cmd: string,
    args?: Record<string, unknown>
): Promise<T> {
    const kernel = getKernelContext();
    if (kernel?.ipc) {
        const result = await kernel.ipc.invoke<T>(cmd, args);
        if (!result.ok) throw result.error;
        return result.value;
    }
    return invokeOrThrow<T>(cmd, args);
}

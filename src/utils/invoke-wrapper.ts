import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { AppError } from "./app-error";
import { parseTauriError, isAppError, errorToString } from "./app-error";

export type { AppError };

export type InvokeResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: AppError };

let isPageUnloading = false;

export function setPageUnloading(value: boolean): void {
    isPageUnloading = value;
}

export function isPageUnloadingCheck(): boolean {
    return isPageUnloading;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<InvokeResult<T>> {
    try {
        if (isPageUnloading) {
            return {
                ok: false,
                error: { code: "CANCELLED", message: "页面正在卸载，操作已取消" } as AppError,
            };
        }
        const result = await tauriInvoke<T>(cmd, args);
        return { ok: true, value: result };
    } catch (err) {
        const error = parseTauriError(err);
        return { ok: false, error };
    }
}

export async function invokeOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const result = await invoke<T>(cmd, args);
    if (!result.ok) {
        throw result.error;
    }
    return result.value;
}

export async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
    const result = await invoke<T>(cmd, args);
    if (!result.ok) {
        console.error(`[${result.error.code}] ${result.error.message}`);
        return null;
    }
    return result.value;
}

export function isInvokeError<T>(result: InvokeResult<T>): result is { ok: false; error: AppError } {
    return !result.ok;
}

export function extractErrorCode(error: unknown): string {
    if (isAppError(error)) {
        return error.code;
    }
    return "UNKNOWN";
}

export function extractErrorMessage(error: unknown): string {
    if (isAppError(error)) {
        return error.message;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

export function formatInvokeError(result: InvokeResult<unknown>): string {
    if (result.ok) return "";
    return `[${result.error.code}] ${result.error.message}`;
}

export function handleInvokeError(error: unknown, fallback?: (error: AppError) => void): AppError | null {
    if (isAppError(error)) {
        fallback?.(error);
        return error;
    }
    const parsed = parseTauriError(error);
    fallback?.(parsed);
    return parsed;
}

export { errorToString, parseTauriError, isAppError };

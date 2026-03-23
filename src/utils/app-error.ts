export interface AppError {
    code: string;
    message: string;
    details?: unknown;
}

export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export function isAppError(value: unknown): value is AppError {
    return (
        typeof value === 'object' &&
        value !== null &&
        'code' in value &&
        'message' in value
    );
}

export function getErrorCode(error: unknown): string {
    if (isAppError(error)) {
        return error.code;
    }
    if (error instanceof Error) {
        return 'NATIVE_ERROR';
    }
    return 'UNKNOWN_ERROR';
}

export function getErrorMessage(error: unknown): string {
    if (isAppError(error)) {
        return error.message;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

export function getErrorDetails(error: unknown): unknown {
    if (isAppError(error)) {
        return error.details;
    }
    return undefined;
}

export function parseTauriError(error: unknown): AppError {
    if (isAppError(error)) {
        return error;
    }

    if (typeof error === 'string') {
        try {
            const parsed = JSON.parse(error);
            if (isAppError(parsed)) {
                return parsed;
            }
        } catch {}
        return { code: 'STRING_ERROR', message: error };
    }

    if (error instanceof Error) {
        return {
            code: 'NATIVE_ERROR',
            message: error.message,
            details: error.stack,
        };
    }

    return {
        code: 'UNKNOWN_ERROR',
        message: 'An unknown error occurred',
        details: error,
    };
}

export function errorToString(error: unknown): string {
    const appError = parseTauriError(error);
    let result = `[${appError.code}] ${appError.message}`;
    if (appError.details) {
        result += ` | Details: ${JSON.stringify(appError.details)}`;
    }
    return result;
}

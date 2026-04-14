import type { LauncherItem } from "../stores";

export type LauncherItemRef = {
    categoryId: string;
    itemId: string;
};

export type LauncherExecutionErrorCode =
    | "MISSING_ITEM"
    | "CIRCULAR_DEPENDENCY"
    | "LAUNCH_FAILED";

export class LauncherExecutionError extends Error {
    code: LauncherExecutionErrorCode;
    ref?: LauncherItemRef;
    cause?: unknown;

    constructor(
        code: LauncherExecutionErrorCode,
        message: string,
        options?: { ref?: LauncherItemRef; cause?: unknown }
    ) {
        super(message);
        this.name = "LauncherExecutionError";
        this.code = code;
        this.ref = options?.ref;
        this.cause = options?.cause;
    }
}

export type ExecutableLauncherItem = Pick<
    LauncherItem,
    "id" | "name" | "path" | "url" | "itemType" | "launchDependencies" | "launchDelaySeconds"
>;

export interface ExecuteLauncherItemOptions {
    target: LauncherItemRef;
    getItem: (categoryId: string, itemId: string) => ExecutableLauncherItem | null;
    launchItem: (item: ExecutableLauncherItem, ref: LauncherItemRef) => Promise<void>;
    wait?: (ms: number) => Promise<void>;
}

export interface ExecuteLauncherItemResult {
    launchedRefs: LauncherItemRef[];
}

function defaultWait(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function getRefKey(ref: LauncherItemRef): string {
    return `${ref.categoryId}:${ref.itemId}`;
}

function getRefLabel(item: ExecutableLauncherItem | null, ref: LauncherItemRef): string {
    if (item?.name?.trim()) return item.name.trim();
    return `${ref.categoryId}/${ref.itemId}`;
}

function getDelayMs(seconds: number | undefined): number {
    if (!Number.isFinite(seconds)) return 0;
    return Math.max(0, Math.floor(seconds ?? 0)) * 1000;
}

export async function executeLauncherItemWithDependencies(
    options: ExecuteLauncherItemOptions
): Promise<ExecuteLauncherItemResult> {
    const wait = options.wait ?? defaultWait;
    const launchedKeys = new Set<string>();
    const visitingKeys = new Set<string>();
    const visitingRefs: LauncherItemRef[] = [];
    const launchedRefs: LauncherItemRef[] = [];

    async function execute(
        ref: LauncherItemRef,
        executionMode: "primary" | "dependency",
        dependencyDelaySeconds: number = 0
    ): Promise<void> {
        const key = getRefKey(ref);
        if (launchedKeys.has(key)) {
            return;
        }

        if (visitingKeys.has(key)) {
            const cyclePath = [...visitingRefs, ref]
                .map((cycleRef) => {
                    const cycleItem = options.getItem(cycleRef.categoryId, cycleRef.itemId);
                    return getRefLabel(cycleItem, cycleRef);
                })
                .join(" -> ");
            throw new LauncherExecutionError(
                "CIRCULAR_DEPENDENCY",
                `检测到启动依赖循环：${cyclePath}`,
                { ref }
            );
        }

        const item = options.getItem(ref.categoryId, ref.itemId);
        if (!item) {
            throw new LauncherExecutionError(
                "MISSING_ITEM",
                `未找到启动项：${ref.categoryId}/${ref.itemId}`,
                { ref }
            );
        }

        visitingKeys.add(key);
        visitingRefs.push(ref);

        for (const dependency of item.launchDependencies ?? []) {
            await execute(
                {
                    categoryId: dependency.categoryId,
                    itemId: dependency.itemId,
                },
                "dependency",
                dependency.delayAfterSeconds
            );
        }

        visitingRefs.pop();
        visitingKeys.delete(key);

        if (executionMode === "primary") {
            const primaryDelayMs = getDelayMs(item.launchDelaySeconds);
            if (primaryDelayMs > 0) {
                await wait(primaryDelayMs);
            }
        }

        try {
            await options.launchItem(item, ref);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new LauncherExecutionError(
                "LAUNCH_FAILED",
                `启动“${getRefLabel(item, ref)}”失败：${reason}`,
                { ref, cause: error }
            );
        }

        launchedKeys.add(key);
        launchedRefs.push(ref);

        if (executionMode === "dependency") {
            const dependencyDelayMs = getDelayMs(dependencyDelaySeconds);
            if (dependencyDelayMs > 0) {
                await wait(dependencyDelayMs);
            }
        }
    }

    await execute(options.target, "primary");

    return { launchedRefs };
}

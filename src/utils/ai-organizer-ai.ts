import { getAppConfig, saveAppConfigPatch } from "./config-sync";
import { invokeOrThrow } from "./invoke-wrapper";
import type { OrganizerCategoryRule } from "./ai-organizer";

export type AIOrganizerConfig = {
    baseUrl: string;
    model: string;
    apiKey: string;
};

export type AIOrganizerRefineItem = {
    id: string;
    name: string;
    path: string;
    source: string;
    currentCategoryKey: string;
    currentReason: string;
    score: number;
};

export type AIOrganizerAssignment = {
    id: string;
    category_key: string;
    reason: string;
};

export type AIOrganizerRefineResponse = {
    assignments: AIOrganizerAssignment[];
};

export async function loadAIOrganizerConfig(): Promise<AIOrganizerConfig> {
    const config = await getAppConfig();
    return {
        baseUrl: config.ai_organizer_base_url,
        model: config.ai_organizer_model,
        apiKey: config.ai_organizer_api_key,
    };
}

export async function saveAIOrganizerConfig(patch: Partial<AIOrganizerConfig>): Promise<AIOrganizerConfig> {
    const next = await saveAppConfigPatch({
        ...(patch.baseUrl !== undefined ? { ai_organizer_base_url: patch.baseUrl.trim() } : {}),
        ...(patch.model !== undefined ? { ai_organizer_model: patch.model.trim() } : {}),
        ...(patch.apiKey !== undefined ? { ai_organizer_api_key: patch.apiKey.trim() } : {}),
    });

    return {
        baseUrl: next.ai_organizer_base_url,
        model: next.ai_organizer_model,
        apiKey: next.ai_organizer_api_key,
    };
}

export function isAIOrganizerConfigured(config: AIOrganizerConfig): boolean {
    return Boolean(config.baseUrl.trim() && config.model.trim() && config.apiKey.trim());
}

export async function refineOrganizerBatchWithAI(
    items: AIOrganizerRefineItem[],
    categories: OrganizerCategoryRule[]
): Promise<AIOrganizerRefineResponse> {
    return invokeOrThrow<AIOrganizerRefineResponse>("refine_installed_apps_with_ai", {
        request: {
            categories,
            items: items.map((item) => ({
                id: item.id,
                name: item.name,
                path: item.path,
                source: item.source,
                current_category_key: item.currentCategoryKey,
                current_reason: item.currentReason,
                score: item.score,
            })),
        },
    });
}

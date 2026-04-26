import { defineStore } from "pinia";
import { ref } from "vue";
import { createVersionedPersistConfig } from "../utils/versioned-persist";

export type WebAiExportRecord = {
    md5: string;
    exportedAt: number;
    itemCount: number;
    itemIds: string[];
};

const MAX_HISTORY = 5;

async function computeMd5(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export const useWebAiExportStore = defineStore(
    "webAiExport",
    () => {
        const exportHistory = ref<WebAiExportRecord[]>([]);

        function findByMd5(md5: string): WebAiExportRecord | undefined {
            return exportHistory.value.find(r => r.md5 === md5);
        }

        async function recordExport(itemIds: string[]): Promise<string> {
            const sortedIds = [...itemIds].sort();
            const content = JSON.stringify(sortedIds);
            const md5 = await computeMd5(content);

            exportHistory.value.unshift({
                md5,
                exportedAt: Date.now(),
                itemCount: sortedIds.length,
                itemIds: sortedIds,
            });

            if (exportHistory.value.length > MAX_HISTORY) {
                exportHistory.value = exportHistory.value.slice(0, MAX_HISTORY);
            }

            return md5;
        }

        async function buildIdMapping(
            md5: string,
            currentItemIds: string[]
        ): Promise<{
            valid: boolean;
            reason?: string;
            mapping?: Map<string, string>;
            isHistorical?: boolean;
        }> {
            const record = findByMd5(md5);

            if (!record) {
                return {
                    valid: false,
                    reason: "MD5 不在任何导出记录中，可能是旧版数据或伪造",
                    mapping: undefined,
                };
            }

            const sortedCurrentIds = [...currentItemIds].sort();
            const sameAsCurrent =
                sortedCurrentIds.length === record.itemCount &&
                sortedCurrentIds.every((id, i) => id === record.itemIds[i]);

            if (sameAsCurrent) {
                const identityMap = new Map<string, string>();
                for (const id of currentItemIds) {
                    identityMap.set(id, id);
                }
                return {
                    valid: true,
                    mapping: identityMap,
                    isHistorical: false,
                };
            }

            const historicalMap = new Map<string, string>();

            for (const historicalId of record.itemIds) {
                const normalizedHistorical = historicalId.replace(/^(a\d+):.*/, "$1");
                for (const currentId of currentItemIds) {
                    const normalizedCurrent = currentId.replace(/^(a\d+):.*/, "$1");
                    if (normalizedHistorical === normalizedCurrent) {
                        historicalMap.set(historicalId, currentId);
                        break;
                    }
                }
            }

            if (historicalMap.size < record.itemCount * 0.8) {
                return {
                    valid: false,
                    reason: `仅匹配到 ${historicalMap.size}/${record.itemCount} 项，扫描差异过大，请使用对应扫描的导出结果`,
                    mapping: undefined,
                };
            }

            return {
                valid: true,
                mapping: historicalMap,
                isHistorical: true,
            };
        }

        function clearHistory(): void {
            exportHistory.value = [];
        }

        return {
            exportHistory,
            recordExport,
            buildIdMapping,
            clearHistory,
        };
    },
    {
        persist: createVersionedPersistConfig("webAiExport", [
            "exportHistory",
        ]),
    }
);

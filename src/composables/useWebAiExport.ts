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

        async function validateForImport(
            md5: string,
            itemIds: string[]
        ): Promise<{ valid: boolean; reason?: string }> {
            const record = findByMd5(md5);
            if (!record) {
                return { valid: false, reason: "MD5 不在任何导出记录中，可能是旧版数据或伪造" };
            }

            const sortedImportIds = [...itemIds].sort();
            if (sortedImportIds.length !== record.itemCount) {
                return {
                    valid: false,
                    reason: `项目数量不匹配：导出时 ${record.itemCount} 项，当前 ${sortedImportIds.length} 项，请使用对应扫描的导出结果`,
                };
            }

            const sameIds = sortedImportIds.every((id, i) => id === record.itemIds[i]);
            if (!sameIds) {
                return {
                    valid: false,
                    reason: "导出时的软件列表与当前扫描不一致，请使用对应扫描的导出结果",
                };
            }

            return { valid: true };
        }

        function clearHistory(): void {
            exportHistory.value = [];
        }

        return {
            exportHistory,
            recordExport,
            validateForImport,
            clearHistory,
        };
    },
    {
        persist: createVersionedPersistConfig("webAiExport", [
            "exportHistory",
        ]),
    }
);

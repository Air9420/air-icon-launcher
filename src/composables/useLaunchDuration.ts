import { ref } from "vue";

export type LaunchDurationCategory = "accidental" | "brief" | "meaningful";

export type LaunchDurationRecord = {
    itemId: string;
    categoryId: string;
    durationMs: number;
    category: LaunchDurationCategory;
    recordedAt: number;
};

const ACCIDENTAL_THRESHOLD_MS = 3000;
const MEANINGFUL_THRESHOLD_MS = 30000;
const MAX_RECORDS = 500;

export function useLaunchDuration() {
    const durationRecords = ref<LaunchDurationRecord[]>([]);
    let lastLaunchStart: number | null = null;
    let lastLaunchRef: { categoryId: string; itemId: string } | null = null;

    function classifyDuration(durationMs: number): LaunchDurationCategory {
        if (durationMs < ACCIDENTAL_THRESHOLD_MS) return "accidental";
        if (durationMs < MEANINGFUL_THRESHOLD_MS) return "brief";
        return "meaningful";
    }

    function onLaunch(categoryId: string, itemId: string): void {
        const now = Date.now();

        if (lastLaunchStart && lastLaunchRef) {
            const durationMs = now - lastLaunchStart;
            const record: LaunchDurationRecord = {
                itemId: lastLaunchRef.itemId,
                categoryId: lastLaunchRef.categoryId,
                durationMs,
                category: classifyDuration(durationMs),
                recordedAt: now,
            };
            durationRecords.value.unshift(record);
            if (durationRecords.value.length > MAX_RECORDS) {
                durationRecords.value = durationRecords.value.slice(0, MAX_RECORDS);
            }
        }

        lastLaunchStart = now;
        lastLaunchRef = { categoryId, itemId };
    }

    function getMeaningfulLaunchCount(itemId: string): number {
        return durationRecords.value.filter(
            r => r.itemId === itemId && r.category === "meaningful"
        ).length;
    }

    function getAccidentalLaunchCount(itemId: string): number {
        return durationRecords.value.filter(
            r => r.itemId === itemId && r.category === "accidental"
        ).length;
    }

    function isLikelyAccidental(itemId: string): boolean {
        const accidental = getAccidentalLaunchCount(itemId);
        const meaningful = getMeaningfulLaunchCount(itemId);
        if (accidental + meaningful === 0) return false;
        return accidental > meaningful * 2;
    }

    return {
        durationRecords,
        onLaunch,
        classifyDuration,
        getMeaningfulLaunchCount,
        getAccidentalLaunchCount,
        isLikelyAccidental,
    };
}

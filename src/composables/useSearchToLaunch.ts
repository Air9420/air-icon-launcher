import { computed, ref } from "vue";

export type SearchSession = {
    keyword: string;
    resultCount: number;
    launchedItemId: string | null;
    launchedAt: number | null;
    startedAt: number;
};

const SESSION_TIMEOUT_MS = 30_000;
const MAX_SESSIONS = 200;

export function useSearchToLaunch() {
    const activeSessions = ref<Map<string, SearchSession>>(new Map());
    const completedSessions = ref<SearchSession[]>([]);

    const conversionRate = computed(() => {
        const sessions = completedSessions.value;
        if (sessions.length === 0) return 0;
        const launches = sessions.filter(s => s.launchedItemId !== null).length;
        return launches / sessions.length;
    });

    const keywordConversionRates = computed(() => {
        const rates = new Map<string, { searches: number; launches: number; rate: number }>();
        for (const session of completedSessions.value) {
            const existing = rates.get(session.keyword) || { searches: 0, launches: 0, rate: 0 };
            existing.searches++;
            if (session.launchedItemId !== null) existing.launches++;
            existing.rate = existing.searches > 0 ? existing.launches / existing.searches : 0;
            rates.set(session.keyword, existing);
        }
        return rates;
    });

    function startSearchSession(keyword: string, resultCount: number): string {
        const sessionId = `${keyword}:${Date.now()}`;
        const session: SearchSession = {
            keyword,
            resultCount,
            launchedItemId: null,
            launchedAt: null,
            startedAt: Date.now(),
        };
        activeSessions.value.set(sessionId, session);

        setTimeout(() => {
            const active = activeSessions.value.get(sessionId);
            if (active) {
                completeSession(sessionId);
            }
        }, SESSION_TIMEOUT_MS);

        return sessionId;
    }

    function recordLaunchFromSearch(sessionId: string, itemId: string): void {
        const session = activeSessions.value.get(sessionId);
        if (!session) return;
        session.launchedItemId = itemId;
        session.launchedAt = Date.now();
        completeSession(sessionId);
    }

    function completeSession(sessionId: string): void {
        const session = activeSessions.value.get(sessionId);
        if (!session) return;
        activeSessions.value.delete(sessionId);
        completedSessions.value.unshift(session);
        if (completedSessions.value.length > MAX_SESSIONS) {
            completedSessions.value = completedSessions.value.slice(0, MAX_SESSIONS);
        }
    }

    function getKeywordConversionRate(keyword: string): number {
        return keywordConversionRates.value.get(keyword)?.rate ?? 0;
    }

    function getBoostedSearchScore(keyword: string, baseScore: number): number {
        const rate = getKeywordConversionRate(keyword);
        if (rate <= 0) return baseScore;
        return Math.round(baseScore * (1 + rate));
    }

    return {
        activeSessions,
        completedSessions,
        conversionRate,
        keywordConversionRates,
        startSearchSession,
        recordLaunchFromSearch,
        getKeywordConversionRate,
        getBoostedSearchScore,
    };
}

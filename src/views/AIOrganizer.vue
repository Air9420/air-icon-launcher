<template>
    <div class="ai-organizer-page">
        <header class="hero" :class="{ collapsed: heroCollapsed }">
            <div class="hero-copy">
                <div class="section-header">
                    <div class="section-header-copy">
                        <div class="eyebrow">AI 首次整理向导</div>
                        <h1>自动扫描常用软件，并给出首批分类建议</h1>
                    </div>
                    <button class="panel-toggle-btn" type="button" @click="heroCollapsed = !heroCollapsed">
                        {{ heroCollapsed ? "展开说明" : "收起说明" }}
                    </button>
                </div>
                <p v-if="!heroCollapsed">
                    先由规则完成稳定粗分，再由 AI 对全部软件做二次复判。你只需要确认勾选结果，
                    点击一次即可生成首批分类。
                </p>
            </div>

            <div class="hero-stats">
                <div class="stat-card">
                    <span class="stat-label">扫描到的软件</span>
                    <strong>{{ scannedCount }}</strong>
                </div>
                <div class="stat-card">
                    <span class="stat-label">建议分类</span>
                    <strong>{{ categories.length }}</strong>
                </div>
                <div class="stat-card">
                    <span class="stat-label">将导入</span>
                    <strong>{{ selectedCount }}</strong>
                </div>
            </div>
        </header>

        <section class="toolbar">
            <div class="toolbar-copy">
                <div class="toolbar-title">整理预览</div>
                <div class="toolbar-subtitle">
                    可以取消不需要的项，再执行导入。
                </div>
            </div>

            <div class="toolbar-actions">
                <button class="ghost-btn" type="button" :disabled="isScanning" @click="scanInstalledApps">
                    {{ isScanning ? "扫描中..." : "重新扫描" }}
                </button>
                <button class="ghost-btn" type="button" @click="skipOrganizer">
                    先跳过
                </button>
                <button class="primary-btn" type="button" :disabled="!canApply" @click="applySuggestions">
                    {{ isApplying ? "导入中..." : "应用这批建议" }}
                </button>
            </div>
        </section>

        <section v-if="hasSuggestions" class="ai-panel" :class="{ collapsed: aiPanelCollapsed }">
            <div class="section-header">
                <div class="section-header-copy">
                    <div class="toolbar-title">AI 精修</div>
                    <div class="toolbar-subtitle">
                        {{
                            aiPanelCollapsed
                                ? `当前有 ${aiCandidateCount} 项可进行 AI 细修`
                                : `规则已经完成第一轮归类，AI 将对全部 ${aiCandidateCount} 项再次分类细修。`
                        }}
                    </div>
                </div>
                <button class="panel-toggle-btn" type="button" @click="aiPanelCollapsed = !aiPanelCollapsed">
                    {{ aiPanelCollapsed ? "展开配置" : "收起配置" }}
                </button>
            </div>

            <div class="ai-panel-actions">
                <span v-if="aiProgressText" class="ai-progress">{{ aiProgressText }}</span>
                <button class="ghost-btn" type="button" :disabled="!canExportWebAiPrompt" @click="exportWebAiPrompt">
                    {{ isExportingAiPrompt ? "导出中..." : "导出 Markdown" }}
                </button>
                <button class="primary-btn" type="button" :disabled="!canRefineWithAi" @click="refineAllItemsWithAI">
                    {{ isAiRefining ? "AI 精修中..." : `AI 精修全部项 (${aiCandidateCount})` }}
                </button>
            </div>

            <div v-if="!aiPanelCollapsed" class="ai-panel-body">
                <div class="ai-form">
                    <input v-model="aiBaseUrl" class="ai-input" type="text" spellcheck="false"
                        placeholder="接口地址，例如 https://api.openai.com/v1">
                    <input v-model="aiModel" class="ai-input" type="text" spellcheck="false"
                        placeholder="模型，例如 gpt-5.4-mini">
                    <input v-model="aiApiKey" class="ai-input" type="password" spellcheck="false" placeholder="API Key">
                </div>

                <div class="ai-config-actions">
                    <button class="ghost-btn" type="button" :disabled="isSavingAiConfig || isAiRefining"
                        @click="saveAiConfig">
                        {{ isSavingAiConfig ? "保存中..." : "保存 AI 配置" }}
                    </button>
                </div>

                <div class="web-ai-panel">
                    <div class="toolbar-title">网页 AI 精修</div>
                    <div class="toolbar-subtitle">
                        导出 Markdown 给网页 AI 处理，再把完整 JSON 粘贴回来即可。
                    </div>

                    <div class="web-ai-actions">
                        <button class="primary-btn" type="button" :disabled="!canApplyManualAiJson"
                            @click="applyManualAiJson">
                            {{ isApplyingManualAiJson ? "应用中..." : "应用网页 AI JSON" }}
                        </button>
                    </div>

                    <textarea v-model="manualAiJson" class="web-ai-textarea" spellcheck="false"
                        placeholder='把网页 AI 返回的完整 JSON 粘贴到这里，例如 { "assignments": [...] }' />
                </div>
            </div>
        </section>

        <section v-if="scanError" class="empty-state error-state">
            <h2>扫描失败</h2>
            <p>{{ scanError }}</p>
            <button class="primary-btn" type="button" @click="scanInstalledApps">重试扫描</button>
        </section>

        <section v-else-if="isScanning && !hasSuggestions" class="empty-state">
            <h2>正在扫描开始菜单和桌面入口</h2>
            <p>第一次整理只扫高价值入口，先保证结果稳定，再逐步扩展来源。</p>
        </section>

        <section v-else-if="!hasSuggestions" class="empty-state">
            <h2>暂时没有扫描到可导入的软件</h2>
            <p>可以先跳过，后续通过拖拽或右键菜单手动添加。</p>
        </section>

        <section v-else class="category-list">
            <article v-for="category in categories" :key="category.key" class="category-card">
                <header class="category-header">
                    <div>
                        <div class="category-title-row">
                            <button class="collapse-btn" type="button" @click="toggleCategoryCollapsed(category)">
                                <svg class="collapse-icon" :class="{ collapsed: category.collapsed }"
                                    viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M16 19L5 12l11-7z" />
                                </svg>
                            </button>
                            <h2>{{ category.name }}</h2>
                            <span class="category-count">
                                {{ getSelectedCount(category) }}/{{ category.items.length }}
                            </span>
                        </div>
                        <p>{{ category.description }}</p>
                    </div>

                    <button class="mini-btn" type="button" @click="toggleCategorySelection(category)">
                        {{ isCategoryFullySelected(category) ? "全部取消" : "全部选择" }}
                    </button>
                </header>

                <div class="item-grid" v-show="!category.collapsed">
                    <button v-for="item in category.items" :key="item.path" class="item-chip"
                        :class="{ selected: item.selected }" type="button" @click="item.selected = !item.selected">
                        <div class="item-icon">
                            <img v-if="item.icon_base64" :src="getIconSrc(item.icon_base64)" alt="" draggable="false">
                            <span v-else>{{ item.name.slice(0, 1) }}</span>
                        </div>

                        <div class="item-copy">
                            <strong>{{ item.name }}</strong>
                            <span>{{ item.reason }}</span>
                            <small>{{ item.source }}</small>
                        </div>
                    </button>
                </div>
            </article>
        </section>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { Store, useCategoryStore, useGuideStore, type LauncherItem } from "../stores";
import { showToast } from "../composables/useGlobalToast";
import {
    buildOrganizerSuggestions,
    getOrganizerCategories,
    getOrganizerCategoryRule,
    type InstalledAppScanItem,
    type OrganizerSuggestionCategory,
    type OrganizerSuggestionItem,
} from "../utils/ai-organizer";
import {
    isAIOrganizerConfigured,
    loadAIOrganizerConfig,
    refineOrganizerBatchWithAI,
    saveAIOrganizerConfig,
    type AIOrganizerAssignment,
    type AIOrganizerConfig,
    type AIOrganizerRefineResponse,
} from "../utils/ai-organizer-ai";
import { extractErrorMessage, invokeOrThrow } from "../utils/invoke-wrapper";

type DraftSuggestionItem = OrganizerSuggestionItem & {
    selected: boolean;
};

type DraftSuggestionCategory = Omit<OrganizerSuggestionCategory, "items"> & {
    collapsed: boolean;
    items: DraftSuggestionItem[];
};

const AI_BATCH_SIZE = 10;
const AI_BATCH_CONCURRENCY = 8;

const router = useRouter();
const launcherStore = Store();
const categoryStore = useCategoryStore();
const guideStore = useGuideStore();

const isScanning = ref(false);
const isApplying = ref(false);
const isSavingAiConfig = ref(false);
const isAiRefining = ref(false);
const isExportingAiPrompt = ref(false);
const isApplyingManualAiJson = ref(false);
const heroCollapsed = ref(true);
const aiPanelCollapsed = ref(true);
const scanError = ref("");
const aiProgressText = ref("");
const aiBaseUrl = ref("");
const aiModel = ref("");
const aiApiKey = ref("");
const manualAiJson = ref("");
const categories = ref<DraftSuggestionCategory[]>([]);

let unlistenIconUpdate: (() => void) | null = null;

const organizerCategories = getOrganizerCategories(true);

const scannedCount = computed(() =>
    categories.value.reduce((total, category) => total + category.items.length, 0)
);

const selectedCount = computed(() =>
    categories.value.reduce(
        (total, category) => total + category.items.filter((item) => item.selected).length,
        0
    )
);

const hasSuggestions = computed(() => categories.value.length > 0);
const canApply = computed(() => !isScanning.value && !isApplying.value && selectedCount.value > 0);
const aiCandidateItems = computed(() => categories.value.flatMap((category) => category.items));
const aiCandidateCount = computed(() => aiCandidateItems.value.length);
const canRefineWithAi = computed(
    () =>
        hasSuggestions.value &&
        !isScanning.value &&
        !isApplying.value &&
        !isSavingAiConfig.value &&
        !isAiRefining.value &&
        aiCandidateCount.value > 0
);
const canExportWebAiPrompt = computed(
    () => hasSuggestions.value && !isScanning.value && aiCandidateCount.value > 0 && !isExportingAiPrompt.value
);
const canApplyManualAiJson = computed(
    () =>
        hasSuggestions.value &&
        !isApplying.value &&
        !isAiRefining.value &&
        !isApplyingManualAiJson.value &&
        manualAiJson.value.trim().length > 0
);

onMounted(() => {
    void loadAiConfig();
    listen<{ launch_path: string; icon_base64: string | null }>(
        "installed-app-icon-update",
        (event) => {
            const { launch_path, icon_base64 } = event.payload;
            for (const category of categories.value) {
                for (const item of category.items) {
                    if (item.path === launch_path) {
                        item.icon_base64 = icon_base64;
                        break;
                    }
                }
            }
        }
    ).then((unlisten) => {
        unlistenIconUpdate = unlisten;
    });
    window.setTimeout(() => {
        void scanInstalledApps();
    }, 16);
});

onUnmounted(() => {
    if (unlistenIconUpdate) {
        unlistenIconUpdate();
    }
});

async function loadAiConfig() {
    try {
        syncAiConfigRefs(await loadAIOrganizerConfig());
    } catch (error) {
        console.error(error);
    }
}

async function saveAiConfig() {
    const config = getAiConfig();
    if (!config.baseUrl.trim() || !config.model.trim()) {
        showToast("请先填写 AI 接口地址和模型", { type: "error" });
        return;
    }

    isSavingAiConfig.value = true;
    try {
        syncAiConfigRefs(await saveAIOrganizerConfig(config));
        showToast("AI 配置已保存");
    } catch (error) {
        console.error(error);
        showToast(extractErrorMessage(error) || "AI 配置保存失败", { type: "error" });
    } finally {
        isSavingAiConfig.value = false;
    }
}

async function scanInstalledApps() {
    isScanning.value = true;
    scanError.value = "";
    aiProgressText.value = "";

    try {
        const items = await invokeOrThrow<InstalledAppScanItem[]>("scan_installed_apps");
        categories.value = buildOrganizerSuggestions(items).map((category) => ({
            ...category,
            collapsed: false,
            items: category.items.map((item) => ({
                ...item,
                selected: true,
            })),
        }));
    } catch (error) {
        const message = extractErrorMessage(error);
        scanError.value = message || "无法扫描已安装软件";
        categories.value = [];
    } finally {
        isScanning.value = false;
    }
}

async function refineAllItemsWithAI() {
    const candidates = [...aiCandidateItems.value];
    if (candidates.length === 0) {
        showToast("当前没有可供 AI 精修的软件");
        return;
    }

    const config = getAiConfig();
    if (!isAIOrganizerConfigured(config)) {
        showToast("请先填写并保存 AI 接口地址、模型和 API Key", { type: "error" });
        return;
    }

    isAiRefining.value = true;
    aiProgressText.value = `AI 精修 0/${candidates.length}`;

    try {
        const savedConfig = await saveAIOrganizerConfig(config);
        syncAiConfigRefs(savedConfig);

        let changedCount = 0;
        let processedCount = 0;
        let failedBatchCount = 0;

        const allBatches = chunkItems(candidates, AI_BATCH_SIZE);
        type BatchTask = {
            batch: typeof allBatches[0];
            promise: Promise<AIOrganizerRefineResponse>;
            batchIndex: number;
        };

        const pendingTasks: BatchTask[] = [];
        let nextBatchIndex = 0;

        const startTask = (batchIndex: number): BatchTask => {
            const batch = allBatches[batchIndex];
            const promise = refineOrganizerBatchWithAI(
                batch.map((item) => ({
                    id: item.path,
                    name: item.name,
                    path: item.path,
                    source: item.source,
                    currentCategoryKey: item.categoryKey,
                    currentReason: item.reason,
                    score: item.score,
                })),
                organizerCategories
            );
            return { batch, promise, batchIndex };
        };

        for (let i = 0; i < Math.min(allBatches.length, AI_BATCH_CONCURRENCY); i++) {
            pendingTasks.push(startTask(i));
            nextBatchIndex++;
        }

        while (pendingTasks.length > 0) {
            const settled = await Promise.race(
                pendingTasks.map((task) =>
                    task.promise
                        .then((value) => ({ task, status: "fulfilled" as const, value }))
                        .catch((reason) => ({ task, status: "rejected" as const, reason }))
                )
            );

            const taskIndex = pendingTasks.findIndex((t) => t.batchIndex === settled.task.batchIndex);
            if (taskIndex !== -1) {
                pendingTasks.splice(taskIndex, 1);
            }

            processedCount += settled.task.batch.length;

            if (settled.status === "fulfilled") {
                changedCount += applyAiAssignments(settled.value.assignments);
            } else {
                failedBatchCount += 1;
                console.error(settled.reason);
            }

            aiProgressText.value = `AI 精修 ${processedCount}/${candidates.length}`;

            if (nextBatchIndex < allBatches.length) {
                pendingTasks.push(startTask(nextBatchIndex));
                nextBatchIndex++;
            }
        }

        pruneAndSortCategories();
        if (failedBatchCount > 0) {
            showToast(
                `AI 已更新 ${changedCount} 项，另有 ${failedBatchCount} 批请求失败`,
                { type: "error" }
            );
        } else {
            showToast(
                changedCount > 0
                    ? `AI 已更新 ${changedCount} 项分类结果`
                    : "AI 没有调整现有分类"
            );
        }
    } catch (error) {
        console.error(error);
        showToast(extractErrorMessage(error) || "AI 精修失败", { type: "error" });
    } finally {
        isAiRefining.value = false;
    }
}

async function exportWebAiPrompt() {
    if (!aiCandidateItems.value.length) {
        showToast("当前没有可导出的 AI 精修数据");
        return;
    }

    isExportingAiPrompt.value = true;
    try {
        const selected = await save({
            defaultPath: `air_launcher_ai_refine_${formatLocalDateForFilename(new Date())}.md`,
            filters: [{ name: "Markdown", extensions: ["md"] }],
            title: "导出 AI 精修 Markdown",
        });

        if (!selected) {
            return;
        }

        const path = typeof selected === "string" ? selected : selected[0];
        await writeTextFile(path, buildWebAiMarkdownPrompt());
        showToast("AI 精修 Markdown 已导出");
    } catch (error) {
        console.error(error);
        showToast(extractErrorMessage(error) || "导出 Markdown 失败", { type: "error" });
    } finally {
        isExportingAiPrompt.value = false;
    }
}

async function applyManualAiJson() {
    if (!manualAiJson.value.trim()) {
        showToast("先粘贴网页 AI 返回的 JSON");
        return;
    }

    isApplyingManualAiJson.value = true;
    try {
        const assignments = parseManualAiJson(manualAiJson.value);
        const changedCount = applyAiAssignments(assignments);
        pruneAndSortCategories();
        showToast(
            changedCount > 0
                ? `已应用网页 AI 返回结果，更新 ${changedCount} 项`
                : "网页 AI 返回结果已读取，但没有改动现有分类"
        );
    } catch (error) {
        console.error(error);
        showToast(extractErrorMessage(error) || "网页 AI JSON 解析失败", { type: "error" });
    } finally {
        isApplyingManualAiJson.value = false;
    }
}

function getSelectedCount(category: DraftSuggestionCategory) {
    return category.items.filter((item) => item.selected).length;
}

function isCategoryFullySelected(category: DraftSuggestionCategory) {
    return category.items.every((item) => item.selected);
}

function toggleCategorySelection(category: DraftSuggestionCategory) {
    const nextSelected = !isCategoryFullySelected(category);
    category.items.forEach((item) => {
        item.selected = nextSelected;
    });
}

function toggleCategoryCollapsed(category: DraftSuggestionCategory) {
    category.collapsed = !category.collapsed;
}

async function applySuggestions() {
    if (!selectedCount.value) {
        showToast("至少保留一个软件后再导入");
        return;
    }

    isApplying.value = true;
    try {
        const nextCategories = [];
        const nextItemsByCategoryId: Record<string, LauncherItem[]> = {};

        for (const category of categories.value) {
            const selectedItems = category.items.filter((item) => item.selected);
            if (selectedItems.length === 0) continue;

            const categoryId = categoryStore.createCategoryId();
            nextCategories.push({
                id: categoryId,
                name: category.name,
                customIconBase64: null,
            });

            nextItemsByCategoryId[categoryId] = selectedItems.map((item) => {
                const iconBase64 = item.icon_base64 ?? null;
                return {
                    id: launcherStore.createLauncherItemId(),
                    name: item.name,
                    path: item.path,
                    itemType: "file",
                    isDirectory: false,
                    iconBase64,
                    originalIconBase64: iconBase64,
                    launchDependencies: [],
                    launchDelaySeconds: 0,
                };
            });
        }

        if (nextCategories.length === 0) {
            showToast("没有可导入的软件");
            return;
        }

        categoryStore.importCategories(nextCategories);
        launcherStore.importLauncherItems(nextItemsByCategoryId);
        launcherStore.importPinnedItemIds([]);
        launcherStore.importRecentUsedItems([]);
        await launcherStore.syncSearchIndex();

        guideStore.completeOnboarding();
        showToast(`已导入 ${selectedCount.value} 个软件，生成 ${nextCategories.length} 个分类`);
        await router.replace("/categories");
    } catch (error) {
        console.error(error);
        showToast("应用建议失败", { type: "error" });
    } finally {
        isApplying.value = false;
    }
}

async function skipOrganizer() {
    guideStore.skipOnboarding();
    await router.replace("/categories");
}

function getIconSrc(iconBase64: string) {
    if (iconBase64.startsWith("data:")) return iconBase64;
    return `data:image/png;base64,${iconBase64}`;
}

function getAiConfig(): AIOrganizerConfig {
    return {
        baseUrl: aiBaseUrl.value.trim(),
        model: aiModel.value.trim(),
        apiKey: aiApiKey.value.trim(),
    };
}

function buildWebAiMarkdownPrompt(): string {
    const payload = {
        categories: organizerCategories,
        items: aiCandidateItems.value.map((item) => ({
            id: item.path,
            name: item.name,
            path: item.path,
            source: item.source,
            current_category_key: item.categoryKey,
            current_category_name: item.categoryName,
            current_reason: item.reason,
        })),
    };

    return [
        "# Air Icon Launcher AI 精修任务",
        "",
        "请你根据下面的应用列表，对每个应用重新选择最合适的分类。",
        "",
        "要求：",
        "1. `category_key` 必须严格来自提供的分类列表",
        "2. 每个 `item` 都必须返回一条结果",
        "3. 优先依据软件名称本身的常识，其次参考路径、来源和当前分类",
        "4. 除非完全无法判断，否则不要使用 `other`",
        "5. 只输出完整 JSON，不要输出解释，不要输出 Markdown 代码块",
        "",
        "输出格式：",
        '{',
        '  "assignments": [',
        '    {',
        '      "id": "应用的 id",',
        '      "category_key": "分类 key",',
        '      "reason": "中文短句原因"',
        "    }",
        "  ]",
        "}",
        "",
        "下面是待处理数据：",
        "",
        "```json",
        JSON.stringify(payload, null, 2),
        "```",
        "",
    ].join("\n");
}

function parseManualAiJson(raw: string): AIOrganizerAssignment[] {
    const parsed = JSON.parse(stripJsonCodeFence(raw)) as {
        assignments?: Array<{
            id?: string;
            category_key?: string;
            reason?: string | null;
        }>;
    };

    if (!Array.isArray(parsed.assignments)) {
        throw new Error("JSON 中缺少 assignments 数组");
    }

    return parsed.assignments
        .filter((assignment) => typeof assignment?.id === "string" && typeof assignment?.category_key === "string")
        .map((assignment) => ({
            id: assignment.id as string,
            category_key: assignment.category_key as string,
            reason: typeof assignment.reason === "string" && assignment.reason.trim()
                ? assignment.reason.trim()
                : "网页 AI 未提供原因",
        }));
}

function stripJsonCodeFence(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("```")) {
        return trimmed;
    }

    return trimmed
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
}

function syncAiConfigRefs(config: AIOrganizerConfig) {
    aiBaseUrl.value = config.baseUrl;
    aiModel.value = config.model;
    aiApiKey.value = config.apiKey;
}

function chunkItems<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

function formatLocalDateForFilename(date: Date) {
    const pad2 = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function applyAiAssignments(assignments: AIOrganizerAssignment[]): number {
    let changedCount = 0;

    for (const assignment of assignments) {
        const found = findItemById(assignment.id);
        if (!found) {
            continue;
        }

        const rule = getOrganizerCategoryRule(assignment.category_key);
        const nextReason = `AI：${assignment.reason}`;
        const categoryChanged = found.category.key !== rule.key;
        const reasonChanged = found.item.reason !== nextReason;

        if (!categoryChanged && !reasonChanged) {
            continue;
        }

        found.item.categoryKey = rule.key;
        found.item.categoryName = rule.name;
        found.item.categoryDescription = rule.description;
        found.item.reason = nextReason;

        if (categoryChanged) {
            found.category.items.splice(found.index, 1);
            ensureDraftCategory(rule).items.unshift(found.item);
        }

        changedCount += 1;
    }

    return changedCount;
}

function ensureDraftCategory(rule: ReturnType<typeof getOrganizerCategoryRule>) {
    const existing = categories.value.find((category) => category.key === rule.key);
    if (existing) {
        existing.name = rule.name;
        existing.description = rule.description;
        return existing;
    }

    const created: DraftSuggestionCategory = {
        key: rule.key,
        name: rule.name,
        description: rule.description,
        collapsed: false,
        items: [],
    };
    categories.value.push(created);
    return created;
}

function findItemById(itemId: string) {
    for (const category of categories.value) {
        const index = category.items.findIndex((item) => item.path === itemId);
        if (index !== -1) {
            return {
                category,
                index,
                item: category.items[index],
            };
        }
    }
    return null;
}

function pruneAndSortCategories() {
    categories.value = categories.value
        .filter((category) => category.items.length > 0)
        .sort((left, right) => {
            if (left.key === "other" && right.key !== "other") return 1;
            if (right.key === "other" && left.key !== "other") return -1;
            return right.items.length - left.items.length || left.name.localeCompare(right.name);
        });
}
</script>

<style scoped>
.ai-organizer-page {
    height: 100vh;
    min-height: 0;
    box-sizing: border-box;
    padding: 18px;
    background:
        radial-gradient(circle at top left, rgba(96, 165, 250, 0.18), transparent 32%),
        radial-gradient(circle at top right, rgba(16, 185, 129, 0.16), transparent 28%),
        linear-gradient(180deg, var(--bg-color), color-mix(in srgb, var(--bg-color) 88%, #dbeafe 12%));
    color: var(--text-color);
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;

    /* 隐藏滚动条 */
    &::-webkit-scrollbar {
        display: none;
    }
}

.hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    margin-bottom: 20px;
}

.hero-copy,
.hero-stats,
.ai-panel,
.toolbar,
.category-card,
.empty-state {
    background: color-mix(in srgb, var(--card-bg) 88%, white 12%);
    border: 1px solid color-mix(in srgb, var(--border-color) 82%, white 18%);
    border-radius: 22px;
    box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
}

.hero-copy {
    padding: 28px;
}

.section-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
}

.section-header-copy {
    min-width: 0;
}

.panel-toggle-btn {
    min-height: 34px;
    padding: 0 12px;
    border: none;
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg-color) 84%, white 16%);
    color: var(--text-secondary);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
}

.panel-toggle-btn:hover {
    background: color-mix(in srgb, var(--bg-color) 76%, white 24%);
    color: var(--text-color);
}

.eyebrow {
    margin-bottom: 10px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--primary-color) 80%, white 20%);
}

.hero-copy h1 {
    margin: 0 0 14px;
    font-size: 30px;
    line-height: 1.2;
}

.hero.collapsed .hero-copy {
    padding: 20px 22px 16px;
}

.hero.collapsed .hero-copy h1 {
    margin-bottom: 0;
    font-size: 22px;
}

.hero-copy p {
    margin: 0;
    font-size: 14px;
    line-height: 1.7;
    color: var(--text-secondary);
}

.hero-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    padding: 14px;
}



.stat-card {
    padding: 14px;
    border-radius: 18px;
    background: color-mix(in srgb, var(--bg-color) 82%, white 18%);
    overflow: hidden;
}

.stat-label {
    display: block;
    margin-bottom: 8px;
    font-size: 12px;
    color: var(--text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.stat-card strong {
    display: block;
    font-size: 24px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 20px;
    margin-bottom: 20px;
}

.ai-panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px 20px;
    margin-bottom: 20px;
}

.ai-panel.collapsed {
    gap: 10px;
    padding-top: 14px;
    padding-bottom: 14px;
}

.ai-panel-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.ai-form {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
}

.ai-input {
    min-width: 0;
    height: 42px;
    padding: 0 14px;
    border: 1px solid color-mix(in srgb, var(--border-color) 84%, white 16%);
    border-radius: 12px;
    background: color-mix(in srgb, var(--bg-color) 82%, white 18%);
    color: var(--text-color);
    outline: none;
    box-shadow: none;
    font: inherit;
    appearance: none;
}

.ai-input::placeholder {
    color: var(--text-tertiary);
}

.ai-input:focus,
.ai-input:focus-visible {
    border-color: color-mix(in srgb, var(--primary-color) 55%, white 45%);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary-color) 18%, transparent 82%);
}

.ai-panel-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
}

.ai-config-actions {
    display: flex;
    justify-content: flex-end;
}

.web-ai-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 8px;
    border-top: 1px solid color-mix(in srgb, var(--border-color) 82%, white 18%);
}

.web-ai-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
}

.web-ai-textarea {
    width: 100%;
    min-height: 180px;
    padding: 12px 14px;
    border: 1px solid color-mix(in srgb, var(--border-color) 84%, white 16%);
    border-radius: 14px;
    background: color-mix(in srgb, var(--bg-color) 82%, white 18%);
    color: var(--text-color);
    outline: none;
    box-shadow: none;
    font: inherit;
    line-height: 1.5;
    resize: vertical;
    box-sizing: border-box;
}

.web-ai-textarea:focus,
.web-ai-textarea:focus-visible {
    border-color: color-mix(in srgb, var(--primary-color) 55%, white 45%);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary-color) 18%, transparent 82%);
}

.ai-progress {
    font-size: 12px;
    color: var(--text-secondary);
}

.toolbar-title {
    font-size: 16px;
    font-weight: 700;
}

.toolbar-subtitle {
    margin-top: 4px;
    font-size: 13px;
    color: var(--text-secondary);
}

.toolbar-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    width: 100%;
}

.collapse-action-btn {
    color: var(--text-secondary);
}

.primary-btn,
.ghost-btn,
.mini-btn,
.item-chip {
    border: none;
    outline: none;
    font: inherit;
}

.primary-btn,
.ghost-btn,
.mini-btn {
    cursor: pointer;
    transition: transform 0.15s ease, opacity 0.15s ease, box-shadow 0.15s ease;
}

.primary-btn:disabled,
.ghost-btn:disabled {
    cursor: not-allowed;
    opacity: 0.6;
}

.primary-btn {
    size: 20px !important;
    min-height: 42px;
    padding: 0 16px;
    border-radius: 12px;
    background: linear-gradient(135deg, #2563eb, #0f766e);
    color: #fff;
    box-shadow: 0 12px 30px rgba(37, 99, 235, 0.25);
    margin-left: auto;
}

.ghost-btn,
.mini-btn {
    min-height: 42px;
    padding: 0 16px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--bg-color) 84%, white 16%);
    color: var(--text-color);
}

.mini-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    height: 28px;
    padding: 0 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--primary-color) 14%, white 86%);
    color: var(--primary-color);
    font-size: 12px;
    font-weight: 700;
}

.collapse-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    color: var(--text-secondary);
    transition: background 0.15s ease;
}

.collapse-btn:hover {
    background: color-mix(in srgb, var(--bg-color) 72%, white 28%);
}

.collapse-icon {
    width: 16px;
    height: 16px;
    transition: transform 0.2s ease;
    transform: rotate(270deg);
}

.collapse-icon.collapsed {
    transform: rotate(180deg);
}

.category-header p {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--text-secondary);
}

.ghost-btn:hover,
.mini-btn:hover {
    transform: translateY(-1px);
}

.primary-btn:focus-visible,
.ghost-btn:focus-visible,
.mini-btn:focus-visible,
.item-chip:focus-visible {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary-color) 60%, white 40%);
}

.empty-state {
    padding: 36px 24px;
    text-align: center;
}

.empty-state h2 {
    margin: 0 0 10px;
    font-size: 20px;
}

.empty-state p {
    margin: 0 0 18px;
    color: var(--text-secondary);
}

.error-state {
    border-color: rgba(239, 68, 68, 0.22);
}

.category-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.category-card {
    padding: 18px;
}

.category-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
}

.category-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
}

.category-title-row h2 {
    margin: 0;
    font-size: 20px;
}

.category-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    height: 28px;
    padding: 0 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--primary-color) 14%, white 86%);
    color: var(--primary-color);
    font-size: 12px;
    font-weight: 700;
}

.category-header p {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--text-secondary);
}

.item-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
}

.item-chip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    border-radius: 16px;
    cursor: pointer;
    text-align: left;
    background: color-mix(in srgb, var(--bg-color) 78%, white 22%);
    box-sizing: border-box;
    transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
    overflow: hidden;
    min-width: 0;
}

.item-chip:hover {
    transform: translateY(-1px);
}

.item-chip.selected {
    background: color-mix(in srgb, var(--primary-color) 12%, rgb(107, 107, 107) 88%);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary-color) 32%, white 68%);
}

.item-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--bg-color) 72%, white 28%);
    flex-shrink: 0;
    overflow: hidden;
}

.item-icon img {
    width: 28px;
    height: 28px;
    object-fit: contain;
}

.item-icon span {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-secondary);
}

.item-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
}

.item-copy strong,
.item-copy span,
.item-copy small {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.item-copy strong {
    font-size: 12px;
    color: var(--text-color);
}

.item-copy span {
    font-size: 10px;
    color: var(--text-secondary);
}

.item-copy small {
    font-size: 8px;
    color: var(--text-tertiary);
}

@media (max-width: 900px) {
    .ai-form {
        grid-template-columns: 1fr;
    }
}
</style>

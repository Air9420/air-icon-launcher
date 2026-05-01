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

        <section v-if="hasSuggestions && pendingProposalCount > 0" class="rule-proposal-panel">
            <div class="section-header">
                <div class="section-header-copy">
                    <div class="toolbar-title">规则发现</div>
                    <div class="toolbar-subtitle">
                        AI 发现 {{ pendingProposalCount }} 条新规则，可一键应用到规则引擎
                    </div>
                </div>
                <div class="section-header-actions">
                    <button class="ghost-btn" type="button" @click="loadProposalsFromOverrides">
                        刷新
                    </button>
                    <button class="primary-btn" type="button" :disabled="pendingProposals.length === 0"
                        @click="approveAllProposals">
                        全部应用
                    </button>
                </div>
            </div>

            <div class="proposal-list">
                <div v-for="proposal in pendingProposals.slice(0, 10)" :key="proposal.id" class="proposal-card">
                    <div class="proposal-info">
                        <span class="proposal-badge" :class="proposal.rule.type">
                            {{ proposal.rule.type }}
                        </span>
                        <code class="proposal-value">{{ proposal.rule.value }}</code>
                        <span class="proposal-arrow">→</span>
                        <span class="proposal-category">{{ proposal.rule.categoryKey }}</span>
                        <span class="proposal-evidence">
                            {{ proposal.rule.evidence.length }} 个样本: {{ proposal.rule.evidence.slice(0, 3).join(", ") }}
                        </span>
                    </div>
                    <div class="proposal-actions">
                        <button class="ghost-btn small" type="button" @click="rejectSingleProposal(proposal.id)">
                            忽略
                        </button>
                        <button class="primary-btn small" type="button" @click="approveSingleProposal(proposal.id)">
                            应用
                        </button>
                    </div>
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
                    <button v-for="item in category.items" :key="item.aiRefId" class="item-chip"
                        :class="{ selected: item.selected }" type="button"
                        @click="item.selected = !item.selected"
                        @contextmenu="showMoveMenu(item, category, $event)">
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

                <div v-if="moveMenuTarget && moveMenuTarget.category === category" class="move-menu" @click.stop>
                    <div class="move-menu-title">移动到分类</div>
                    <button v-for="cat in organizerCategories.filter(c => c.key !== category.key)" :key="cat.key"
                        class="move-menu-item" type="button"
                        @click="moveItemToCategory(moveMenuTarget!.item, moveMenuTarget!.category, cat.key)">
                        {{ cat.name }}
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
import { Store, useCategoryStore, useGuideStore, useOverrideStore, buildOverrideKeys, type LauncherItem } from "../stores";
import { showToast } from "../composables/useGlobalToast";
import {
    buildOrganizerSuggestions,
    getOrganizerCategories,
    getOrganizerCategoryRule,
    shouldDefaultSelectOrganizerItem,
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
import { shouldSendToAI, getSuspicionReport } from "../utils/classification/ai-filter";
import { getCachedAICategory, setCachedAICategory } from "../utils/classification/ai-cache";
import { classifyInstalledApp, normalizeApp as normalizeAppForPipeline } from "../utils/classification";
import { discoverPatterns } from "../utils/classification/pattern-discovery";
import { useRuleProposalStore } from "../utils/classification/rule-proposal";
import { useWebAiExportStore } from "../composables/useWebAiExport";
import { extractErrorMessage, invokeOrThrow } from "../utils/invoke-wrapper";
import { writeTextFileViaCommand } from "../utils/system-commands";

type DraftSuggestionItem = OrganizerSuggestionItem & {
    selected: boolean;
    aiRefId: string;
    pathKey: string;
};

type DraftSuggestionCategory = Omit<OrganizerSuggestionCategory, "items"> & {
    collapsed: boolean;
    items: DraftSuggestionItem[];
};

type AssignmentCategory = {
    key: string;
    name: string;
    description: string;
};

const AI_BATCH_SIZE = 10;
const AI_BATCH_CONCURRENCY = 8;

const router = useRouter();
const launcherStore = Store();
const categoryStore = useCategoryStore();
const guideStore = useGuideStore();
const overrideStore = useOverrideStore();
const ruleProposalStore = useRuleProposalStore();
const webAiExportStore = useWebAiExportStore();

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
const organizerCategoryByKey = new Map(organizerCategories.map((category) => [category.key, category]));

const aiRefToPathKey = new Map<string, string>();
const pathKeyToAiRef = new Map<string, string>();
const iconCacheByPathKey = new Map<string, string>();
let aiRefSerial = 1;

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
            const pathKey = normalizePathKey(launch_path);
            const nextIcon = normalizeIconBase64(icon_base64);

            if (nextIcon) {
                iconCacheByPathKey.set(pathKey, nextIcon);
            }

            for (const category of categories.value) {
                for (const item of category.items) {
                    if (item.pathKey !== pathKey) {
                        continue;
                    }

                    if (nextIcon) {
                        item.icon_base64 = nextIcon;
                    } else if (!item.icon_base64) {
                        const cached = iconCacheByPathKey.get(pathKey);
                        if (cached) {
                            item.icon_base64 = cached;
                        }
                    }
                }
            }
        }
    ).then((unlisten) => {
        unlistenIconUpdate = unlisten;
    });
    document.addEventListener("click", closeMoveMenu);
    window.setTimeout(() => {
        void scanInstalledApps();
    }, 16);
});

onUnmounted(() => {
    document.removeEventListener("click", closeMoveMenu);
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
        resetAiRefMappings();
        categories.value = buildOrganizerSuggestions(items).map((category) => ({
            ...category,
            collapsed: false,
            items: category.items.map((item) => createDraftSuggestionItem(item)),
        }));
        rehydrateAllItemIcons();
        pruneAndSortCategories();
    } catch (error) {
        const message = extractErrorMessage(error);
        scanError.value = message || "无法扫描已安装软件";
        resetAiRefMappings();
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

        const filteredCandidates = candidates.filter((item) => {
            const cachedCategory = getCachedAICategory(normalizeAppForPipeline({
                name: item.name,
                path: item.path,
                icon_base64: item.icon_base64,
                source: item.source,
                publisher: item.publisher ?? null,
            }));
            if (cachedCategory) {
                if (cachedCategory !== item.categoryKey) {
                    const targetRule = organizerCategoryByKey.get(cachedCategory);
                    if (targetRule) {
                        item.categoryKey = cachedCategory;
                        item.categoryName = targetRule.name;
                        item.categoryDescription = targetRule.description;
                        item.reason = "AI 缓存命中";
                    }
                }
                return false;
            }

            const normalizedApp = normalizeAppForPipeline({
                name: item.name,
                path: item.path,
                icon_base64: item.icon_base64,
                source: item.source,
                publisher: item.publisher ?? null,
            });
            const result = classifyInstalledApp(normalizedApp);
            return shouldSendToAI(result);
        });

        if (filteredCandidates.length === 0) {
            showToast("所有软件已通过规则引擎和缓存覆盖，无需 AI 精修");
            return;
        }

        let changedCount = 0;
        let processedCount = 0;
        let failedBatchCount = 0;

        const allBatches = chunkItems(filteredCandidates, AI_BATCH_SIZE);
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
                batch.map((item) => {
                    const normalizedApp = normalizeAppForPipeline({
                        name: item.name,
                        path: item.path,
                        icon_base64: item.icon_base64,
                        source: item.source,
                        publisher: item.publisher ?? null,
                    });
                    const result = classifyInstalledApp(normalizedApp);
                    const suspicion = getSuspicionReport(result);
                    return {
                        id: item.aiRefId,
                        name: item.name,
                        path: item.path,
                        source: item.source,
                        publisher: item.publisher ?? null,
                        exeName: normalizedApp.exeName,
                        currentCategoryKey: item.categoryKey,
                        currentReason: item.reason,
                        currentConfidence: result.confidence,
                        ruleMatchedLayers: suspicion.isSuspicious
                            ? [...suspicion.signals, `confidence=${result.confidence}`]
                            : [`confidence=${result.confidence}`],
                        score: item.score,
                    };
                }),
                getCategoriesForAiRefine()
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
                for (const assignment of settled.value.assignments) {
                    const found = settled.task.batch.find(item => item.aiRefId === assignment.id);
                    if (found) {
                        const normalizedApp = normalizeAppForPipeline({
                            name: found.name,
                            path: found.path,
                            icon_base64: found.icon_base64,
                            source: found.source,
                            publisher: found.publisher ?? null,
                        });
                        setCachedAICategory(normalizedApp, assignment.category_key);
                    }
                }
            } else {
                failedBatchCount += 1;
                console.error(settled.reason);
            }

            aiProgressText.value = `AI 精修 ${processedCount}/${filteredCandidates.length}`;

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
        const itemIds = aiCandidateItems.value.map(item => item.aiRefId);
        const md5 = await webAiExportStore.recordExport(itemIds);
        const markdown = buildWebAiMarkdownPrompt(md5);
        await writeTextFileViaCommand(path, markdown);
        showToast(`AI 精修 Markdown 已导出（${itemIds.length} 项）`);
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
        const parsed = parseManualAiJson(manualAiJson.value);

        const itemIds = aiCandidateItems.value.map(item => item.aiRefId);
        const mappingResult = await webAiExportStore.buildIdMapping(parsed._scan_md5 || "", itemIds);

        if (!mappingResult.valid) {
            showToast(mappingResult.reason || "校验失败", { type: "error" });
            return;
        }

        const idMapping = mappingResult.mapping!;
        let changedCount = 0;
        const unmappedCount = { value: 0 };

        const mappedAssignments = parsed.assignments
            .map(assignment => {
                const historicalId = assignment.id;
                const currentId = idMapping.get(historicalId);
                if (!currentId) {
                    unmappedCount.value++;
                    return null;
                }
                return { ...assignment, id: currentId };
            })
            .filter(Boolean) as typeof parsed.assignments;

        if (mappingResult.isHistorical) {
            showToast(
                `检测到历史扫描结果，已自动映射 ${mappedAssignments.length}/${parsed.assignments.length} 项`,
                { duration: 4000 }
            );
        }

        changedCount = applyAiAssignments(mappedAssignments);
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

const moveMenuTarget = ref<{ item: DraftSuggestionItem; category: DraftSuggestionCategory } | null>(null);

function showMoveMenu(item: DraftSuggestionItem, category: DraftSuggestionCategory, event: MouseEvent) {
    event.stopPropagation();
    moveMenuTarget.value = { item, category };
}

function closeMoveMenu() {
    moveMenuTarget.value = null;
}

const pendingProposals = computed(() => ruleProposalStore.pendingProposals());
const pendingProposalCount = computed(() => ruleProposalStore.pendingProposals().length);

function loadProposalsFromOverrides() {
    const overrideMap = new Map<string, { name: string; publisherToken: string | null; exeName: string; nameTokens: string[] }>();
    for (const category of categories.value) {
        for (const item of category.items) {
            const normalized = normalizeAppForPipeline({
                name: item.name,
                path: item.path,
                icon_base64: item.icon_base64,
                source: item.source,
                publisher: item.publisher ?? null,
            });
            const keys = buildOverrideKeys(normalized);
            for (const key of keys) {
                if (!overrideMap.has(key)) {
                    overrideMap.set(key, {
                        name: normalized.name,
                        publisherToken: normalized.publisherToken,
                        exeName: normalized.exeName,
                        nameTokens: normalized.nameTokens,
                    });
                }
            }
        }
    }

    const proposals = discoverPatterns(
        overrideStore.categoryOverrides,
        (key) => overrideMap.get(key) ?? null
    );

    for (const proposal of proposals) {
        ruleProposalStore.addProposal(proposal);
    }
}

function approveSingleProposal(proposalId: string) {
    ruleProposalStore.approveProposal(proposalId);
}

function rejectSingleProposal(proposalId: string) {
    ruleProposalStore.rejectProposal(proposalId);
}

function approveAllProposals() {
    for (const proposal of ruleProposalStore.pendingProposals()) {
        ruleProposalStore.approveProposal(proposal.id);
    }
}

function moveItemToCategory(item: DraftSuggestionItem, fromCategory: DraftSuggestionCategory, targetCategoryKey: string) {
    if (fromCategory.key === targetCategoryKey) return;

    const targetRule = organizerCategoryByKey.get(targetCategoryKey);
    if (!targetRule) return;

    const normalizedApp = normalizeAppForPipeline({
        name: item.name,
        path: item.path,
        icon_base64: item.icon_base64,
        source: item.source,
        publisher: item.publisher ?? null,
    });
    overrideStore.addOverrideForApp(normalizedApp, targetCategoryKey, "user");

    const fromIndex = fromCategory.items.indexOf(item);
    if (fromIndex === -1) return;
    fromCategory.items.splice(fromIndex, 1);

    item.categoryKey = targetCategoryKey;
    item.categoryName = targetRule.name;
    item.categoryDescription = targetRule.description;
    item.reason = "用户手动修正";

    const targetCategory = categories.value.find(c => c.key === targetCategoryKey);
    if (targetCategory) {
        targetCategory.items.unshift(item);
    } else {
        const newCategory: DraftSuggestionCategory = {
            key: targetRule.key,
            name: targetRule.name,
            description: targetRule.description,
            collapsed: false,
            items: [item],
        };
        categories.value.push(newCategory);
    }

    if (fromCategory.items.length === 0) {
        const catIndex = categories.value.indexOf(fromCategory);
        if (catIndex !== -1) categories.value.splice(catIndex, 1);
    }

    closeMoveMenu();
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
                    hasCustomIcon: false,
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
        await launcherStore.importLauncherSnapshot({
            items: nextItemsByCategoryId,
            pinnedItemIds: [],
            recentUsedItems: [],
        });
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

function buildWebAiMarkdownPrompt(md5: string): string {
    const payload = {
        _scan_md5: md5,
        categories: getCategoriesForAiRefine(),
        items: aiCandidateItems.value.map((item) => ({
            id: item.aiRefId,
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
        "⚠️ **重要**：返回的 JSON 必须包含 `_scan_md5` 字段，值必须与输入完全一致，否则结果将被拒绝。",
        "",
        "要求：",
        "1. 返回的 JSON 必须包含 `_scan_md5` 字段，值必须为 `" + md5 + "`",
        "2. 每个 `item` 都必须返回一条结果，`id` 必须和输入完全一致",
        "3. 优先使用提供的分类 `category_key`",
        "4. 若确实无法归入现有分类，可新建分类：自定义 `category_key`，并补充 `category_name`、`category_description`",
        "5. 游戏加速器单独归到 `game_booster`，不要并入 `gaming`",
        "6. SDK、运行库、后台组件、无界面工具优先归到 `component`",
        "7. 除非完全无法判断，否则不要使用 `other`",
        "8. 只输出完整 JSON，不要输出解释，不要输出 Markdown 代码块",
        "",
        "输出格式：",
        '{',
        '  "_scan_md5": "扫描校验码（必须原样返回）",',
        '  "assignments": [',
        '    {',
        '      "id": "应用 id（必须原样返回）",',
        '      "category_key": "分类 key（可用已有 key，或新 key）",',
        '      "category_name": "当 category_key 是新 key 时必填",',
        '      "category_description": "当 category_key 是新 key 时建议填写",',
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

function parseManualAiJson(raw: string): { _scan_md5: string; assignments: AIOrganizerAssignment[] } {
    const parsed = JSON.parse(stripJsonCodeFence(raw)) as {
        _scan_md5?: string;
        assignments?: Array<{
            id?: string;
            category_key?: string;
            reason?: string | null;
            category_name?: string | null;
            category_description?: string | null;
        }>;
    };

    if (!Array.isArray(parsed.assignments)) {
        throw new Error("JSON 中缺少 assignments 数组");
    }

    const assignments = parsed.assignments
        .filter((assignment) => typeof assignment?.id === "string" && typeof assignment?.category_key === "string")
        .map((assignment) => ({
            id: assignment.id as string,
            category_key: normalizeCategoryKey(assignment.category_key as string),
            reason: typeof assignment.reason === "string" && assignment.reason.trim()
                ? assignment.reason.trim()
                : "网页 AI 未提供原因",
            category_name: typeof assignment.category_name === "string" && assignment.category_name.trim()
                ? assignment.category_name.trim()
                : undefined,
            category_description: typeof assignment.category_description === "string" && assignment.category_description.trim()
                ? assignment.category_description.trim()
                : undefined,
        }));

    return { _scan_md5: parsed._scan_md5 || "", assignments };
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

function normalizePathKey(path: string): string {
    return path
        .normalize("NFKC")
        .replace(/\\/g, "/")
        .replace(/\/+/g, "/")
        .trim()
        .toLowerCase();
}

function normalizeIconBase64(iconBase64: string | null | undefined): string | null {
    if (!iconBase64) {
        return null;
    }
    const trimmed = iconBase64.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeCategoryKey(rawKey: string): string {
    return rawKey
        .normalize("NFKC")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function getCategorySortRank(key: string): number {
    if (key === "other") return 3;
    if (key === "component") return 2;
    return 1;
}

function resetAiRefMappings() {
    aiRefToPathKey.clear();
    pathKeyToAiRef.clear();
    aiRefSerial = 1;
}

function getOrCreateAiRefId(pathKey: string): string {
    const existing = pathKeyToAiRef.get(pathKey);
    if (existing) {
        return existing;
    }

    const created = `a${aiRefSerial++}`;
    pathKeyToAiRef.set(pathKey, created);
    aiRefToPathKey.set(created, pathKey);
    return created;
}

function createDraftSuggestionItem(item: OrganizerSuggestionItem): DraftSuggestionItem {
    const pathKey = normalizePathKey(item.path);
    const normalizedIcon = normalizeIconBase64(item.icon_base64);
    if (normalizedIcon) {
        iconCacheByPathKey.set(pathKey, normalizedIcon);
    }

    return {
        ...item,
        icon_base64: normalizedIcon || iconCacheByPathKey.get(pathKey) || null,
        selected: item.categoryKey !== "component" && shouldDefaultSelectOrganizerItem(item),
        aiRefId: getOrCreateAiRefId(pathKey),
        pathKey,
    };
}

function rehydrateItemIcon(item: DraftSuggestionItem) {
    const normalizedIcon = normalizeIconBase64(item.icon_base64);
    if (normalizedIcon) {
        item.icon_base64 = normalizedIcon;
        iconCacheByPathKey.set(item.pathKey, normalizedIcon);
        return;
    }

    const cached = iconCacheByPathKey.get(item.pathKey);
    if (cached) {
        item.icon_base64 = cached;
    }
}

function rehydrateAllItemIcons() {
    for (const category of categories.value) {
        for (const item of category.items) {
            rehydrateItemIcon(item);
        }
    }
}

function getCategoriesForAiRefine(): AssignmentCategory[] {
    const merged = new Map<string, AssignmentCategory>();

    for (const category of organizerCategories) {
        merged.set(category.key, {
            key: category.key,
            name: category.name,
            description: category.description,
        });
    }

    for (const category of categories.value) {
        const normalizedKey = normalizeCategoryKey(category.key);
        if (!normalizedKey || merged.has(normalizedKey)) {
            continue;
        }
        merged.set(normalizedKey, {
            key: normalizedKey,
            name: category.name,
            description: category.description,
        });
    }

    return [...merged.values()];
}

function resolveAssignmentCategory(assignment: AIOrganizerAssignment): AssignmentCategory {
    const normalizedKey = normalizeCategoryKey(assignment.category_key);
    if (normalizedKey) {
        const builtin = organizerCategoryByKey.get(normalizedKey);
        if (builtin) {
            return {
                key: builtin.key,
                name: builtin.name,
                description: builtin.description,
            };
        }

        const existing = categories.value.find((category) => category.key === normalizedKey);
        if (existing) {
            return {
                key: existing.key,
                name: assignment.category_name?.trim() || existing.name,
                description: assignment.category_description?.trim() || existing.description,
            };
        }

        const categoryName = assignment.category_name?.trim();
        if (categoryName) {
            return {
                key: normalizedKey,
                name: categoryName,
                description: assignment.category_description?.trim() || "AI 新增细分类",
            };
        }
    }

    const fallback = getOrganizerCategoryRule("other");
    return {
        key: fallback.key,
        name: fallback.name,
        description: fallback.description,
    };
}

function applyAiAssignments(assignments: AIOrganizerAssignment[]): number {
    let changedCount = 0;

    for (const assignment of assignments) {
        const found = findItemById(assignment.id);
        if (!found) {
            continue;
        }

        const resolvedCategory = resolveAssignmentCategory(assignment);
        const nextReasonText = assignment.reason?.trim() ? assignment.reason.trim() : "AI 未提供原因";
        const nextReason = `AI：${nextReasonText}`;
        const categoryChanged = found.category.key !== resolvedCategory.key;
        const categoryNameChanged = found.item.categoryName !== resolvedCategory.name;
        const categoryDescriptionChanged = found.item.categoryDescription !== resolvedCategory.description;
        const reasonChanged = found.item.reason !== nextReason;

        if (!categoryChanged && !categoryNameChanged && !categoryDescriptionChanged && !reasonChanged) {
            continue;
        }

        if (categoryChanged) {
            const normalizedApp = normalizeAppForPipeline({
                name: found.item.name,
                path: found.item.path,
                icon_base64: found.item.icon_base64,
                source: found.item.source,
                publisher: found.item.publisher ?? null,
            });
            overrideStore.addOverrideForApp(normalizedApp, resolvedCategory.key, "ai");
        }

        found.item.categoryKey = resolvedCategory.key;
        found.item.categoryName = resolvedCategory.name;
        found.item.categoryDescription = resolvedCategory.description;
        found.item.reason = nextReason;
        rehydrateItemIcon(found.item);

        if (categoryChanged) {
            found.category.items.splice(found.index, 1);
            ensureDraftCategory(resolvedCategory).items.unshift(found.item);
        }

        if (resolvedCategory.key === "component" || !shouldDefaultSelectOrganizerItem(found.item)) {
            found.item.selected = false;
        }

        changedCount += 1;
    }

    return changedCount;
}

function ensureDraftCategory(rule: AssignmentCategory) {
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
    const normalizedId = itemId.trim();
    if (!normalizedId) {
        return null;
    }

    const targetPathKey = aiRefToPathKey.get(normalizedId) || normalizePathKey(normalizedId);
    for (const category of categories.value) {
        const index = category.items.findIndex(
            (item) => item.aiRefId === normalizedId || item.pathKey === targetPathKey
        );
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
    rehydrateAllItemIcons();
    categories.value = categories.value
        .filter((category) => category.items.length > 0)
        .sort((left, right) => {
            const rankDiff = getCategorySortRank(left.key) - getCategorySortRank(right.key);
            if (rankDiff !== 0) {
                return rankDiff;
            }
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
    position: relative;
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

.move-menu {
    position: absolute;
    right: 8px;
    top: 100%;
    z-index: 100;
    background: var(--color-bg-elevated, #2a2a2a);
    border: 1px solid var(--color-border, #444);
    border-radius: 8px;
    padding: 4px 0;
    min-width: 140px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);

    .move-menu-title {
        padding: 6px 12px;
        font-size: 11px;
        color: var(--color-text-secondary, #999);
        font-weight: 600;
    }

    .move-menu-item {
        display: block;
        width: 100%;
        padding: 6px 12px;
        border: none;
        background: none;
        color: var(--color-text, #eee);
        font-size: 13px;
        text-align: left;
        cursor: pointer;

        &:hover {
            background: var(--color-bg-hover, #3a3a3a);
        }
    }
}

.rule-proposal-panel {
    margin: 0 24px 16px;
    background: var(--color-bg-elevated, #2a2a2a);
    border: 1px solid var(--color-border, #444);
    border-radius: 12px;
    overflow: hidden;

    .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid var(--color-border, #444);

        .section-header-copy {
            flex: 1;
        }

        .section-header-actions {
            display: flex;
            gap: 8px;
        }
    }

    .proposal-list {
        max-height: 320px;
        overflow-y: auto;
        padding: 8px;
    }

    .proposal-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        border-radius: 8px;
        background: var(--color-bg, #1a1a1a);
        margin-bottom: 6px;

        &:last-child {
            margin-bottom: 0;
        }
    }

    .proposal-info {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        flex: 1;
        min-width: 0;
    }

    .proposal-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;

        &.publisher {
            background: #3b82f620;
            color: #60a5fa;
        }
        &.exe {
            background: #8b5cf620;
            color: #a78bfa;
        }
        &.keyword {
            background: #10b98120;
            color: #34d399;
        }
    }

    .proposal-value {
        font-size: 13px;
        color: var(--color-text, #eee);
        font-family: monospace;
        background: transparent;
        padding: 0;
    }

    .proposal-arrow {
        color: var(--color-text-secondary, #999);
    }

    .proposal-category {
        font-size: 13px;
        color: var(--color-accent, #3b82f6);
        font-weight: 500;
    }

    .proposal-evidence {
        font-size: 11px;
        color: var(--color-text-secondary, #999);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 200px;
    }

    .proposal-actions {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
    }

    .ghost-btn.small,
    .primary-btn.small {
        padding: 4px 12px;
        font-size: 12px;
    }
}
</style>

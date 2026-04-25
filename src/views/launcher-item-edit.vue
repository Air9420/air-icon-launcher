<template>
    <div
        class="item-edit-view"
        data-menu-type="Icon-View"
        :data-category-id="categoryId"
    >
        <header
            class="item-edit-header"
            data-menu-type="Icon-View"
            :data-category-id="categoryId"
            data-tauri-drag-region
        >
            <button
                class="back-btn"
                type="button"
                data-menu-type="Icon-View"
                :data-category-id="categoryId"
                @click="onBack"
                @mousedown.stop
            >
                返回
            </button>
            <div
                class="title"
                data-menu-type="Icon-View"
                :data-category-id="categoryId"
                data-tauri-drag-region
            >
                {{ isCreateMode ? '新建' : '编辑' }}
            </div>
        </header>

        <div v-if="isCreateMode || item" class="content">
            <div class="preview-wrapper">
                <div class="preview">
                    <img
                        v-if="previewIcon"
                        class="preview-img"
                        :src="getIconSrc(previewIcon)"
                        alt=""
                        draggable="false"
                    />
                    <div v-else class="preview-fallback">
                        {{ getFallbackText(name) }}
                    </div>
                </div>
                <button class="change-icon-btn" type="button" @click="onChangeIcon">
                    更换图标
                </button>
            </div>

            <div class="form">
                <label v-if="isCreateMode" class="field">
                    <div class="label">类型</div>
                    <select v-model="createItemType" class="input">
                        <option value="file">文件</option>
                        <option value="directory">文件夹</option>
                        <option value="url">网址</option>
                    </select>
                </label>

                <label class="field">
                    <div class="label">名称</div>
                    <input
                        v-model="name"
                        class="input"
                        type="text"
                        placeholder="请输入名称"
                    />
                </label>

                <label class="field">
                    <div class="label">{{ pathFieldLabel }}</div>
                    <input
                        v-if="isUrlItem"
                        v-model="url"
                        class="input url-input"
                        type="url"
                        placeholder="https://..."
                    />
                    <div v-else class="path-input-row">
                        <input
                            v-model="path"
                            class="input"
                            type="text"
                            :placeholder="pathPlaceholder"
                            :readonly="!isCreateMode"
                        />
                        <button
                            v-if="isCreateMode"
                            class="btn neutral small"
                            type="button"
                            @click="onBrowsePath"
                        >
                            浏览
                        </button>
                    </div>
                </label>

                <label class="field">
                    <div class="label">主项启动前等待（秒）</div>
                    <input
                        class="input"
                        type="number"
                        min="0"
                        step="1"
                        :value="launchDelaySeconds"
                        @input="onLaunchDelayInput"
                    />
                </label>

                <div class="field">
                    <div class="label">启动依赖</div>
                    <div class="dependency-picker">
                        <select
                            class="input dependency-select"
                            :value="selectedDependencyKey"
                            @change="onSelectedDependencyChange"
                        >
                            <option value="" disabled>
                                {{ availableDependencyCandidates.length > 0 ? "选择要添加的启动项" : "没有可添加的启动项" }}
                            </option>
                            <option
                                v-for="candidate in availableDependencyCandidates"
                                :key="candidate.key"
                                :value="candidate.key"
                            >
                                {{ candidate.label }}
                            </option>
                        </select>
                        <button
                            class="btn neutral"
                            type="button"
                            :disabled="!selectedDependencyKey || availableDependencyCandidates.length === 0"
                            @click="onAddDependency"
                        >
                            添加依赖
                        </button>
                    </div>

                    <div v-if="launchDependencies.length === 0" class="dependency-empty">
                        未配置启动依赖
                    </div>

                    <div v-else class="dependency-list">
                        <div
                            v-for="(dependency, index) in launchDependencies"
                            :key="`${dependency.categoryId}:${dependency.itemId}`"
                            class="dependency-item"
                        >
                            <div class="dependency-header">
                                <div class="dependency-name">
                                    {{ getDependencyLabel(dependency) }}
                                </div>
                                <div class="dependency-actions">
                                    <button
                                        class="btn neutral small"
                                        type="button"
                                        :disabled="index === 0"
                                        @click="moveDependency(index, -1)"
                                    >
                                        上移
                                    </button>
                                    <button
                                        class="btn neutral small"
                                        type="button"
                                        :disabled="index === launchDependencies.length - 1"
                                        @click="moveDependency(index, 1)"
                                    >
                                        下移
                                    </button>
                                    <button
                                        class="btn neutral small"
                                        type="button"
                                        @click="removeDependency(index)"
                                    >
                                        移除
                                    </button>
                                </div>
                            </div>

                            <label class="dependency-delay">
                                <span>启动后等待</span>
                                <input
                                    class="input dependency-delay-input"
                                    type="number"
                                    min="0"
                                    step="1"
                                    :value="dependency.delayAfterSeconds"
                                    @input="onDependencyDelayInput(index, $event)"
                                />
                                <span>秒</span>
                            </label>
                        </div>
                    </div>
                </div>

                <div class="actions">
                    <button class="btn primary" type="button" @click="onSave">
                        保存
                    </button>
                    <button v-if="!isCreateMode" class="btn danger" type="button" @click="onDelete">
                        删除
                    </button>
                </div>
            </div>
        </div>

        <div v-if="!isCreateMode && !item" class="empty">启动项不存在或已被删除</div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, watchEffect } from "vue";
import { useRoute, useRouter } from "vue-router";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Store, useCategoryStore } from "../stores";
import type { LaunchDependency, LauncherItem } from "../stores";
import { showToast } from "../composables/useGlobalToast";
import { useConfirmDialog } from "../composables/useConfirmDialog";
import { selectAndConvertIcon } from "../utils/iconUtils";

type CreateItemType = "file" | "directory" | "url";

const props = defineProps<{
    categoryId: string;
    itemId?: string;
}>();

const route = useRoute();
const router = useRouter();
const store = Store();
const categoryStore = useCategoryStore();
const { confirm } = useConfirmDialog();
const name = ref<string>("");
const url = ref<string>("");
const path = ref<string>("");
const launchDelaySeconds = ref<number>(0);
const launchDependencies = ref<LaunchDependency[]>([]);
const selectedDependencyKey = ref<string>("");
const isCreateMode = computed(() => !props.itemId || props.itemId === "new");
const hasCustomIcon = ref<boolean>(false);
const draftIconBase64 = ref<string | null>(null);
const createItemType = ref<CreateItemType>("file");

const item = computed<LauncherItem | null>(() => {
    if (isCreateMode.value) return null;
    return store.getLauncherItemById(props.categoryId, props.itemId!);
});

watch(
    item,
    (currentItem) => {
        if (!currentItem || !props.itemId) return;
        void store.hydrateMissingIconsForItems([
            {
                categoryId: props.categoryId,
                itemId: props.itemId,
            },
        ]);
    },
    { immediate: true }
);

watch(
    () => route.query.type,
    (value) => {
        if (!isCreateMode.value) return;
        const raw = Array.isArray(value) ? value[0] : value;
        createItemType.value = raw === "url" || raw === "directory" ? raw : "file";
    },
    { immediate: true }
);

const previewIcon = computed(() => item.value?.iconBase64 || draftIconBase64.value);
const isUrlItem = computed(() =>
    isCreateMode.value ? createItemType.value === "url" : item.value?.itemType === "url"
);
const pathFieldLabel = computed(() => {
    if (isUrlItem.value) return "网址";
    return createItemType.value === "directory" ? "文件夹路径" : "路径";
});
const pathPlaceholder = computed(() =>
    createItemType.value === "directory"
        ? "请输入文件夹路径"
        : "请输入文件或快捷方式路径"
);

const dependencyCandidates = computed(() => {
    if (!item.value && !isCreateMode.value) return [];

    return categoryStore.categories.flatMap((category) =>
        store
            .getLauncherItemsByCategoryId(category.id)
            .filter(
                (candidate) =>
                    !(item.value && category.id === props.categoryId && candidate.id === props.itemId)
            )
            .map((candidate) => ({
                key: `${category.id}:${candidate.id}`,
                categoryId: category.id,
                itemId: candidate.id,
                label: `${category.name} / ${candidate.name}`,
            }))
    );
});

const dependencyLabelMap = computed(() => {
    const map = new Map<string, string>();
    for (const candidate of dependencyCandidates.value) {
        map.set(candidate.key, candidate.label);
    }
    return map;
});

const availableDependencyCandidates = computed(() => {
    const selectedKeys = new Set(
        launchDependencies.value.map(
            (dependency: LaunchDependency) => `${dependency.categoryId}:${dependency.itemId}`
        )
    );
    return dependencyCandidates.value.filter((candidate) => !selectedKeys.has(candidate.key));
});

function normalizeDelaySeconds(value: string | number): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.floor(parsed));
}

function syncSelectedDependencyKey() {
    if (availableDependencyCandidates.value.length === 0) {
        selectedDependencyKey.value = "";
        return;
    }

    const stillAvailable = availableDependencyCandidates.value.some(
        (candidate) => candidate.key === selectedDependencyKey.value
    );
    if (!stillAvailable) {
        selectedDependencyKey.value = availableDependencyCandidates.value[0].key;
    }
}

watch(
    () => [props.categoryId, props.itemId, item.value?.id],
    () => {
        if (item.value) {
            name.value = item.value.name;
            url.value = item.value.url || "";
            path.value = item.value.path || "";
            launchDelaySeconds.value = item.value.launchDelaySeconds;
            launchDependencies.value = item.value.launchDependencies.map((dependency) => ({
                ...dependency,
            }));
            draftIconBase64.value = null;
        } else if (isCreateMode.value) {
            name.value = "";
            url.value = "";
            path.value = "";
            launchDelaySeconds.value = 0;
            launchDependencies.value = [];
            draftIconBase64.value = null;
        }
        syncSelectedDependencyKey();
    },
    { immediate: true }
);

watchEffect(() => {
    if (item.value) {
        hasCustomIcon.value = store.hasCustomIcon(props.categoryId, props.itemId!);
    } else {
        hasCustomIcon.value = !!draftIconBase64.value;
    }
});

watch(availableDependencyCandidates, () => {
    syncSelectedDependencyKey();
});

/**
 * 返回到类目启动台页面。
 */
function onBack() {
    // router.push({ name: "category", params: { categoryId: props.categoryId } });
    router.back();
}

/**
 * 保存启动项编辑结果。
 */
function onSave() {
    if (isCreateMode.value) {
        void createLauncherItem();
        return;
    }
    if (!item.value) return;

    const patch: {
        name: string;
        url?: string;
        path?: string;
        launchDependencies: LaunchDependency[];
        launchDelaySeconds: number;
    } = {
        name: name.value.trim(),
        launchDependencies: launchDependencies.value.map((dependency: LaunchDependency) => ({
            ...dependency,
            delayAfterSeconds: normalizeDelaySeconds(dependency.delayAfterSeconds),
        })),
        launchDelaySeconds: normalizeDelaySeconds(launchDelaySeconds.value),
    };

    if (item.value.itemType === 'url') {
        patch.url = url.value.trim();
        patch.path = '';
    }

    store.updateLauncherItem(props.categoryId, props.itemId!, patch);

    if (item.value.itemType === 'url' && !hasCustomIcon.value) {
        const currentUrl = url.value.trim();
        if (currentUrl && (currentUrl.startsWith("http://") || currentUrl.startsWith("https://"))) {
            fetchFaviconAsync(props.categoryId, props.itemId!, currentUrl);
        }
    }

    onBack();
}

function buildCreateItemName(): string {
    const trimmedName = name.value.trim();
    if (trimmedName) return trimmedName;

    if (isUrlItem.value) {
        const currentUrl = normalizeUrlInput(url.value.trim());
        try {
            return new URL(currentUrl).hostname;
        } catch {
            return currentUrl;
        }
    }

    return store.getNameFromPath(path.value.trim());
}

function normalizeUrlInput(rawUrl: string): string {
    if (!rawUrl) return rawUrl;
    if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
        return rawUrl;
    }
    return `https://${rawUrl}`;
}

async function createLauncherItem() {
    const finalName = buildCreateItemName().trim();
    if (!finalName) {
        showToast("名称不能为空", { type: "error" });
        return;
    }

    const normalizedDependencies = launchDependencies.value.map((dependency: LaunchDependency) => ({
        ...dependency,
        delayAfterSeconds: normalizeDelaySeconds(dependency.delayAfterSeconds),
    }));
    const normalizedLaunchDelay = normalizeDelaySeconds(launchDelaySeconds.value);

    if (isUrlItem.value) {
        const normalizedUrl = normalizeUrlInput(url.value.trim());
        if (!normalizedUrl) {
            showToast("网址不能为空", { type: "error" });
            return;
        }

        const itemId = store.createLauncherItemInCategory(props.categoryId, {
            name: finalName,
            url: normalizedUrl,
            itemType: "url",
            iconBase64: draftIconBase64.value,
            launchDependencies: normalizedDependencies,
            launchDelaySeconds: normalizedLaunchDelay,
        });

        if (!draftIconBase64.value) {
            fetchFaviconAsync(props.categoryId, itemId, normalizedUrl);
        }

        onBack();
        return;
    }

    const normalizedPath = path.value.trim();
    if (!normalizedPath) {
        showToast("路径不能为空", { type: "error" });
        return;
    }

    const itemId = store.createLauncherItemInCategory(props.categoryId, {
        name: finalName,
        path: normalizedPath,
        itemType: "file",
        isDirectory: createItemType.value === "directory",
        iconBase64: draftIconBase64.value,
        launchDependencies: normalizedDependencies,
        launchDelaySeconds: normalizedLaunchDelay,
    });

    if (!draftIconBase64.value) {
        void store.hydrateMissingIconsForItems([
            {
                categoryId: props.categoryId,
                itemId,
            },
        ]);
    }

    onBack();
}

function fetchFaviconAsync(categoryId: string, itemId: string, currentUrl: string) {
    invoke<string | null>("fetch_favicon_from_url", { url: currentUrl })
        .then((iconBase64) => {
            if (iconBase64) {
                store.updateLauncherItemIcon(categoryId, itemId, iconBase64);
            }
        })
        .catch((e) => {
            console.warn("Failed to fetch favicon:", e);
        });
}

/**
 * 删除当前启动项。
 */
async function onDelete() {
    if (isCreateMode.value || !item.value) return;

    const confirmed = await confirm({
        title: "删除启动项",
        message: `确定要删除 "${item.value.name}" 吗？`,
        confirmText: "删除",
        cancelText: "取消",
    });

    if (!confirmed) {
        return;
    }

    store.deleteLauncherItem(props.categoryId, props.itemId!);
    onBack();
}

/**
 * 将后端返回的 base64 转换为 img 可用的 data URL。
 */
function getIconSrc(iconBase64: string) {
    if (iconBase64.startsWith("data:")) return iconBase64;
    return `data:image/png;base64,${iconBase64}`;
}

/**
 * 获取无图标时的兜底文字。
 */
function getFallbackText(name: string) {
    const text = name.trim();
    if (!text) return "?";
    return text.slice(0, 1).toUpperCase();
}

function onLaunchDelayInput(event: Event) {
    const target = event.target as HTMLInputElement;
    launchDelaySeconds.value = normalizeDelaySeconds(target.value);
}

function onSelectedDependencyChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    selectedDependencyKey.value = target.value;
}

function onAddDependency() {
    const candidate = availableDependencyCandidates.value.find(
        (item) => item.key === selectedDependencyKey.value
    );
    if (!candidate) return;

    launchDependencies.value = [
        ...launchDependencies.value,
        {
            categoryId: candidate.categoryId,
            itemId: candidate.itemId,
            delayAfterSeconds: 0,
        },
    ];
    syncSelectedDependencyKey();
}

function removeDependency(index: number) {
    launchDependencies.value = launchDependencies.value.filter(
        (_dependency: LaunchDependency, currentIndex: number) => currentIndex !== index
    );
    syncSelectedDependencyKey();
}

function moveDependency(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= launchDependencies.value.length) return;

    const next = [...launchDependencies.value];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    launchDependencies.value = next;
}

function onDependencyDelayInput(index: number, event: Event) {
    const target = event.target as HTMLInputElement;
    const next = [...launchDependencies.value];
    next[index] = {
        ...next[index],
        delayAfterSeconds: normalizeDelaySeconds(target.value),
    };
    launchDependencies.value = next;
}

function getDependencyLabel(dependency: LaunchDependency) {
    return (
        dependencyLabelMap.value.get(`${dependency.categoryId}:${dependency.itemId}`) ||
        `已删除启动项 (${dependency.categoryId}/${dependency.itemId})`
    );
}

async function onChangeIcon() {
    const iconBase64 = await selectAndConvertIcon();
    if (!iconBase64) return;

    if (item.value) {
        store.setLauncherItemIcon(props.categoryId, props.itemId!, iconBase64);
    } else {
        draftIconBase64.value = iconBase64;
    }

    hasCustomIcon.value = true;
}

async function onBrowsePath() {
    if (!isCreateMode.value || isUrlItem.value) return;

    const selected = await open({
        directory: createItemType.value === "directory",
        multiple: false,
        filters: createItemType.value === "directory"
            ? undefined
            : [
                { name: "可执行文件与快捷方式", extensions: ["exe", "lnk", "url", "bat", "cmd"] },
                { name: "所有文件", extensions: ["*"] },
            ],
    });

    if (typeof selected === "string") {
        path.value = selected;
        if (!name.value.trim()) {
            name.value = buildCreateItemName();
        }
    }
}
</script>

<style lang="scss" scoped>
.item-edit-view {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    position: relative;
    background: var(--bg-color);
}

.item-edit-header {
    height: 52px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    background: var(--card-bg);
    border-bottom: 1px solid var(--border-color);
    backdrop-filter: var(--backdrop-blur);
}

.back-btn {
    border: 0;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--hover-bg);
    cursor: pointer;
    -webkit-app-region: no-drag;
    color: var(--text-color);
}

.back-btn:hover {
    background: var(--hover-bg-strong);
}

.title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-color);
}

.content {
    display: flex;
    gap: 16px;
    padding: 18px 16px;
}

.preview {
    width: 92px;
    height: 92px;
    border-radius: 20px;
    background: var(--card-bg);
    box-shadow: var(--card-shadow);
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
}

.preview-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
}

.change-icon-btn {
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-color-strong);
    background: var(--hover-bg);
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
}

.change-icon-btn:hover {
    background: var(--hover-bg-strong);
    color: var(--text-color);
}

.preview-img {
    width: 56px;
    height: 56px;
    object-fit: contain;
}

.preview-fallback {
    width: 56px;
    height: 56px;
    border-radius: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--icon-fallback-bg);
    font-weight: 800;
    color: var(--icon-fallback-text);
}

.form {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.path-input-row {
    display: flex;
    gap: 8px;
}

.field {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.label {
    font-size: 12px;
    color: var(--text-tertiary);
}

.input {
    width: 100%;
    height: 36px;
    padding: 0 10px;
    border-radius: 12px;
    border: 1px solid var(--border-color-strong);
    background: var(--input-bg);
    outline: none;
    -webkit-app-region: no-drag;
    color: var(--text-color);
    box-sizing: border-box;
}

.dependency-picker {
    display: flex;
    gap: 8px;
}

.dependency-select {
    flex: 1;
}

.dependency-empty {
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px dashed var(--border-color-strong);
    color: var(--text-tertiary);
    font-size: 12px;
}

.dependency-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.dependency-item {
    padding: 12px;
    border-radius: 14px;
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.dependency-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}

.dependency-name {
    font-size: 13px;
    color: var(--text-color);
    font-weight: 600;
}

.dependency-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
}

.dependency-delay {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-secondary);
    font-size: 12px;
}

.dependency-delay-input {
    width: 96px;
}

.actions {
    display: flex;
    gap: 10px;
    margin-top: 6px;
}

.btn {
    height: 36px;
    padding: 0 14px;
    border-radius: 12px;
    border: 0;
    cursor: pointer;
    -webkit-app-region: no-drag;
}

.btn.primary {
    background: var(--primary-color);
    color: #fff;
}

.btn.primary:hover {
    opacity: 0.9;
}

.btn.neutral {
    background: var(--hover-bg);
    color: var(--text-color);
}

.btn.neutral:hover:not(:disabled) {
    background: var(--hover-bg-strong);
}

.btn.danger {
    background: var(--hover-bg);
    color: var(--text-secondary);
}

.btn.danger:hover {
    background: var(--hover-bg-strong);
}

.btn.small {
    height: 30px;
    padding: 0 10px;
    border-radius: 10px;
    font-size: 12px;
}

.btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.empty {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    padding: 10px 14px;
    border-radius: 12px;
    background: var(--card-bg);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    font-size: 13px;
    pointer-events: none;
}
</style>

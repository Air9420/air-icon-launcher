<template>
    <div v-if="hasSelection" class="bulk-action-bar">
        <div class="bulk-action-main">
            <div class="bulk-selection-summary">已选 {{ selectedCount }} 项</div>
            <div class="bulk-action-buttons">
                <button
                    class="bulk-action-btn"
                    type="button"
                    :disabled="availableMoveCategories.length === 0"
                    @click="emit('toggle-move')"
                >
                    移动到
                </button>
                <button class="bulk-action-btn" type="button" @click="emit('toggle-edit')">
                    批量编辑
                </button>
                <button class="bulk-action-btn danger" type="button" @click="emit('delete-selected')">
                    删除
                </button>
                <button class="bulk-action-btn ghost" type="button" @click="emit('clear-selection')">
                    取消选择
                </button>
            </div>
        </div>

        <div v-if="activeBulkPanel === 'move'" class="bulk-action-panel">
            <select
                :value="bulkMoveTargetCategoryId"
                class="bulk-select"
                @change="emit('update:bulkMoveTargetCategoryId', ($event.target as HTMLSelectElement).value)"
            >
                <option value="" disabled>选择目标分类</option>
                <option
                    v-for="category in availableMoveCategories"
                    :key="category.id"
                    :value="category.id"
                >
                    {{ category.name }}
                </option>
            </select>
            <button
                class="bulk-action-btn primary"
                type="button"
                :disabled="!bulkMoveTargetCategoryId"
                @click="emit('move-selected')"
            >
                确认移动
            </button>
            <button class="bulk-action-btn ghost" type="button" @click="emit('close-panel')">
                取消
            </button>
        </div>

        <div v-else-if="activeBulkPanel === 'edit'" class="bulk-action-panel">
            <label class="bulk-input-label">
                <span>启动延迟（秒）</span>
                <input
                    :value="bulkLaunchDelayInput"
                    class="bulk-input"
                    type="number"
                    min="0"
                    step="1"
                    @input="emit('update:bulkLaunchDelayInput', ($event.target as HTMLInputElement).value)"
                />
            </label>
            <button class="bulk-action-btn primary" type="button" @click="emit('apply-bulk-edit')">
                应用
            </button>
            <button class="bulk-action-btn ghost" type="button" @click="emit('close-panel')">
                取消
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    hasSelection: boolean;
    selectedCount: number;
    availableMoveCategories: Array<{ id: string; name: string }>;
    activeBulkPanel: "move" | "edit" | null;
    bulkMoveTargetCategoryId: string;
    bulkLaunchDelayInput: string;
}>();

const emit = defineEmits<{
    (e: "toggle-move"): void;
    (e: "toggle-edit"): void;
    (e: "delete-selected"): void;
    (e: "clear-selection"): void;
    (e: "move-selected"): void;
    (e: "apply-bulk-edit"): void;
    (e: "close-panel"): void;
    (e: "update:bulkMoveTargetCategoryId", value: string): void;
    (e: "update:bulkLaunchDelayInput", value: string): void;
}>();
</script>

<style lang="scss" scoped>
.bulk-action-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: var(--card-bg);
    border-top: 1px solid var(--border-color);
    backdrop-filter: var(--backdrop-blur);
}

.bulk-action-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.bulk-selection-summary {
    font-size: 13px;
    color: var(--text-color);
    font-weight: 600;
}

.bulk-action-buttons {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.bulk-action-btn {
    border: 0;
    padding: 6px 12px;
    border-radius: 8px;
    background: var(--hover-bg);
    color: var(--text-color);
    font-size: 12px;
    cursor: pointer;
}

.bulk-action-btn:hover:not(:disabled) {
    background: var(--hover-bg-strong);
}

.bulk-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.bulk-action-btn.danger {
    background: color-mix(in srgb, var(--danger-color, #ef4444) 18%, transparent);
    color: var(--danger-color, #ef4444);
}

.bulk-action-btn.primary {
    background: color-mix(in srgb, var(--primary-color) 20%, transparent);
    color: var(--primary-color);
    font-weight: 600;
}

.bulk-action-btn.ghost {
    background: transparent;
    border: 1px solid var(--border-color);
}

.bulk-action-panel {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.bulk-select,
.bulk-input {
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-color);
    color: var(--text-color);
    padding: 6px 8px;
    font-size: 12px;
}

.bulk-input-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary);
}
</style>

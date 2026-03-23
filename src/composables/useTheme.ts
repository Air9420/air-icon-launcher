/**
 * @fileoverview 主题管理
 * 
 * 本模块提供应用主题的统一管理功能，包括：
 * - 主题切换（light/dark/system/transparent）
 * - 窗口特效开关
 * - 系统主题跟随
 * - CSS 变量同步
 * 
 * @module composables/useTheme
 * 
 * @requires vue - Vue 响应式系统
 * @requires pinia - Pinia Store
 * @requires ../stores - 应用 Store
 * 
 * @example
 * ```typescript
 * import { useTheme } from './composables/useTheme';
 * 
 * const {
 *   theme,
 *   windowEffectsEnabled,
 *   applyTheme,
 *   applyEffectsDisabled,
 *   watchThemeChanges,
 *   cleanupThemeWatcher,
 * } = useTheme();
 * 
 * // 应用初始主题
 * applyTheme(theme.value);
 * 
 * // 开始监听主题变化
 * watchThemeChanges();
 * 
 * // 组件卸载时清理
 * onBeforeUnmount(() => {
 *   cleanupThemeWatcher();
 * });
 * ```
 */

import { watch } from "vue";
import { storeToRefs } from "pinia";
import { useSettingsStore } from "../stores/settingsStore";

/**
 * 主题管理 Composable
 * 
 * 提供应用主题的统一管理功能。
 * 通过 CSS 变量（data-theme、data-effects-disabled）控制主题样式。
 * 
 * @returns {Object} 主题管理相关状态和方法
 * @returns {Ref<ThemeMode>} returns.theme - 当前主题模式
 * @returns {Ref<boolean>} returns.windowEffectsEnabled - 窗口特效是否启用
 * @returns {Function} returns.applyTheme - 应用主题
 * @returns {Function} returns.applyEffectsDisabled - 设置特效开关
 * @returns {Function} returns.watchThemeChanges - 开始监听主题变化
 * @returns {Function} returns.cleanupThemeWatcher - 清理主题监听器
 * 
 * @example
 * ```typescript
 * const { theme, applyTheme, watchThemeChanges } = useTheme();
 * 
 * // 应用主题
 * applyTheme('dark');
 * 
 * // 监听变化
 * watchThemeChanges();
 * ```
 * 
 * @remarks
 * - 主题通过 `data-theme` CSS 属性控制
 * - 特效通过 `data-effects-disabled` CSS 属性控制
 * - 支持跟随系统主题变化
 */
export function useTheme() {
    const settingsStore = useSettingsStore();
    const { theme, windowEffectsEnabled } = storeToRefs(settingsStore);

    /**
     * 应用主题到 DOM
     * 
     * 设置 document.documentElement 的 data-theme 属性，
     * CSS 样式会根据该属性切换主题变量。
     * 
     * @param {string} themeMode - 主题模式（light/dark/system/transparent）
     * @returns {void}
     * 
     * @example
     * ```typescript
     * applyTheme('dark');
     * applyTheme('system');
     * ```
     * 
     * @remarks
     * - 主题值会直接设置到 data-theme 属性
     * - CSS 样式通过 [data-theme="xxx"] 选择器匹配
     */
    function applyTheme(themeMode: string) {
        document.documentElement.setAttribute("data-theme", themeMode);
    }

    /**
     * 设置窗口特效开关
     * 
     * 设置 document.documentElement 的 data-effects-disabled 属性，
     * CSS 样式会根据该属性启用或禁用毛玻璃等特效。
     * 
     * @param {boolean} disabled - 是否禁用特效
     * @returns {void}
     * 
     * @example
     * ```typescript
     * applyEffectsDisabled(true);  // 禁用特效
     * applyEffectsDisabled(false); // 启用特效
     * ```
     * 
     * @remarks
     * - 禁用特效可提升低配置设备的性能
     * - 特效包括毛玻璃、阴影等视觉效果
     */
    function applyEffectsDisabled(disabled: boolean) {
        document.documentElement.setAttribute("data-effects-disabled", String(disabled));
    }

    let mediaQuery: MediaQueryList | null = null;
    let handleSystemThemeChange: (() => void) | null = null;

    /**
     * 监听主题变化
     * 
     * 设置响应式监听器，当主题或特效设置变化时自动应用。
     * 同时监听系统主题变化，实现 "跟随系统" 功能。
     * 
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onMounted(() => {
     *   watchThemeChanges();
     * });
     * ```
     * 
     * @remarks
     * 监听内容：
     * - `theme` ref 变化 → 应用新主题
     * - `windowEffectsEnabled` ref 变化 → 应用特效设置
     * - 系统主题媒体查询变化 → 如果当前是 system 模式，重新应用主题
     * 
     * @see {@link cleanupThemeWatcher} 清理监听器
     */
    function watchThemeChanges() {
        watch(theme, (newTheme) => {
            applyTheme(newTheme);
        });

        watch(windowEffectsEnabled, (enabled) => {
            applyEffectsDisabled(!enabled);
        });

        mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        handleSystemThemeChange = () => {
            if (theme.value === "system") {
                applyTheme("system");
            }
        };
        mediaQuery.addEventListener("change", handleSystemThemeChange);
    }

    /**
     * 清理主题监听器
     * 
     * 移除系统主题媒体查询的监听器。
     * 
     * @returns {void}
     * 
     * @example
     * ```typescript
     * onBeforeUnmount(() => {
     *   cleanupThemeWatcher();
     * });
     * ```
     * 
     * @remarks
     * - 应在组件 onBeforeUnmount 中调用
     * - 防止内存泄漏
     * - Vue 的 watch 会自动清理，无需手动处理
     */
    function cleanupThemeWatcher() {
        if (mediaQuery && handleSystemThemeChange) {
            mediaQuery.removeEventListener("change", handleSystemThemeChange);
        }
    }

    return {
        theme,
        windowEffectsEnabled,
        applyTheme,
        applyEffectsDisabled,
        watchThemeChanges,
        cleanupThemeWatcher,
    };
}

/**
 * useTheme 返回值类型
 * 
 * @typedef {Object} ThemeComposable
 */
export type ThemeComposable = ReturnType<typeof useTheme>;

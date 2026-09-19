import { ref, watch, type Ref } from "vue";
import { Service, type Context } from "cordis";
import type { AppConfigSnapshot } from "../../utils/config-sync";
import type { InvokeResult } from "../../utils/invoke-wrapper";

export type ThemeMode = "light" | "dark" | "system" | "transparent";
export type WindowEffectType = "blur" | "acrylic";

export type WindowEffectSupportInfo = {
  supported: boolean;
  blurSupported: boolean;
  acrylicSupported: boolean;
  fallbackEffectType: WindowEffectType | null;
  message: string | null;
  productName: string | null;
  displayVersion: string | null;
  buildNumber: number | null;
};

export type WindowEffectCompatibilityAction =
  | "unchanged"
  | "switched-effect"
  | "enabled-performance"
  | "performance-mode";

export type WindowEffectCompatibilityResult = {
  changed: boolean;
  action: WindowEffectCompatibilityAction;
  message?: string;
  resolvedEffectType: WindowEffectType | null;
  support: WindowEffectSupportInfo | null;
};

export function normalizeThemeMode(theme: unknown): ThemeMode {
  return theme === "light" || theme === "dark" || theme === "transparent"
    ? theme
    : "system";
}

export function normalizeWindowEffectType(type: unknown): WindowEffectType {
  return type === "acrylic" ? "acrylic" : "blur";
}

export function readBootLocalSettingsData(): Record<string, unknown> | null {
  try {
    const versionedRaw = localStorage.getItem("__versioned_settings__");
    if (versionedRaw) {
      const parsed = JSON.parse(versionedRaw) as { data?: unknown } | null;
      if (
        parsed
        && typeof parsed === "object"
        && parsed.data
        && typeof parsed.data === "object"
      ) {
        return parsed.data as Record<string, unknown>;
      }
    }

    const legacyRaw = localStorage.getItem("settings");
    if (!legacyRaw) return null;
    const legacyParsed = JSON.parse(legacyRaw);
    if (!legacyParsed || typeof legacyParsed !== "object") return null;
    return legacyParsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeFallbackEffectType(type: string | null): WindowEffectType | null {
  return type === "blur" || type === "acrylic" ? type : null;
}

function getWindowEffectLabel(type: WindowEffectType): string {
  return type === "acrylic" ? "Acrylic" : "Blur";
}

function buildCompatibilityMessage(
  support: WindowEffectSupportInfo | null,
  preferredType: WindowEffectType,
  resolvedEffectType: WindowEffectType | null,
): string {
  if (support?.message?.trim()) return support.message.trim();
  if (resolvedEffectType) {
    return `当前系统不建议启用 ${getWindowEffectLabel(preferredType)}，已自动切换为 ${getWindowEffectLabel(resolvedEffectType)}。`;
  }
  return "当前系统对窗口特效兼容性较差，已自动切换到性能模式。建议升级到较新的 Windows 10 / 11。";
}

/**
 * Cordis service bound to `ctx.theme`.
 *
 * Owns theme mode + performance/effects runtime state AND the window-effect
 * compatibility matrix (moved from settingsStore during store slim).
 * DOM: `data-theme` / `data-effects-disabled` on `documentElement`.
 *
 * FOUC invariant: `applyBootTheme()` still runs synchronously in bootstrap
 * BEFORE this service exists; constructor only seeds refs.
 *
 * Does NOT import pinia stores.
 */
export class ThemeService extends Service {
  readonly mode: Ref<ThemeMode> = ref<ThemeMode>("system");
  readonly performanceMode = ref(false);
  readonly windowEffectsEnabled = ref(true);
  readonly windowEffectType = ref<WindowEffectType>("blur");
  readonly knowsEffects = ref(false);
  readonly windowEffectSupport = ref<WindowEffectSupportInfo | null>(null);

  constructor(ctx: Context) {
    super(ctx, "theme");

    const local = readBootLocalSettingsData();
    this.mode.value = normalizeThemeMode(local?.theme);
    if (typeof local?.performanceMode === "boolean") {
      this.performanceMode.value = local.performanceMode;
      this.windowEffectsEnabled.value = !local.performanceMode;
      this.knowsEffects.value = true;
    }

    watch(this.mode, () => this.applyDom());
    watch(this.performanceMode, () => this.applyDom());
    watch(this.windowEffectsEnabled, () => this.applyDom());
  }

  applyDom(): void {
    const root = document.documentElement;
    root.setAttribute("data-theme", this.mode.value);
    if (this.knowsEffects.value) {
      const effectsDisabled =
        this.performanceMode.value || !this.windowEffectsEnabled.value;
      root.setAttribute("data-effects-disabled", String(effectsDisabled));
    }
  }

  seedFromLocal(mode: ThemeMode, performanceMode?: boolean): void {
    this.mode.value = normalizeThemeMode(mode);
    if (typeof performanceMode === "boolean") {
      this.performanceMode.value = performanceMode;
      this.windowEffectsEnabled.value = !performanceMode;
      this.knowsEffects.value = true;
    }
    this.applyDom();
  }

  syncFromConfig(config: AppConfigSnapshot): void {
    this.mode.value = normalizeThemeMode(config.theme);
    this.performanceMode.value = config.performance_mode ?? false;
    this.windowEffectsEnabled.value = !this.performanceMode.value;
    this.windowEffectType.value = normalizeWindowEffectType(config.window_effect_type);
    this.knowsEffects.value = true;
    this.applyDom();
  }

  async setMode(mode: ThemeMode): Promise<InvokeResult<AppConfigSnapshot>> {
    this.mode.value = normalizeThemeMode(mode);
    this.applyDom();
    return this.patchConfig({ theme: this.mode.value });
  }

  async setPerformanceModeLocal(
    enabled: boolean,
  ): Promise<InvokeResult<AppConfigSnapshot>> {
    this.performanceMode.value = enabled;
    this.windowEffectsEnabled.value = !enabled;
    if (enabled && this.mode.value === "transparent") {
      this.mode.value = "system";
    }
    this.knowsEffects.value = true;
    this.applyDom();
    return this.patchConfig({
      theme: this.mode.value,
      performance_mode: this.performanceMode.value,
    });
  }

  // ---------- window-effect compatibility matrix (from settingsStore) ----------

  private async ipcOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const result = await this.ctx.ipc.invoke<T>(cmd, args);
    if (!result.ok) throw result.error;
    return result.value;
  }

  private async persistWindowEffectPreferences(): Promise<void> {
    await this.patchConfig({
      theme: this.mode.value,
      performance_mode: this.performanceMode.value,
      window_effect_type: this.windowEffectType.value,
    });
  }

  async refreshWindowEffectSupport(): Promise<WindowEffectSupportInfo | null> {
    try {
      const support = await this.ipcOrThrow<WindowEffectSupportInfo>(
        "get_window_effect_support_info",
      );
      this.windowEffectSupport.value = support;
      return support;
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  private async disableWindowEffectsInternal(): Promise<void> {
    const previousTheme = this.mode.value;
    const previousPerformanceMode = this.performanceMode.value;
    const nextTheme = previousTheme === "transparent" ? "system" : previousTheme;
    const shouldPersist =
      nextTheme !== previousTheme || previousPerformanceMode !== true;

    this.mode.value = nextTheme;
    await this.ipcOrThrow("set_window_effects", { enabled: false });
    this.windowEffectsEnabled.value = false;
    this.performanceMode.value = true;
    this.knowsEffects.value = true;
    this.applyDom();

    if (shouldPersist) {
      await this.persistWindowEffectPreferences();
    }
  }

  async applyResolvedWindowEffect(
    preferredType: WindowEffectType,
  ): Promise<WindowEffectCompatibilityResult> {
    const support = await this.refreshWindowEffectSupport();
    const preferredSupported =
      preferredType === "blur"
        ? support?.blurSupported ?? true
        : support?.acrylicSupported ?? true;

    if (preferredSupported) {
      const shouldPersist =
        this.performanceMode.value || this.windowEffectType.value !== preferredType;
      await this.ipcOrThrow("set_window_effect_type", { effectType: preferredType });
      this.windowEffectsEnabled.value = true;
      this.performanceMode.value = false;
      this.windowEffectType.value = preferredType;
      this.knowsEffects.value = true;
      this.applyDom();
      if (shouldPersist) await this.persistWindowEffectPreferences();
      return {
        changed: false,
        action: "unchanged",
        resolvedEffectType: preferredType,
        support,
      };
    }

    const fallbackType = normalizeFallbackEffectType(support?.fallbackEffectType ?? null);
    if (fallbackType) {
      const shouldPersist =
        this.performanceMode.value || this.windowEffectType.value !== preferredType;
      await this.ipcOrThrow("set_window_effect_type", { effectType: fallbackType });
      this.windowEffectsEnabled.value = true;
      this.performanceMode.value = false;
      // Keep stored preference as the user's chosen type; runtime may fall back.
      this.windowEffectType.value = preferredType;
      this.knowsEffects.value = true;
      this.applyDom();
      if (shouldPersist) await this.persistWindowEffectPreferences();
      return {
        changed: true,
        action: "switched-effect",
        message: buildCompatibilityMessage(support, preferredType, fallbackType),
        resolvedEffectType: fallbackType,
        support,
      };
    }

    await this.disableWindowEffectsInternal();
    return {
      changed: true,
      action: "enabled-performance",
      message: buildCompatibilityMessage(support, preferredType, null),
      resolvedEffectType: null,
      support,
    };
  }

  async applyCurrentWindowEffectState(): Promise<WindowEffectCompatibilityResult> {
    const support = await this.refreshWindowEffectSupport();
    if (this.performanceMode.value) {
      await this.disableWindowEffectsInternal();
      return {
        changed: false,
        action: "performance-mode",
        resolvedEffectType: null,
        support,
      };
    }
    return this.applyResolvedWindowEffect(this.windowEffectType.value);
  }

  async setPerformanceMode(enabled: boolean): Promise<WindowEffectCompatibilityResult> {
    if (enabled) {
      const changed = !this.performanceMode.value || this.windowEffectsEnabled.value;
      await this.disableWindowEffectsInternal();
      return {
        changed,
        action: "enabled-performance",
        resolvedEffectType: null,
        support: this.windowEffectSupport.value,
      };
    }
    return this.applyResolvedWindowEffect(this.windowEffectType.value);
  }

  async setWindowEffectType(
    type: WindowEffectType,
    options: { applyRuntime?: boolean } = {},
  ): Promise<WindowEffectCompatibilityResult> {
    if (options.applyRuntime === false) {
      const shouldPersist = this.windowEffectType.value !== type;
      this.windowEffectType.value = type;
      if (shouldPersist) await this.persistWindowEffectPreferences();
      return {
        changed: false,
        action: "unchanged",
        resolvedEffectType: this.performanceMode.value ? null : type,
        support: this.windowEffectSupport.value,
      };
    }
    return this.applyResolvedWindowEffect(type);
  }

  formatError(error: InvokeResult<unknown> | null | undefined): string {
    if (!error || error.ok) return "";
    return `[${error.error.code}] ${error.error.message}`;
  }

  private patchConfig(
    partial: Partial<AppConfigSnapshot>,
  ): Promise<InvokeResult<AppConfigSnapshot>> {
    const settings = this.ctx.settings;
    if (settings) {
      return settings.patch(partial);
    }
    return this.ctx.ipc.invoke<AppConfigSnapshot>("patch_config", { patch: partial });
  }
}

import { ref, type Ref } from "vue";
import { Service, type Context } from "cordis";
import type { AppConfigSnapshot } from "../../utils/config-sync";
import type { AppError, InvokeResult } from "../../utils/invoke-wrapper";

/**
 * Cordis service bound to `ctx.settings`.
 *
 * Owns application config read/write over `ctx.ipc` (get_config / patch_config /
 * save_config). Also hosts thin write-path helpers so pinia settingsStore
 * stays a ref + one-line delegate.
 *
 * Does NOT import pinia stores.
 */
export class SettingsService extends Service {
  readonly config: Ref<AppConfigSnapshot | null> = ref(null);
  readonly loading = ref(false);
  readonly lastError = ref<AppError | null>(null);
  readonly hydrated = ref(false);

  constructor(ctx: Context) {
    super(ctx, "settings");
  }

  private begin(): void {
    this.loading.value = true;
  }

  private end(result: InvokeResult<unknown>): void {
    this.lastError.value = result.ok ? null : result.error;
    this.loading.value = false;
  }

  async hydrate(): Promise<InvokeResult<AppConfigSnapshot>> {
    this.begin();
    try {
      const result = await this.ctx.ipc.invoke<AppConfigSnapshot>("get_config");
      if (result.ok) {
        this.config.value = result.value;
        this.hydrated.value = true;
      }
      this.end(result);
      return result;
    } catch (e) {
      this.loading.value = false;
      throw e;
    }
  }

  async patch(
    partial: Partial<AppConfigSnapshot>,
  ): Promise<InvokeResult<AppConfigSnapshot>> {
    this.begin();
    try {
      const result = await this.ctx.ipc.invoke<AppConfigSnapshot>("patch_config", {
        patch: partial,
      });
      if (result.ok) {
        this.config.value = result.value;
      }
      this.end(result);
      return result;
    } catch (e) {
      this.loading.value = false;
      throw e;
    }
  }

  async save(config: AppConfigSnapshot): Promise<InvokeResult<void>> {
    this.begin();
    try {
      const result = await this.ctx.ipc.invoke<void>("save_config", { config });
      if (result.ok) {
        this.config.value = config;
      }
      this.end(result);
      return result;
    } catch (e) {
      this.loading.value = false;
      throw e;
    }
  }

  applyLocal(config: AppConfigSnapshot): void {
    this.config.value = config;
    this.hydrated.value = true;
    this.lastError.value = null;
  }

  /**
   * Unified write path for settingsStore adapters:
   * optional runtime IPC → patch_config → assign local ref.
   * Throws on failure (matches store setXxx semantics).
   */
  async applyTo<T>(
    localRef: Ref<T>,
    value: T,
    configPatch: Partial<AppConfigSnapshot>,
    options: { runtime?: () => Promise<void> } = {},
  ): Promise<void> {
    try {
      if (options.runtime) await options.runtime();
      const result = await this.patch(configPatch);
      if (!result.ok) throw result.error;
      localRef.value = value;
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  /** patch_config without touching a local ref (theme service / bulk paths). */
  async patchOnly(partial: Partial<AppConfigSnapshot>): Promise<AppConfigSnapshot> {
    const result = await this.patch(partial);
    if (!result.ok) throw result.error;
    return result.value;
  }

  formatError(error: AppError | null | undefined): string {
    if (!error) return "";
    return `[${error.code}] ${error.message}`;
  }
}

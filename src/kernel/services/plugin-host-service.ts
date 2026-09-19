import { ref, type Ref } from "vue";
import { Service, type Context } from "cordis";
import type { AppError, InvokeResult } from "../../utils/invoke-wrapper";
import type {
  PluginHostEventPayload,
  PluginHostManifest,
  PluginHostRuntimeInfo,
} from "../../types/plugin-host";

const HOST_EVENT_RING = 50;

/**
 * Cordis service bound to `ctx.pluginHost`.
 *
 * All IPC goes through `ctx.ipc` (invoke-wrapper). Mutating ops refresh
 * the reactive list from `plugin_host_list` so UI stays Host-consistent.
 *
 * Worker JS runtime is reserved (types/docs only) — not implemented in P3.
 */
export class PluginHostService extends Service {
  /** Runtime list from Rust Host; UI binds directly. */
  readonly plugins: Ref<PluginHostRuntimeInfo[]> = ref([]);
  readonly loading = ref(false);
  readonly lastError = ref<AppError | null>(null);
  /** Recent `plugin_host_event` / `plugin_host_bus` payloads (ring). */
  readonly hostEvents = ref<PluginHostEventPayload[]>([]);

  private busyCount = 0;

  constructor(ctx: Context) {
    super(ctx, "pluginHost");

    // Root fiber is ACTIVE at bootstrap; dispose tears listeners down.
    ctx.effect(() => {
      const offEvent = ctx.ipc.on<PluginHostEventPayload>("plugin_host_event", (event) => {
        this.pushHostEvent(event.payload);
      });
      const offBus = ctx.ipc.on<PluginHostEventPayload>("plugin_host_bus", (event) => {
        this.pushHostEvent(event.payload);
      });
      return () => {
        offEvent();
        offBus();
      };
    });
  }

  private pushHostEvent(payload: unknown): void {
    if (!payload || typeof payload !== "object") return;
    const body = payload as PluginHostEventPayload;
    if (typeof body.plugin_id !== "string") return;
    const next = this.hostEvents.value.concat(body);
    this.hostEvents.value =
      next.length > HOST_EVENT_RING ? next.slice(next.length - HOST_EVENT_RING) : next;
  }

  private async run<T>(fn: () => Promise<InvokeResult<T>>): Promise<InvokeResult<T>> {
    this.busyCount += 1;
    this.loading.value = true;
    try {
      const result = await fn();
      this.lastError.value = result.ok ? null : result.error;
      return result;
    } finally {
      this.busyCount -= 1;
      this.loading.value = this.busyCount > 0;
    }
  }

  /** Refresh reactive list from Host without toggling loading around callers. */
  private async syncList(): Promise<InvokeResult<PluginHostRuntimeInfo[]>> {
    const result = await this.ctx.ipc.invoke<PluginHostRuntimeInfo[]>("plugin_host_list");
    if (result.ok) {
      this.plugins.value = result.value;
    } else {
      this.lastError.value = result.error;
    }
    return result;
  }

  scan(): Promise<InvokeResult<PluginHostManifest[]>> {
    return this.run(() => this.ctx.ipc.invoke<PluginHostManifest[]>("plugin_host_scan"));
  }

  list(): Promise<InvokeResult<PluginHostRuntimeInfo[]>> {
    return this.run(() => this.syncList());
  }

  /** scan + list — primary UI entry after mount / refresh. */
  async refresh(): Promise<InvokeResult<PluginHostRuntimeInfo[]>> {
    return this.run(async () => {
      const scanned = await this.ctx.ipc.invoke<PluginHostManifest[]>("plugin_host_scan");
      if (!scanned.ok) {
        this.lastError.value = scanned.error;
        return {
          ok: false,
          error: scanned.error,
        } as InvokeResult<PluginHostRuntimeInfo[]>;
      }
      return this.syncList();
    });
  }

  load(id: string): Promise<InvokeResult<void>> {
    return this.run(async () => {
      const result = await this.ctx.ipc.invoke<void>("plugin_host_load", { id });
      if (result.ok) await this.syncList();
      return result;
    });
  }

  unload(id: string): Promise<InvokeResult<void>> {
    return this.run(async () => {
      const result = await this.ctx.ipc.invoke<void>("plugin_host_unload", { id });
      if (result.ok) await this.syncList();
      return result;
    });
  }

  invoke<T = unknown>(
    id: string,
    method: string,
    args: unknown = {},
  ): Promise<InvokeResult<T>> {
    return this.run(() =>
      this.ctx.ipc.invoke<T>("plugin_host_invoke", {
        id,
        method,
        args: args ?? {},
      }),
    );
  }

  setEnabled(id: string, enabled: boolean): Promise<InvokeResult<void>> {
    return this.run(async () => {
      const result = await this.ctx.ipc.invoke<void>("plugin_host_set_enabled", {
        id,
        enabled,
      });
      if (result.ok) await this.syncList();
      return result;
    });
  }

  install(path: string): Promise<InvokeResult<PluginHostManifest>> {
    return this.run(async () => {
      const result = await this.ctx.ipc.invoke<PluginHostManifest>("plugin_host_install", {
        path,
      });
      if (result.ok) await this.syncList();
      return result;
    });
  }

  uninstall(id: string): Promise<InvokeResult<void>> {
    return this.run(async () => {
      const result = await this.ctx.ipc.invoke<void>("plugin_host_uninstall", { id });
      if (result.ok) await this.syncList();
      return result;
    });
  }

  getLog(id: string): Promise<InvokeResult<string[]>> {
    return this.run(() => this.ctx.ipc.invoke<string[]>("plugin_host_get_log", { id }));
  }

  emitEvent(id: string, event: unknown): Promise<InvokeResult<void>> {
    return this.run(() =>
      this.ctx.ipc.invoke<void>("plugin_host_emit_event", { id, event }),
    );
  }

  /** Display helper for AppError / capability_denied. */
  formatError(error: AppError | null | undefined): string {
    if (!error) return "";
    return `[${error.code}] ${error.message}`;
  }
}

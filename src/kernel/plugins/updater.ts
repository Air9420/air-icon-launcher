import type { Context, Plugin } from "cordis";
import { useUpdateStore } from "../../stores/update";
import type { UpdateProgress } from "../../stores/update";
import type { Disposer } from "../types";
import type { SourceProbe } from "../../utils/updater";

type UpdateCheckResult = {
  available: boolean;
  version?: string;
  notes?: string;
  pub_date?: string;
  url?: string;
  signature?: string;
  source?: string;
  latest_json_url?: string;
  resumable_bytes?: number;
  current_version?: string;
  probes?: SourceProbe[];
};

type UpdateDownloadCompletePayload = {
  version: string;
};

/**
 * updater: setup update check + progress/log/complete listeners via ctx.ipc.
 * Replaces App.vue setupUpdateCheck / listenUpdateProgress (which double-registered progress).
 */
export const updaterPlugin: Plugin.Object<void> = {
  name: "updater",
  inject: ["ipc"],
  apply(ctx: Context) {
    const disposers: Disposer[] = [];

    // 日志同时进入 store，供更新对话框的日志面板展示
    const offLog = ctx.ipc.on<string>("update-log", (event) => {
      const updateStore = useUpdateStore();
      updateStore.appendLog(event.payload);
    });
    disposers.push(offLog);

    const offProgress = ctx.ipc.on<UpdateProgress>("update-progress", (event) => {
      const updateStore = useUpdateStore();
      updateStore.updateProgress = event.payload;
    });
    disposers.push(offProgress);

    const offComplete = ctx.ipc.on<UpdateDownloadCompletePayload>(
      "update-download-complete",
      (event) => {
        const updateStore = useUpdateStore();
        updateStore.appendLog(`安装完成: v${event.payload.version}`);
        updateStore.downloadComplete = true;
        updateStore.updateFilePath = null;
      },
    );
    disposers.push(offComplete);

    const doCheck = async () => {
      const updateStore = useUpdateStore();
      try {
        console.log("[updater] 开始自动检查更新");
        const result = await ctx.ipc.invoke<UpdateCheckResult>("check_update");
        console.log("[updater] check_update 返回:", result);
        if (!result.ok) {
          const detail =
            typeof result.error === "object" && result.error
              ? (result.error as { message?: string }).message ||
                JSON.stringify(result.error)
              : String(result.error);
          updateStore.appendLog(`检查更新失败: ${detail}`);
          console.error("自动检查更新失败:", result.error);
          return;
        }
        const check = result.value;
        if (check.available) {
          updateStore.updateInfo = {
            version: check.version!,
            notes: check.notes || "",
            pub_date: check.pub_date || new Date().toISOString(),
            platforms: {
              "windows-x86_64": {
                signature: check.signature || "",
                url: check.url || "",
              },
            },
            source: check.source,
            latestJsonUrl: check.latest_json_url || "",
            resumableBytes: check.resumable_bytes || 0,
            probes: check.probes || [],
          };
          // 只弹一个小提示问「是否进入更新页」，不再直接开完整弹窗
          updateStore.showUpdatePrompt();
        }
      } catch (error) {
        updateStore.appendLog(
          `检查更新异常: ${error instanceof Error ? error.message : String(error)}`,
        );
        console.error("自动检查更新失败:", error);
      }
    };

    if (document.readyState === "complete") {
      void doCheck();
    } else {
      const onLoad = () => {
        void doCheck();
      };
      window.addEventListener("load", onLoad);
      disposers.push(() => window.removeEventListener("load", onLoad));
    }

    return () => {
      for (const dispose of disposers) dispose();
    };
  },
};

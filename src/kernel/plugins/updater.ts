import type { Context, Plugin } from "cordis";
import { useUpdateStore } from "../../stores/update";
import type { UpdateProgress } from "../../stores/update";
import type { Disposer } from "../types";

type UpdateCheckResult = {
  available: boolean;
  version?: string;
  notes?: string;
  pub_date?: string;
  url?: string;
  signature?: string;
  source?: string;
  latest_json_url?: string;
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

    const offLog = ctx.ipc.on<string>("update-log", (event) => {
      console.log("[更新]", event.payload);
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
        console.log("[更新] 安装完成:", event.payload);
        const updateStore = useUpdateStore();
        updateStore.downloadComplete = true;
        updateStore.updateFilePath = null;
      },
    );
    disposers.push(offComplete);

    const doCheck = async () => {
      const updateStore = useUpdateStore();
      try {
        const result = await ctx.ipc.invoke<UpdateCheckResult>("check_update");
        if (!result.ok) {
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
          };
          updateStore.showUpdateDialog = true;
        }
      } catch (error) {
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

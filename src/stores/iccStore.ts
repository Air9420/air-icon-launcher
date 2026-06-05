import { defineStore } from "pinia";
import { ref } from "vue";
import { invokeOrThrow } from "../utils/invoke-wrapper";
import type { IccProfile, MonitorInfo } from "../types/icc";

export const useIccStore = defineStore("icc", () => {
  const profiles = ref<IccProfile[]>([]);
  const monitors = ref<MonitorInfo[]>([]);
  const loading = ref<boolean>(false);
  const error = ref<string>("");

  async function fetchMonitors() {
    try {
      monitors.value = await invokeOrThrow<MonitorInfo[]>("get_monitors");
    } catch (e) {
      console.error("Failed to fetch monitors:", e);
    }
  }

  async function fetchProfiles() {
    try {
      profiles.value = await invokeOrThrow<IccProfile[]>("get_icc_profiles");
    } catch (e) {
      console.error("Failed to fetch ICC profiles:", e);
    }
  }

  async function addProfile(profile: IccProfile) {
    try {
      await invokeOrThrow("add_icc_profile", { profile });
      profiles.value.push(profile);
    } catch (e) {
      console.error("Failed to add ICC profile:", e);
      throw e;
    }
  }

  async function removeProfile(profileId: string) {
    try {
      await invokeOrThrow("remove_icc_profile", { profileId });
      profiles.value = profiles.value.filter((p) => p.id !== profileId);
    } catch (e) {
      console.error("Failed to remove ICC profile:", e);
      throw e;
    }
  }

  async function toggleProfile(profileId: string, enabled: boolean) {
    const startTime = performance.now();
    try {
      await invokeOrThrow("toggle_icc_profile", { profileId, enabled });
      console.log(`[ICC Store] toggle_icc_profile IPC 完成: ${(performance.now() - startTime).toFixed(0)}ms`);
      // 本地更新状态，避免额外的 IPC 调用
      if (enabled) {
        // 禁用同一显示器的其他配置
        const profile = profiles.value.find((p) => p.id === profileId);
        if (profile) {
          profiles.value = profiles.value.map((p) => ({
            ...p,
            enabled: p.monitorName === profile.monitorName ? p.id === profileId : p.enabled,
          }));
        }
      } else {
        const idx = profiles.value.findIndex((p) => p.id === profileId);
        if (idx !== -1) {
          profiles.value[idx] = { ...profiles.value[idx], enabled: false };
        }
      }
    } catch (e) {
      console.error(`[ICC Store] toggle_icc_profile 失败: ${(performance.now() - startTime).toFixed(0)}ms`, e);
      throw e;
    }
  }

  async function applyProfile(profileId: string) {
    const startTime = performance.now();
    try {
      await invokeOrThrow("apply_icc_profile", { profileId });
      console.log(`[ICC Store] apply_icc_profile IPC 完成: ${(performance.now() - startTime).toFixed(0)}ms`);
    } catch (e) {
      console.error(`[ICC Store] apply_icc_profile 失败: ${(performance.now() - startTime).toFixed(0)}ms`, e);
      throw e;
    }
  }

  async function applyLutOnly(profileId: string) {
    const startTime = performance.now();
    try {
      await invokeOrThrow("apply_icc_lut_only", { profileId });
      console.log(`[ICC Store] apply_icc_lut_only IPC 完成: ${(performance.now() - startTime).toFixed(0)}ms`);
    } catch (e) {
      console.error(`[ICC Store] apply_icc_lut_only 失败: ${(performance.now() - startTime).toFixed(0)}ms`, e);
      throw e;
    }
  }

  async function restoreDefault(profileId: string) {
    const startTime = performance.now();
    try {
      await invokeOrThrow("restore_default_icc", { profileId });
      console.log(`[ICC Store] restore_default_icc IPC 完成: ${(performance.now() - startTime).toFixed(0)}ms`);
    } catch (e) {
      console.error(`[ICC Store] restore_default_icc 失败: ${(performance.now() - startTime).toFixed(0)}ms`, e);
      throw e;
    }
  }

  async function selectIccFile(): Promise<string | null> {
    try {
      return await invokeOrThrow<string | null>("select_icc_file");
    } catch (e) {
      console.error("Failed to select ICC file:", e);
      return null;
    }
  }

  async function getSystemProfiles(): Promise<string[]> {
    try {
      return await invokeOrThrow<string[]>("get_system_icc_profiles");
    } catch (e) {
      console.error("Failed to get system ICC profiles:", e);
      return [];
    }
  }

  // 预热 WCS 服务（后台执行，不阻塞）
  function warmupWcs() {
    try {
      invokeOrThrow("warmup_wcs");
      console.log("[ICC Store] WCS 预热已启动（后台）");
    } catch (e) {
      console.warn("[ICC Store] WCS 预热失败:", e);
    }
  }

  return {
    profiles,
    monitors,
    loading,
    error,
    fetchMonitors,
    fetchProfiles,
    warmupWcs,
    addProfile,
    removeProfile,
    toggleProfile,
    applyProfile,
    applyLutOnly,
    restoreDefault,
    selectIccFile,
    getSystemProfiles,
  };
});

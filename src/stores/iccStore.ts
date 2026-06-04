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
    try {
      await invokeOrThrow("toggle_icc_profile", { profileId, enabled });
      // 重新获取所有配置状态（因为后端会禁用同一显示器的其他配置）
      await fetchProfiles();
    } catch (e) {
      console.error("Failed to toggle ICC profile:", e);
      throw e;
    }
  }

  async function applyProfile(profileId: string) {
    try {
      await invokeOrThrow("apply_icc_profile", { profileId });
    } catch (e) {
      console.error("Failed to apply ICC profile:", e);
      throw e;
    }
  }

  async function restoreDefault(profileId: string) {
    try {
      await invokeOrThrow("restore_default_icc", { profileId });
    } catch (e) {
      console.error("Failed to restore default ICC:", e);
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

  return {
    profiles,
    monitors,
    loading,
    error,
    fetchMonitors,
    fetchProfiles,
    addProfile,
    removeProfile,
    toggleProfile,
    applyProfile,
    restoreDefault,
    selectIccFile,
    getSystemProfiles,
  };
});

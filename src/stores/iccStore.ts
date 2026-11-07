import { defineStore } from "pinia";
import { ref } from "vue";
import { invokeOrThrow } from "../utils/invoke-wrapper";
import { createIccOperationQueue, type IccOperationResult } from "./icc-operation-queue";
import type { IccProfile, MonitorInfo } from "../types/icc";

interface OperationTicket {
  operationSeq: number;
}

const operationQueue = createIccOperationQueue();

export const useIccStore = defineStore("icc", () => {
  const profiles = ref<IccProfile[]>([]);
  const monitors = ref<MonitorInfo[]>([]);
  const loading = ref<boolean>(false);
  const error = ref<string>("");

  async function beginOperation(): Promise<number> {
    const ticket = await invokeOrThrow<OperationTicket>("begin_icc_operation");
    return ticket.operationSeq;
  }

  async function runSwitchOperation(
    operationSeq: number,
    operation: (signal: AbortSignal) => Promise<void>,
  ): Promise<IccOperationResult<"done">> {
    return operationQueue.enqueue(
      `switch:${operationSeq}`,
      async (signal) => {
        if (signal.aborted) return "superseded";
        await operation(signal);
        return "done";
      },
    );
  }

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
    await invokeOrThrow("add_icc_profile", { profile });
    profiles.value.push(profile);
  }

  async function removeProfile(profileId: string) {
    await invokeOrThrow("remove_icc_profile", { profileId });
    profiles.value = profiles.value.filter((p) => p.id !== profileId);
  }

  /**
   * 启用配置：一次 IPC 完成 LUT 写入、状态落盘与后台 WCS 调度。
   * 失败时后端会回滚内存与磁盘状态，调用方只需回滚本地快照。
   */
  async function activateProfile(profileId: string, operationSeq: number) {
    await invokeOrThrow("activate_icc_profile", { profileId, operationSeq });
  }

  /** 禁用配置：一次 IPC 完成状态落盘与线性 Gamma Ramp 恢复。 */
  async function deactivateProfile(profileId: string, operationSeq: number) {
    await invokeOrThrow("deactivate_icc_profile", { profileId, operationSeq });
  }

  /**
   * 底层原语：只写 LUT 并调度后台 WCS，不改启用状态。
   * 设置页的开关走 activate/deactivate，这里留给需要单独刷新 LUT 的调用方。
   */
  async function applyProfile(profileId: string, operationSeq: number) {
    await invokeOrThrow("apply_icc_profile", { profileId, operationSeq });
  }

  async function applyLutOnly(profileId: string, operationSeq: number) {
    await invokeOrThrow("apply_icc_lut_only", { profileId, operationSeq });
  }

  async function restoreDefault(profileId: string, operationSeq: number) {
    await invokeOrThrow("restore_default_icc", { profileId, operationSeq });
  }

  async function toggleProfile(
    profileId: string,
    enabled: boolean,
    operationSeq: number,
  ) {
    await invokeOrThrow("toggle_icc_profile", { profileId, enabled, operationSeq });
  }

  async function selectIccFile(): Promise<string | null> {
    return await invokeOrThrow<string | null>("select_icc_file");
  }

  async function getSystemProfiles(): Promise<string[]> {
    return await invokeOrThrow<string[]>("get_system_icc_profiles");
  }

  function cancelPendingOperations() {
    operationQueue.cancelPending();
  }

  function warmupWcs() {
    void invokeOrThrow("warmup_wcs").catch((e) => {
      console.warn("[ICC Store] WCS 预热失败:", e);
    });
  }

  return {
    profiles,
    monitors,
    loading,
    error,
    beginOperation,
    runSwitchOperation,
    cancelPendingOperations,
    fetchMonitors,
    fetchProfiles,
    warmupWcs,
    addProfile,
    removeProfile,
    toggleProfile,
    activateProfile,
    deactivateProfile,
    applyProfile,
    applyLutOnly,
    restoreDefault,
    selectIccFile,
    getSystemProfiles,
  };
});

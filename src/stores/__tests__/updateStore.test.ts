import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { downloadAndInstallUpdateMock, restartApplicationMock, getVersionMock } = vi.hoisted(() => ({
  downloadAndInstallUpdateMock: vi.fn(),
  restartApplicationMock: vi.fn(),
  getVersionMock: vi.fn().mockResolvedValue("0.5.8"),
}));

vi.mock("../../utils/updater", () => ({
  downloadAndInstallUpdate: downloadAndInstallUpdateMock,
  restartApplication: restartApplicationMock,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: getVersionMock,
}));

import { AUTO_RESTART_DELAY_MS, useUpdateStore } from "../update";

describe("update store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    downloadAndInstallUpdateMock.mockReset();
    restartApplicationMock.mockReset();
    getVersionMock.mockClear();
    downloadAndInstallUpdateMock.mockResolvedValue(undefined);
    restartApplicationMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("automatically restarts after update installation completes", async () => {
    const store = useUpdateStore();
    store.updateInfo = {
      version: "0.5.9",
      notes: "更新内容",
      pub_date: "2026-06-28T00:00:00.000Z",
      latestJsonUrl: "https://example.com/latest.json",
      platforms: {
        "windows-x86_64": {
          signature: "sig",
          url: "https://example.com/update.msi",
        },
      },
    };

    const updatePromise = store.startUpdate();
    await Promise.resolve();

    expect(store.updatePhase).toBe("restarting");
    expect(store.downloadComplete).toBe(true);
    expect(restartApplicationMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(AUTO_RESTART_DELAY_MS);
    await updatePromise;

    expect(restartApplicationMock).toHaveBeenCalledTimes(1);
  });

  it("does not restart when update installation fails", async () => {
    downloadAndInstallUpdateMock.mockRejectedValueOnce(new Error("download failed"));
    const store = useUpdateStore();
    store.updateInfo = {
      version: "0.5.9",
      notes: "更新内容",
      pub_date: "2026-06-28T00:00:00.000Z",
      latestJsonUrl: "https://example.com/latest.json",
      platforms: {
        "windows-x86_64": {
          signature: "sig",
          url: "https://example.com/update.msi",
        },
      },
    };

    await store.startUpdate();

    expect(store.updatePhase).toBe("error");
    expect(store.error).toBe("download failed");
    expect(restartApplicationMock).not.toHaveBeenCalled();
  });
});

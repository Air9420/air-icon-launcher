import { describe, it, expect, vi, beforeEach } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return {
    ...actual,
    invoke: invokeMock,
  };
});

import {
  invoke,
  invokeOrThrow,
  safeInvoke,
  isInvokeError,
  extractErrorCode,
  extractErrorMessage,
  formatInvokeError,
  handleInvokeError,
  setPageUnloading,
  isPageUnloadingCheck,
} from "../invoke-wrapper";

describe("invoke-wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPageUnloading(false);
  });

  describe("invoke()", () => {
    it("returns ok:true with value on success", async () => {
      invokeMock.mockResolvedValueOnce({ data: "hello" });
      const result = await invoke<{ data: string }>("test_cmd");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ data: "hello" });
      }
    });

    it("returns ok:false with parsed error on rejection", async () => {
      invokeMock.mockRejectedValueOnce({ code: "FAIL", message: "oops" });
      const result = await invoke("cmd");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("FAIL");
        expect(result.error.message).toBe("oops");
      }
    });

    it("parses string error response", async () => {
      invokeMock.mockRejectedValueOnce("string error");
      const result = await invoke("cmd");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("STRING_ERROR");
      }
    });

    it("parses native Error response", async () => {
      invokeMock.mockRejectedValueOnce(new Error("native fail"));
      const result = await invoke("cmd");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NATIVE_ERROR");
      }
    });

    it("returns CANCELLED when page is unloading", async () => {
      setPageUnloading(true);
      const result = await invoke("cmd");
      expect(invokeMock).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("CANCELLED");
      }
    });
  });

  describe("invokeOrThrow()", () => {
    it("returns value on success", async () => {
      invokeMock.mockResolvedValueOnce(42);
      const value = await invokeOrThrow<number>("cmd");
      expect(value).toBe(42);
    });

    it("throws error on failure", async () => {
      invokeMock.mockRejectedValueOnce({ code: "ERR", message: "fail" });
      await expect(invokeOrThrow("cmd")).rejects.toEqual({
        code: "ERR",
        message: "fail",
      });
    });
  });

  describe("safeInvoke()", () => {
    it("returns value on success", async () => {
      invokeMock.mockResolvedValueOnce("data");
      const result = await safeInvoke<string>("cmd");
      expect(result).toBe("data");
    });

    it("returns null on failure and logs error", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      invokeMock.mockRejectedValueOnce({ code: "E", message: "m" });
      const result = await safeInvoke("cmd");
      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith("[E] m");
      consoleSpy.mockRestore();
    });
  });

  describe("isInvokeError()", () => {
    it("returns true for error result", () => {
      expect(isInvokeError({ ok: false, error: { code: "", message: "" } })).toBe(true);
    });

    it("returns false for success result", () => {
      expect(isInvokeError({ ok: true, value: null })).toBe(false);
    });
  });

  describe("extractErrorCode()", () => {
    it("extracts code from AppError", () => {
      expect(extractErrorCode({ code: "MY_CODE", message: "" })).toBe("MY_CODE");
    });

    it("returns UNKNOWN for non-AppError", () => {
      expect(extractErrorCode("not an app error")).toBe("UNKNOWN");
    });
  });

  describe("extractErrorMessage()", () => {
    it("extracts message from AppError", () => {
      expect(extractErrorMessage({ code: "", message: "msg" })).toBe("msg");
    });

    it("extracts from native Error", () => {
      expect(extractErrorMessage(new Error("e_msg"))).toBe("e_msg");
    });

    it("falls back to String()", () => {
      expect(extractErrorMessage(99)).toBe("99");
    });
  });

  describe("formatInvokeError()", () => {
    it("returns empty string for success result", () => {
      expect(formatInvokeError({ ok: true, value: null })).toBe("");
    });

    it("formats error as [code] message", () => {
      expect(
        formatInvokeError({ ok: false, error: { code: "C", message: "m" } })
      ).toBe("[C] m");
    });
  });

  describe("handleInvokeError()", () => {
    it("calls fallback and returns error for AppError", () => {
      const fallback = vi.fn();
      const err = { code: "E", message: "m" };
      const result = handleInvokeError(err, fallback);
      expect(fallback).toHaveBeenCalledWith(err);
      expect(result).toEqual(err);
    });

    it("parses and returns non-AppError", () => {
      const fallback = vi.fn();
      const result = handleInvokeError("string err", fallback);
      expect(result).toBeDefined();
      expect(result!.code).toBe("STRING_ERROR");
      expect(fallback).toHaveBeenCalled();
    });
  });

  describe("setPageUnloading / isPageUnloadingCheck", () => {
    it("tracks page unloading state", () => {
      expect(isPageUnloadingCheck()).toBe(false);
      setPageUnloading(true);
      expect(isPageUnloadingCheck()).toBe(true);
      setPageUnloading(false);
      expect(isPageUnloadingCheck()).toBe(false);
    });
  });
});

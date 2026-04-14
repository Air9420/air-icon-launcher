import { describe, it, expect } from "vitest";
import {
  isAppError,
  getErrorCode,
  getErrorMessage,
  getErrorDetails,
  parseTauriError,
  errorToString,
} from "../app-error";
import type { AppError } from "../app-error";

describe("app-error", () => {
  describe("isAppError", () => {
    it("returns true for valid AppError object", () => {
      const err: AppError = { code: "TEST", message: "test msg" };
      expect(isAppError(err)).toBe(true);
    });

    it("returns false for null", () => {
      expect(isAppError(null)).toBe(false);
    });

    it("returns false for string", () => {
      expect(isAppError("error")).toBe(false);
    });

    it("returns false for object without code field", () => {
      expect(isAppError({ message: "only message" })).toBe(false);
    });

    it("returns false for object without message field", () => {
      expect(isAppError({ code: "CODE" })).toBe(false);
    });
  });

  describe("getErrorCode", () => {
    it("returns code for AppError", () => {
      expect(getErrorCode({ code: "NOT_FOUND", message: "" })).toBe("NOT_FOUND");
    });

    it("returns NATIVE_ERROR for Error instance", () => {
      expect(getErrorCode(new Error("fail"))).toBe("NATIVE_ERROR");
    });

    it("returns UNKNOWN_ERROR for other types", () => {
      expect(getErrorCode(42)).toBe("UNKNOWN_ERROR");
    });
  });

  describe("getErrorMessage", () => {
    it("returns message for AppError", () => {
      expect(getErrorMessage({ code: "", message: "hello" })).toBe("hello");
    });

    it("returns error.message for Error instance", () => {
      expect(getErrorMessage(new Error("err msg"))).toBe("err msg");
    });

    it("returns String() for unknown type", () => {
      expect(getErrorMessage(123)).toBe("123");
    });
  });

  describe("getErrorDetails", () => {
    it("returns details when present", () => {
      const err: AppError = { code: "", message: "", details: { key: "val" } };
      expect(getErrorDetails(err)).toEqual({ key: "val" });
    });

    it("returns undefined when details absent", () => {
      expect(getErrorDetails({ code: "", message: "" })).toBeUndefined();
    });

    it("returns undefined for non-AppError", () => {
      expect(getErrorDetails("str")).toBeUndefined();
    });
  });

  describe("parseTauriError", () => {
    it("returns same object if already AppError", () => {
      const err: AppError = { code: "EXISTING", message: "msg" };
      expect(parseTauriError(err)).toBe(err);
    });

    it("parses JSON string with AppError shape", () => {
      const result = parseTauriError('{"code":"STRING_ERR","message":"raw"}');
      expect(result.code).toBe("STRING_ERR");
      expect(result.message).toBe("raw");
    });

    it("returns STRING_ERROR for plain non-JSON string", () => {
      const result = parseTauriError("plain text error");
      expect(result.code).toBe("STRING_ERROR");
      expect(result.message).toBe("plain text error");
    });

    it("returns NATIVE_ERROR for Error instance", () => {
      const result = parseTauriError(new Error("native err"));
      expect(result.code).toBe("NATIVE_ERROR");
      expect(result.message).toBe("native err");
      expect(result.details).toBeDefined();
    });

    it("returns UNKNOWN_ERROR for unknown type", () => {
      const result = parseTauriError(42);
      expect(result.code).toBe("UNKNOWN_ERROR");
      expect(result.message).toContain("unknown");
    });

    it("handles invalid JSON string gracefully", () => {
      const result = parseTauriError("{invalid json");
      expect(result.code).toBe("STRING_ERROR");
    });
  });

  describe("errorToString", () => {
    it("formats AppError as [code] message", () => {
      expect(errorToString({ code: "ERR", message: "msg" })).toBe("[ERR] msg");
    });

    it("appends details when present", () => {
      const str = errorToString({
        code: "ERR",
        message: "msg",
        details: { info: "x" },
      });
      expect(str).toContain("[ERR] msg");
      expect(str).toContain("Details:");
    });

    it("formats non-AppError via parseTauriError", () => {
      const str = errorToString(new Error("test"));
      expect(str).toContain("NATIVE_ERROR");
    });
  });
});

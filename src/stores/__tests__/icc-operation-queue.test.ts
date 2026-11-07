import { describe, expect, it } from "vitest";
import { createIccOperationQueue } from "../icc-operation-queue";

describe("createIccOperationQueue", () => {
  it("drops stale queued operations and keeps the latest request", async () => {
    const queue = createIccOperationQueue();
    const calls: string[] = [];
    const release: { first?: () => void } = {};

    const first = queue.enqueue("p1", async (signal) => {
      calls.push("first-start");
      await new Promise<void>((resolve) => {
        release.first = () => resolve();
      });
      if (signal.aborted) return "first-aborted";
      calls.push("first-finish");
      return "first";
    });

    const pending = [
      queue.enqueue("switch:p2", async () => {
        calls.push("p2");
        return "p2";
      }),
      queue.enqueue("switch:p3", async () => {
        calls.push("p3");
        return "p3";
      }),
      queue.enqueue("switch:p4", async () => {
        calls.push("p4");
        return "p4";
      }),
    ];

    await Promise.resolve();
    release.first?.();

    const results = await Promise.all([first, ...pending]);

    expect(results).toEqual(["first", "dropped", "dropped", "p4"]);
    expect(calls).toEqual(["first-start", "first-finish", "p4"]);
    expect(queue.isBusy()).toBe(false);
  });

  it("starts a newer request immediately when it supersedes a running switch", async () => {
    const queue = createIccOperationQueue();
    let observedAbort = false;
    const release: { first?: () => void } = {};
    let firstStarted = false;

    const first = queue.enqueue("switch:p1", async (signal) => {
      firstStarted = true;
      signal.addEventListener("abort", () => {
        observedAbort = true;
      });
      await new Promise<void>((resolve) => {
        release.first = () => resolve();
      });
      return "first";
    });

    await Promise.resolve();
    const second = await queue.enqueue("switch:p2", async () => "second");

    expect(firstStarted).toBe(true);
    expect(second).toBe("second");
    expect(observedAbort).toBe(true);

    release.first?.();
    expect(await first).toBe("superseded");
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.isBusy()).toBe(false);
  });

  it("keeps all non-switching mutations in order", async () => {
    const queue = createIccOperationQueue();
    const calls: string[] = [];

    const results = await Promise.all([
      queue.enqueue("add", async () => {
        calls.push("add");
        return "add";
      }),
      queue.enqueue("remove", async () => {
        calls.push("remove");
        return "remove";
      }),
      queue.enqueue("refresh", async () => {
        calls.push("refresh");
        return "refresh";
      }),
    ]);

    expect(results).toEqual(["add", "remove", "refresh"]);
    expect(calls).toEqual(["add", "remove", "refresh"]);
    expect(queue.isBusy()).toBe(false);
  });

  it("prevents stale completion from clearing the busy state", async () => {
    const queue = createIccOperationQueue();
    const release: { first?: () => void } = {};
    const first = queue.enqueue("switch:p1", async () => {
      await new Promise<void>((resolve) => {
        release.first = () => resolve();
      });
      return "first";
    });
    const second = queue.enqueue("switch:p2", async () => "second");

    expect(await second).toBe("second");
    expect(queue.isBusy()).toBe(true);

    release.first?.();
    expect(await first).toBe("superseded");
    expect(queue.isBusy()).toBe(false);
  });
});

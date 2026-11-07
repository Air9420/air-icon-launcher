/**
 * ICC 操作串行队列。
 *
 * 普通操作按提交顺序排队；`switch:*` 切换配置操作只保留最后一个等待项，
 * 并在新请求到达时给当前切换发送取消信号，防止快速点击后逐个回放。
 */
export type IccOperationResult<T> = T | "dropped" | "superseded";
export type IccOperation<T> = (signal: AbortSignal) => Promise<T> | T;

interface QueueItem {
  coalesce: boolean;
  controller: AbortController;
  run: () => Promise<IccOperationResult<unknown>>;
  resolve: (value: IccOperationResult<unknown>) => void;
  reject: (reason: unknown) => void;
}

interface ActiveOperation {
  coalesce: boolean;
  controller: AbortController;
}

export interface IccOperationQueue {
  enqueue<T>(key: string, operation: IccOperation<T>): Promise<IccOperationResult<T>>;
  isBusy(): boolean;
  cancelPending(): void;
}

export function createIccOperationQueue(): IccOperationQueue {
  const pending: QueueItem[] = [];
  let current: ActiveOperation | null = null;
  let activeCount = 0;

  function pump() {
    if (current) return;

    const item = pending.shift();
    if (!item) return;

    current = {
      coalesce: item.coalesce,
      controller: item.controller,
    };
    activeCount += 1;

    void Promise.resolve()
      .then(() => item.run())
      .then(
        (value) => {
          if (item.controller.signal.aborted) {
            item.resolve("superseded");
          } else {
            item.resolve(value);
          }
        },
        (error) => {
          if (item.controller.signal.aborted) {
            item.resolve("superseded");
          } else {
            item.reject(error);
          }
        },
      )
      .finally(() => {
        activeCount -= 1;
        if (current?.controller === item.controller) {
          current = null;
          pump();
        }
      });
  }

  function abortCurrentSwitch() {
    if (!current?.coalesce) return;
    current.controller.abort();
    current = null;
  }

  return {
    enqueue<T>(key: string, operation: IccOperation<T>) {
      const coalesce = key.startsWith("switch:");
      return new Promise<IccOperationResult<T>>((resolve, reject) => {
        const controller = new AbortController();

        if (coalesce) {
          for (let i = pending.length - 1; i >= 0; i -= 1) {
            if (pending[i].coalesce) {
              pending[i].controller.abort();
              pending[i].resolve("dropped");
              pending.splice(i, 1);
            }
          }
          abortCurrentSwitch();
        }

        const item: QueueItem = {
          coalesce,
          controller,
          resolve: resolve as (value: IccOperationResult<unknown>) => void,
          reject,
          run: async () => {
            if (controller.signal.aborted) return "superseded";
            const value = await operation(controller.signal);
            if (controller.signal.aborted) return "superseded";
            return value;
          },
        };
        pending.push(item);
        pump();
      });
    },
    isBusy() {
      return activeCount > 0 || pending.length > 0;
    },
    cancelPending() {
      for (const item of pending.splice(0)) {
        item.controller.abort();
        item.resolve("dropped");
      }
      if (current) {
        current.controller.abort();
        current = null;
      }
    },
  };
}

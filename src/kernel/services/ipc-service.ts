import { Service, type Context } from "cordis";
import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke as wrapperInvoke, type InvokeResult } from "../../utils/invoke-wrapper";
import type { Disposer } from "../types";

export class IpcService extends Service {
  constructor(ctx: Context) {
    super(ctx, "ipc");
  }

  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<InvokeResult<T>> {
    return wrapperInvoke<T>(cmd, args);
  }

  on<T = unknown>(event: string, cb: (event: Event<T>) => void): Disposer {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;

    listen<T>(event, cb).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
      unlisten = null;
    };
  }
}

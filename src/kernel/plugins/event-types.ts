import type { Context } from "cordis";
import type { Disposer } from "../types";

/**
 * Event registrar signature compatible with `ctx.ipc.on`.
 * Kernel plugins pass a thin wrapper around ctx.ipc.on.
 */
export type KernelEventRegistrar = <T = unknown>(
  event: string,
  cb: (event: { payload: T }) => void,
) => Disposer;

/** Adapt cordis IpcService.on to KernelEventRegistrar. */
export function ipcRegistrar(ctx: Context): KernelEventRegistrar {
  return (event, cb) => ctx.ipc.on(event, cb as never);
}

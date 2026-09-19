import type { KernelContext } from "./types";

/**
 * Runtime kernel context accessor for adapters (pinia stores, legacy utils).
 *
 * Services must NOT import stores. Stores may call this via `window.__AIR_CTX__`
 * after bootstrap. Prefer `useCordis()` inside Vue components.
 *
 * Business code still must not `import from 'cordis'`.
 */
export function getKernelContext(): KernelContext | undefined {
  if (typeof window === "undefined") return undefined;
  return window.__AIR_CTX__ as KernelContext | undefined;
}

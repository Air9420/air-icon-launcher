import { inject, type InjectionKey } from "vue";
import type { KernelContext } from "./types";

export const CORDIS_INJECTION_KEY: InjectionKey<KernelContext> = Symbol("air-cordis-context");

export function useCordis(): KernelContext {
  const ctx = inject(CORDIS_INJECTION_KEY);
  if (!ctx) {
    throw new Error(
      "[kernel] Cordis context missing. Provide it via app.provide(CORDIS_INJECTION_KEY, ctx)."
    );
  }
  return ctx;
}

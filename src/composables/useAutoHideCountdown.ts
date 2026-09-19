import { watch, type Ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { safeInvoke } from "../utils/invoke-wrapper";
import { hideWindowAndStartMemoryRelease } from "../utils/window-memory";
import {
  autoHideIsCountingDown,
  stopAutoHideCountdown,
} from "../kernel/runtime/ui-shell-state";

const win = getCurrentWindow();

interface AutoHideCountdownOptions {
  autoHideEnabled: Ref<boolean>;
  countdownSeconds: Ref<number>;
}

/**
 * Auto-hide countdown UI adapter.
 *
 * `isCountingDown` is shared with kernel ui-shell-runtime (focus listener).
 * App.vue binds the ring; plugin owns focus/window-shown listeners (P7).
 */
export function useAutoHideCountdown(options: AutoHideCountdownOptions) {
  const { autoHideEnabled, countdownSeconds } = options;
  const isCountingDown = autoHideIsCountingDown;

  function stopCountdown() {
    stopAutoHideCountdown();
  }

  async function handleCountdownComplete() {
    if (!isCountingDown.value || !autoHideEnabled.value) {
      stopCountdown();
      return;
    }

    const focused = await win.isFocused();
    stopCountdown();
    if (!focused) {
      await hideWindowAndStartMemoryRelease(win, async () => {
        await safeInvoke("start_memory_release");
      });
    }
  }

  watch(autoHideEnabled, (enabled) => {
    if (!enabled) {
      stopCountdown();
    }
  });

  async function setupFocusListener() {
    // no-op: owned by kernel ui-shell-runtime plugin (P7)
  }

  function cleanupFocusListener() {
    // no-op: owned by kernel ui-shell-runtime plugin (P7)
  }

  return {
    isCountingDown,
    countdownSeconds,
    stopCountdown,
    handleCountdownComplete,
    setupFocusListener,
    cleanupFocusListener,
  };
}

export type AutoHideCountdownComposable = ReturnType<typeof useAutoHideCountdown>;

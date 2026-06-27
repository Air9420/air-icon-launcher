import { ref, watch, type Ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { safeInvoke } from "../utils/invoke-wrapper";
import { hideWindowAndStartMemoryRelease } from "../utils/window-memory";

const win = getCurrentWindow();

interface AutoHideCountdownOptions {
  autoHideEnabled: Ref<boolean>;
  countdownSeconds: Ref<number>;
}

export function useAutoHideCountdown(options: AutoHideCountdownOptions) {
  const { autoHideEnabled, countdownSeconds } = options;
  const isCountingDown = ref(false);
  let unlistenFocus: (() => void) | null = null;

  function stopCountdown() {
    isCountingDown.value = false;
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
    cleanupFocusListener();
    stopCountdown();
    unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
      if (!autoHideEnabled.value) {
        stopCountdown();
        return;
      }
      if (focused) {
        stopCountdown();
      } else {
        isCountingDown.value = true;
      }
    });
  }

  function cleanupFocusListener() {
    if (unlistenFocus) {
      unlistenFocus();
      unlistenFocus = null;
    }
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

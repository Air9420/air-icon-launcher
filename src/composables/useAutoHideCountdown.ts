import { ref, watch, type Ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";

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
    console.log("[auto-hide] stopCountdown");
    isCountingDown.value = false;
  }

  async function handleCountdownComplete() {
    console.log("[auto-hide] handleCountdownComplete", { isCountingDown: isCountingDown.value, autoHideEnabled: autoHideEnabled.value });
    if (!isCountingDown.value || !autoHideEnabled.value) {
      stopCountdown();
      return;
    }

    const focused = await win.isFocused();
    console.log("[auto-hide] focused=", focused);
    stopCountdown();
    if (!focused) {
      console.log("[auto-hide] hiding window");
      await win.hide();
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
      console.log("[auto-hide] onFocusChanged", { focused, autoHideEnabled: autoHideEnabled.value });
      if (!autoHideEnabled.value) {
        stopCountdown();
        return;
      }
      if (focused) {
        stopCountdown();
      } else {
        console.log("[auto-hide] starting countdown");
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

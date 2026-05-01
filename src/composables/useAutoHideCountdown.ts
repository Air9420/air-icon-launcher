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
  let focusListener: (() => void) | null = null;

  function stopCountdown() {
    isCountingDown.value = false;
  }

  function handleCountdownComplete() {
    stopCountdown();
    win.hide();
  }

  watch(autoHideEnabled, (enabled) => {
    if (!enabled) {
      stopCountdown();
    }
  });

  async function setupFocusListener() {
    focusListener = await win.onFocusChanged(({ payload: focused }) => {
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

  return {
    isCountingDown,
    countdownSeconds,
    stopCountdown,
    handleCountdownComplete,
    setupFocusListener,
  };
}

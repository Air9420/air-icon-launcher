<template>
  <div
    v-if="actualVisible"
    class="countdown-ring-wrapper"
    :style="{ '--animation-duration': `${props.countdownSeconds}s` }"
  >
    <svg class="countdown-ring" viewBox="0 0 36 36">
      <circle
        class="countdown-ring-bg"
        cx="18"
        cy="18"
        r="15.5"
      />
      <circle
        class="countdown-ring-progress"
        cx="18"
        cy="18"
        r="15.5"
        :stroke-dasharray="circumference"
        transform="rotate(-90 18 18)"
      />
    </svg>
    <span class="countdown-text">{{ displaySeconds }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'

const props = defineProps<{
  countdownSeconds: number
  isVisible: boolean
}>()

const emit = defineEmits<{
  complete: []
}>()

const circumference = 2 * Math.PI * 15.5
const actualVisible = ref(false)
const displaySeconds = ref(0)
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let countdownInterval: ReturnType<typeof setInterval> | null = null
const DEBOUNCE_MS = 1200

function cancelDebounce() {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

function stopCountdown() {
  if (countdownInterval !== null) {
    clearInterval(countdownInterval)
    countdownInterval = null
  }
  displaySeconds.value = 0
}

function startCountdown() {
  stopCountdown()
  let remaining = props.countdownSeconds
  displaySeconds.value = remaining
  countdownInterval = setInterval(() => {
    remaining--
    displaySeconds.value = Math.max(remaining, 0)
    if (remaining <= 0) {
      stopCountdown()
      emit('complete')
    }
  }, 1000)
}

function scheduleShow() {
  cancelDebounce()
  debounceTimer = setTimeout(() => {
    actualVisible.value = true
    startCountdown()
  }, DEBOUNCE_MS)
}

watch(() => props.isVisible, (visible) => {
  if (visible) {
    scheduleShow()
  } else {
    cancelDebounce()
    actualVisible.value = false
    stopCountdown()
  }
}, { immediate: true })

onUnmounted(() => {
  cancelDebounce()
  stopCountdown()
})
</script>

<style scoped>
.countdown-ring-wrapper {
  --animation-duration: 30s;
  position: fixed;
  bottom: 8px;
  right: 8px;
  width: 30px;
  height: 30px;
  z-index: 9999;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.countdown-ring {
  width: 100%;
  height: 100%;
}

.countdown-ring-bg {
  fill: none;
  stroke: rgba(128, 128, 128, 0.2);
  stroke-width: 3;
}

.countdown-ring-progress {
  fill: none;
  stroke: var(--primary-color);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-dashoffset: 0;
  animation: countdown-progress linear forwards;
  animation-duration: var(--animation-duration);
}

@keyframes countdown-progress {
  from {
    stroke-dashoffset: 0;
  }
  to {
    stroke-dashoffset: 97.4;
  }
}

.countdown-text {
  position: absolute;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  color: var(--text-color, #fff);
}
</style>

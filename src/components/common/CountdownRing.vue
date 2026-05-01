<template>
  <div v-if="actualVisible" class="countdown-ring-wrapper">
    <svg class="countdown-ring" viewBox="0 0 38 38">
      <circle
        class="countdown-ring-bg"
        cx="19"
        cy="19"
        r="15.5"
      />
      <circle
        class="countdown-ring-progress"
        cx="19"
        cy="19"
        r="15.5"
      />
    </svg>
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

const actualVisible = ref(false)
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
}

function startCountdown() {
  stopCountdown()
  let remaining = props.countdownSeconds
  countdownInterval = setInterval(() => {
    remaining--
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
  position: fixed;
  bottom: 12px;
  right: 12px;
  width: 38px;
  height: 38px;
  z-index: 9999;
  pointer-events: none;
}

.countdown-ring {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.countdown-ring-bg {
  fill: none;
  stroke: rgba(128, 128, 128, 0.2);
  stroke-width: 3;
}

.countdown-ring-progress {
  fill: none;
  stroke: rgba(99, 102, 241, 0.7);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-dasharray: 97.4;
  stroke-dashoffset: 0;
  animation: countdown-progress v-bind('props.countdownSeconds + "s"') linear forwards;
}

@keyframes countdown-progress {
  from {
    stroke-dashoffset: 0;
  }
  to {
    stroke-dashoffset: 97.4;
  }
}
</style>
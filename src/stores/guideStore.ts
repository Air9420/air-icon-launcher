import { defineStore } from "pinia";
import { ref } from "vue";

export const useGuideStore = defineStore(
    "guide",
    () => {
        const hasSeenOnboarding = ref(false);
        const currentStep = ref(0);
        const isOnboardingActive = ref(false);
        const pendingDropTargetCategoryId = ref<string | null>(null);

        function startOnboarding() {
            hasSeenOnboarding.value = false;
            currentStep.value = 0;
            isOnboardingActive.value = true;
        }

        function nextStep() {
            currentStep.value++;
            if (currentStep.value >= 3) {
                completeOnboarding();
            }
        }

        function previousStep() {
            if (currentStep.value > 0) {
                currentStep.value--;
            }
        }

        function completeOnboarding() {
            isOnboardingActive.value = false;
            hasSeenOnboarding.value = true;
            currentStep.value = 0;
            pendingDropTargetCategoryId.value = null;
        }

        function skipOnboarding() {
            completeOnboarding();
        }

        function setPendingDropTarget(categoryId: string | null) {
            pendingDropTargetCategoryId.value = categoryId;
        }

        return {
            hasSeenOnboarding,
            currentStep,
            isOnboardingActive,
            pendingDropTargetCategoryId,
            startOnboarding,
            nextStep,
            previousStep,
            completeOnboarding,
            skipOnboarding,
            setPendingDropTarget,
        };
    },
    {
        persist: {
            pick: ["hasSeenOnboarding"],
        },
    }
);

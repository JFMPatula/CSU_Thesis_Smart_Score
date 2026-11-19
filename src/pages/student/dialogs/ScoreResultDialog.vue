<script setup lang="ts">
import { ref, computed } from "vue";
import {
  getScoreColor,
  getGradeLetter,
  getAnswerResultColor,
  getAnswerResultIcon,
  getPassStatus,
} from "../utils/helpers";

// Props
interface Props {
  modelValue: boolean;
  quizTitle?: string;
  studentName?: string;
  studentId?: string;
  quizId?: string;
  scoreData?: {
    score?: number | null;
    remarks?: string | null;
    totalCorrect?: number | null;
    totalIncorrect?: number | null;
    totalQuestions?: number | null;
    comparisons?: Array<{
      questionNumber: number;
      studentAnswer: string;
      correctAnswer: string;
      isCorrect: boolean;
      points: number;
      confidence?: number;
      explanation?: string;
    }>;
    checkingTimeMs?: number;
    feedbackReleased?: boolean;
    pendingRelease?: boolean;
    message?: string;
    claimCode?: string;
  };
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  quizTitle: "Quiz",
});

// Emits
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  close: [];
}>();

// State
const copiedClaimCode = ref(false);

// Computed
const isPendingRelease = computed(
  () =>
    props.scoreData?.pendingRelease === true ||
    (props.scoreData?.feedbackReleased === false && props.scoreData?.score == null),
);
const hasScore = computed(
  () => typeof props.scoreData?.score === "number" && !Number.isNaN(props.scoreData.score),
);
const scorePercentage = computed<number>(() =>
  hasScore.value ? Number(props.scoreData?.score ?? 0) : 0,
);
const scoreColor = computed(() => (isPendingRelease.value ? "info" : getScoreColor(scorePercentage.value)));
const scoreGrade = computed(() => (isPendingRelease.value ? "…" : getGradeLetter(scorePercentage.value)));
const passStatus = computed(() => (hasScore.value ? getPassStatus(scorePercentage.value) : false));
const feedbackReleased = computed(() => props.scoreData?.feedbackReleased === true);
const claimCode = computed(() => props.scoreData?.claimCode || "");

const checkingTimeLabel = computed(() => {
  const ms = props.scoreData?.checkingTimeMs;
  if (ms === undefined || ms === null) return "";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
});

const copyClaimCode = async () => {
  if (!claimCode.value) return;
  try {
    await navigator.clipboard.writeText(claimCode.value);
    copiedClaimCode.value = true;
    setTimeout(() => {
      copiedClaimCode.value = false;
    }, 2000);
  } catch {
    copiedClaimCode.value = false;
  }
};

/**
 * Handle dialog close
 */
const handleClose = () => {
  emit("update:modelValue", false);
  emit("close");
};
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="800"
    persistent
    scrollable
  >
    <v-card>
      <!-- Header -->
      <v-card-title
        class="d-flex align-center pa-4"
        :class="`bg-${scoreColor}`"
      >
        <v-icon left color="white">mdi-trophy</v-icon>
        <span class="text-white">Quiz Results - {{ quizTitle }}</span>
        <v-spacer />
        <v-btn
          icon
          variant="text"
          size="small"
          color="white"
          @click="handleClose"
        >
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-divider />

      <v-card-text class="pa-4">
        <!-- Student Information -->
        <v-card variant="outlined" class="mb-4">
          <v-card-text class="pa-4">
            <v-row>
              <v-col cols="12" md="6">
                <div class="text-subtitle-2 text-medium-emphasis">
                  Student Name
                </div>
                <div class="text-h6">{{ studentName || "N/A" }}</div>
              </v-col>
              <v-col cols="12" md="6">
                <div class="text-subtitle-2 text-medium-emphasis">
                  Student ID
                </div>
                <div class="text-h6">{{ studentId || "N/A" }}</div>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>

        <v-alert
          v-if="claimCode"
          type="warning"
          variant="tonal"
          class="mb-4"
        >
          <div class="d-flex align-center flex-wrap">
            <div class="flex-grow-1">
              <div class="font-weight-bold mb-1">Save this claim code</div>
              <div class="text-body-2">
                You submitted without signing in. Use this code with your Student ID and full
                name to link this result to your account later.
              </div>
            </div>
            <div class="d-flex align-center ml-2">
              <v-chip color="warning" variant="flat" size="large" class="font-weight-bold">
                {{ claimCode }}
              </v-chip>
              <v-btn
                icon
                variant="text"
                size="small"
                class="ml-1"
                :title="copiedClaimCode ? 'Copied' : 'Copy claim code'"
                @click="copyClaimCode"
              >
                <v-icon>{{ copiedClaimCode ? "mdi-check" : "mdi-content-copy" }}</v-icon>
              </v-btn>
            </div>
          </div>
        </v-alert>

        <!-- Score Summary -->
        <v-card variant="tonal" :color="scoreColor" class="mb-4">
          <v-card-text class="text-center pa-6">
            <div class="d-flex justify-center align-center mb-4">
              <v-avatar :color="scoreColor" size="80" class="text-white">
                <span class="text-h4">{{ scoreGrade }}</span>
              </v-avatar>
            </div>

            <template v-if="!isPendingRelease">
              <div class="text-h3 mb-2" :class="`text-${scoreColor}`">
                {{ scorePercentage }}%
              </div>

              <div class="text-h6 mb-3">
                {{ scoreData?.remarks || "No remarks" }}
              </div>

              <v-chip
                :color="passStatus ? 'success' : 'error'"
                variant="flat"
                size="large"
                class="text-white"
              >
                <v-icon left>{{
                  passStatus ? "mdi-check-circle" : "mdi-close-circle"
                }}</v-icon>
                {{ passStatus ? "PASSED" : "FAILED" }}
              </v-chip>
            </template>
            <template v-else>
              <div class="text-h5 mb-2">Submission received</div>
              <div class="text-body-1 text-medium-emphasis">
                {{ scoreData?.message || "Your score and feedback will be available after your teacher releases them." }}
              </div>
            </template>
          </v-card-text>
        </v-card>

        <!-- Checking Time -->
        <v-card
          v-if="checkingTimeLabel"
          variant="tonal"
          color="primary"
          class="mb-4 text-center pa-2"
        >
          <v-icon left small class="mr-1">mdi-timer-outline</v-icon>
          <span class="text-body-1">
            Checking time: {{ checkingTimeLabel }}
          </span>
        </v-card>

        <!-- Statistics -->
        <v-row v-if="!isPendingRelease" class="mb-4">
          <v-col cols="4">
            <v-card variant="outlined" class="text-center pa-3">
              <div class="text-h4 text-primary">
                {{ scoreData?.totalQuestions || 0 }}
              </div>
              <div class="text-caption text-medium-emphasis">
                Total Questions
              </div>
            </v-card>
          </v-col>
          <v-col cols="4">
            <v-card variant="outlined" class="text-center pa-3">
              <div class="text-h4 text-success">
                {{ scoreData?.totalCorrect || 0 }}
              </div>
              <div class="text-caption text-medium-emphasis">Correct</div>
            </v-card>
          </v-col>
          <v-col cols="4">
            <v-card variant="outlined" class="text-center pa-3">
              <div class="text-h4 text-error">
                {{ scoreData?.totalIncorrect || 0 }}
              </div>
              <div class="text-caption text-medium-emphasis">Incorrect</div>
            </v-card>
          </v-col>
        </v-row>

        <v-alert
          v-if="!isPendingRelease && !feedbackReleased"
          type="info"
          variant="tonal"
          class="mb-4"
        >
          Your teacher has not released answer feedback yet. Your score is shown, but correct
          answers and explanations will appear after your teacher releases them.
        </v-alert>

        <v-alert
          v-if="isPendingRelease"
          type="info"
          variant="tonal"
          class="mb-4"
        >
          Your score, correct answers, and explanations are hidden until your teacher releases them.
        </v-alert>

        <!-- Detailed Results -->
        <v-card
          variant="outlined"
          v-if="scoreData?.comparisons && scoreData.comparisons.length > 0"
        >
          <v-card-title class="pa-3">
            <v-icon left>mdi-clipboard-text</v-icon>
            Detailed Results
          </v-card-title>

          <v-divider />

          <div
            class="results-container"
            style="max-height: 300px; overflow-y: auto"
          >
            <v-list density="comfortable">
              <v-list-item
                v-for="comparison in scoreData.comparisons"
                :key="`result-${comparison.questionNumber}`"
                class="result-item"
              >
                <template #prepend>
                  <v-avatar
                    :color="getAnswerResultColor(comparison.isCorrect)"
                    size="32"
                  >
                    <v-icon
                      :icon="getAnswerResultIcon(comparison.isCorrect)"
                      color="white"
                      size="small"
                    />
                  </v-avatar>
                </template>

                <v-list-item-title>
                  <div class="d-flex flex-column">
                    <div class="d-flex align-center justify-space-between mb-2">
                      <span class="text-body-1"
                        >Question {{ comparison.questionNumber }}</span
                      >
                      <div class="d-flex gap-2">
                        <v-chip
                          class="mx-2"
                          :color="comparison.isCorrect ? 'success' : 'error'"
                          size="small"
                          variant="outlined"
                        >
                          Your Answer:
                          {{ comparison.studentAnswer || "No Answer" }}
                        </v-chip>
                        <v-chip
                          class="mx-2"
                          v-if="feedbackReleased"
                          color="primary"
                          size="small"
                          variant="tonal"
                        >
                          Correct: {{ comparison.correctAnswer }}
                        </v-chip>
                      </div>
                    </div>

                    <!-- AI Explanation (if available) -->
                    <div
                      v-if="feedbackReleased && comparison.explanation"
                      class="text-caption text-medium-emphasis mt-1 ml-2"
                    >
                      <v-icon size="x-small" class="mr-1">mdi-robot</v-icon>
                      {{ comparison.explanation }}
                      <v-chip
                        v-if="comparison.confidence !== undefined"
                        size="x-small"
                        variant="text"
                        class="ml-2"
                      >
                        Confidence: {{ Math.round(comparison.confidence * 100) }}%
                      </v-chip>
                    </div>
                  </div>
                </v-list-item-title>

                <template #append>
                  <v-chip
                    :color="comparison.isCorrect ? 'success' : 'error'"
                    size="small"
                    variant="flat"
                  >
                    {{ comparison.points }} pt
                  </v-chip>
                </template>
              </v-list-item>
            </v-list>
          </div>
        </v-card>
      </v-card-text>

      <v-divider />

      <v-card-actions class="pa-4">
        <v-spacer />
        <v-btn
          color="primary"
          variant="flat"
          @click="handleClose"
          prepend-icon="mdi-check"
        >
          Done
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.results-container {
  border-radius: 0;
}

.result-item {
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
}

.result-item:last-child {
  border-bottom: none;
}

.gap-2 {
  gap: 0.5rem;
}
</style>

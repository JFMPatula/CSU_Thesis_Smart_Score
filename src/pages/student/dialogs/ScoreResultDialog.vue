<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import {
  getScoreColor,
  getGradeLetter,
  getAnswerResultColor,
  getAnswerResultIcon,
  getPassStatus,
} from "../utils/helpers";
import { useAnswerKeysStore } from "@/stores/answerKeysData";

// Props
interface Props {
  modelValue: boolean;
  quizTitle?: string;
  studentName?: string;
  studentId?: string;
  quizId?: string;
  scoreData?: {
    score: number;
    remarks: string;
    totalCorrect: number;
    totalIncorrect: number;
    totalQuestions: number;
    comparisons: Array<{
      questionNumber: number;
      studentAnswer: string;
      correctAnswer: string;
      isCorrect: boolean;
      points: number;
      confidence?: number;
      explanation?: string;
    }>;
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

// Store
const answerKeysStore = useAnswerKeysStore();

// State
const currentQuiz = ref<any>(null);

// Computed
const scorePercentage = computed(() => props.scoreData?.score || 0);
const scoreColor = computed(() => getScoreColor(scorePercentage.value));
const scoreGrade = computed(() => getGradeLetter(scorePercentage.value));
const passStatus = computed(() => getPassStatus(scorePercentage.value));
const isQuizActive = computed(() => currentQuiz.value?.is_active || false);

/**
 * Fetch quiz data to check if it's active
 */
const fetchQuizData = async () => {
  if (props.quizId) {
    const { data } = await answerKeysStore.fetchAnswerKeyById(props.quizId);
    if (data) {
      currentQuiz.value = data;
    }
  }
};

/**
 * Handle dialog close
 */
const handleClose = () => {
  emit("update:modelValue", false);
  emit("close");
};

// Watch for quizId changes and fetch quiz data
onMounted(() => {
  if (props.quizId) {
    fetchQuizData();
  }
});

// Watch for changes in quizId
watch(
  () => props.quizId,
  (newQuizId) => {
    if (newQuizId) {
      fetchQuizData();
    }
  },
);

// Helper functions are imported from utils
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

        <!-- Score Summary -->
        <v-card variant="tonal" :color="scoreColor" class="mb-4">
          <v-card-text class="text-center pa-6">
            <div class="d-flex justify-center align-center mb-4">
              <v-avatar :color="scoreColor" size="80" class="text-white">
                <span class="text-h4">{{ scoreGrade }}</span>
              </v-avatar>
            </div>

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
          </v-card-text>
        </v-card>

        <!-- Statistics -->
        <v-row class="mb-4">
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
                          v-if="!isQuizActive"
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
                      v-if="comparison.explanation"
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

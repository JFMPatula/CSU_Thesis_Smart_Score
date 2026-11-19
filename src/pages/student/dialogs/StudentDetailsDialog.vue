<script setup lang="ts">
import { computed } from 'vue';
import type { Student } from '@/stores/studentsData';
import { getScoreColor, getGradeLetter, formatDate, getQuestionNumber } from '../utils/helpers';
import { getAnswerValue } from '../utils/getHelpers';

// Props
interface Props {
  modelValue: boolean;
  student: Student | null;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  student: null,
});

// Emits
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'close': [];
}>();

// Computed
const feedbackReleased = computed(() => props.student?.feedback_released === true);
const hasScore = computed(() => typeof props.student?.score === 'number' && !Number.isNaN(props.student.score));
const isPendingRelease = computed(() => !hasScore.value && feedbackReleased.value === false);
const passStatus = computed(() => (hasScore.value ? (props.student!.score as number) >= 75 : false));
const headerColor = computed(() => (isPendingRelease.value ? 'info' : getScoreColor(props.student?.score ?? null)));
const scoreLabel = computed(() => (isPendingRelease.value ? '…' : getGradeLetter(props.student?.score ?? null)));

/**
 * Get the correct answer stored with the graded response. The server strips
 * this field unless the teacher has released feedback.
 */
const getCorrectAnswer = (_questionNumber: string | number, answerObj?: any) => {
  if (!feedbackReleased.value || !answerObj) return '';
  const stored = answerObj.correctAnswerText || answerObj.correctAnswer;
  return typeof stored === 'string' ? stored : '';
};

/**
 * Per-question verdict is only shown after feedback is released. The server
 * removes `isCorrect` from unreleased records.
 */
const isAnswerCorrectLocal = (_studentAnswer: string, _questionNumber: string | number, answerObj?: any) => {
  if (!feedbackReleased.value) return false;
  return answerObj && answerObj.isCorrect === true;
};

/**
 * Get AI comparison data for a question.
 * Only returns data persisted at grading time - no live AI calls, so the
 * student and teacher views always render the same explanation/verdict.
 */
const getAIComparison = (_questionNumber: string | number, answerObj?: any) => {
  if (answerObj && typeof answerObj.aiExplanation === 'string') {
    return {
      areEquivalent: !!answerObj.isCorrect,
      confidence: typeof answerObj.aiConfidence === 'number' ? answerObj.aiConfidence : undefined,
      explanation: answerObj.aiExplanation
    };
  }
  return undefined;
};

/**
 * Handle dialog close
 */
const handleClose = () => {
  emit('update:modelValue', false);
  emit('close');
};
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="700"
    scrollable
    persistent
  >
    <v-card v-if="student">
      <!-- Header -->
      <v-card-title class="d-flex align-center pa-4" :class="`bg-${headerColor}`">
        <v-icon left color="white">mdi-account-details</v-icon>
        <span class="text-white">Student Record Details</span>
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
        <div>
          <!-- Student Information -->
          <v-card variant="outlined" class="mb-4">
            <v-card-text class="pa-4">
              <div class="text-h6 mb-3">
                <v-icon left>mdi-account</v-icon>
                Student Information
              </div>
              <v-row>
                <v-col cols="12" md="6">
                  <div class="text-subtitle-2 text-medium-emphasis">Full Name</div>
                  <div class="text-h6">{{ student.fullname }}</div>
                </v-col>
                <v-col cols="12" md="6">
                  <div class="text-subtitle-2 text-medium-emphasis">Student ID</div>
                  <div class="text-h6">{{ student.student_id }}</div>
                </v-col>
                <v-col cols="12" md="6">
                  <div class="text-subtitle-2 text-medium-emphasis">Submission Date</div>
                  <div class="text-body-1">{{ formatDate(student.created_at) }}</div>
                </v-col>
                <v-col cols="12" md="6">
                  <div class="text-subtitle-2 text-medium-emphasis">Quiz ID</div>
                  <div class="text-body-1">{{ student.answer_key_id }}</div>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>

          <!-- Score Summary -->
          <v-card variant="tonal" :color="headerColor" class="mb-4">
            <v-card-text class="text-center pa-6">
              <div class="d-flex justify-center align-center mb-4">
                <v-avatar :color="headerColor" size="80" class="text-white">
                  <span class="text-h4">{{ scoreLabel }}</span>
                </v-avatar>
              </div>

              <template v-if="!isPendingRelease">
                <div class="text-h3 mb-2" :class="`text-${headerColor}`">
                  {{ student.score ?? 'N/A' }}%
                </div>

                <div class="text-h6 mb-3">
                  {{ student.remarks || 'No remarks available' }}
                </div>

                <v-chip
                  v-if="hasScore"
                  :color="passStatus ? 'success' : 'error'"
                  variant="flat"
                  size="large"
                  class="text-white"
                >
                  <v-icon left>{{ passStatus ? 'mdi-check-circle' : 'mdi-close-circle' }}</v-icon>
                  {{ passStatus ? 'PASSED' : 'FAILED' }}
                </v-chip>
              </template>
              <template v-else>
                <div class="text-h5 mb-2">Results pending release</div>
                <div class="text-body-1 text-medium-emphasis">
                  Your teacher has not released the score and feedback for this submission yet.
                </div>
              </template>
            </v-card-text>
          </v-card>

          <!-- Answer Details with Comparison -->
          <v-card variant="outlined" v-if="student.answers">
            <v-card-title class="pa-3">
              <v-icon left>mdi-clipboard-text</v-icon>
              Student Answers & Comparison
            </v-card-title>

            <v-divider />

            <v-alert
              v-if="!feedbackReleased"
              type="info"
              variant="tonal"
              density="compact"
              class="ma-3"
            >
              Answer feedback has not been released by your teacher yet. Your answers are shown,
              but correct answers, explanations, and per-question verdicts are hidden.
            </v-alert>

            <div class="results-container" style="max-height: 300px; overflow-y: auto;">
              <v-list density="comfortable">
                <!-- Object format answers -->
                <template v-if="typeof student.answers === 'object' && student.answers !== null && !Array.isArray(student.answers)">
                  <v-list-item
                    v-for="(answer, questionKey) in student.answers"
                    :key="`answer-${questionKey}`"
                    class="answer-item"
                  >
                    <template #prepend>
                      <v-avatar
                        color="info"
                        size="32"
                      >
                        <span class="text-white text-caption font-weight-bold">{{ getQuestionNumber(questionKey) }}</span>
                      </v-avatar>
                    </template>

                    <v-list-item-title>
                      <div class="d-flex flex-column">
                        <div class="d-flex align-center justify-space-between mb-2">
                          <span class="text-body-1">Question {{ getQuestionNumber(questionKey) }}</span>
                          <div class="d-flex gap-2">
                            <v-chip
                              :color="feedbackReleased ? (isAnswerCorrectLocal(getAnswerValue(answer), getQuestionNumber(questionKey), answer) ? 'success' : 'error') : 'grey'"
                              size="small"
                              variant="outlined"
                            >
                              Your Answer: {{ getAnswerValue(answer) }}
                            </v-chip>
                            <v-chip
                              v-if="feedbackReleased"
                              color="primary"
                              size="small"
                              variant="tonal"
                            >
                              Correct: {{ getCorrectAnswer(getQuestionNumber(questionKey), answer) }}
                            </v-chip>
                          </div>
                        </div>

                        <!-- AI Explanation (if available) -->
                        <div
                          v-if="feedbackReleased && getAIComparison(getQuestionNumber(questionKey), answer)"
                          class="text-caption text-medium-emphasis mt-1 ml-2"
                        >
                          <v-icon size="x-small" class="mr-1">mdi-robot</v-icon>
                          {{ getAIComparison(getQuestionNumber(questionKey), answer)?.explanation }}
                          <v-chip
                            v-if="getAIComparison(getQuestionNumber(questionKey), answer)?.confidence !== undefined"
                            size="x-small"
                            variant="text"
                            class="ml-2"
                          >
                            Confidence: {{ Math.round((getAIComparison(getQuestionNumber(questionKey), answer)?.confidence || 0) * 100) }}%
                          </v-chip>
                        </div>
                      </div>
                    </v-list-item-title>

                    <template #append>
                      <v-icon
                        v-if="feedbackReleased"
                        :color="isAnswerCorrectLocal(getAnswerValue(answer), getQuestionNumber(questionKey), answer) ? 'success' : 'error'"
                        :icon="isAnswerCorrectLocal(getAnswerValue(answer), getQuestionNumber(questionKey), answer) ? 'mdi-check-circle' : 'mdi-close-circle'"
                      />
                    </template>
                  </v-list-item>
                </template>

                <!-- Array format answers -->
                <template v-else-if="Array.isArray(student.answers)">
                  <v-list-item
                    v-for="(answer, index) in student.answers"
                    :key="`answer-${index}`"
                    class="answer-item"
                  >
                    <template #prepend>
                      <v-avatar
                        color="info"
                        size="32"
                      >
                        <span class="text-white text-caption font-weight-bold">{{ answer?.questionNumber || index + 1 }}</span>
                      </v-avatar>
                    </template>

                    <v-list-item-title>
                      <div class="d-flex flex-column">
                        <div class="d-flex align-center justify-space-between mb-2">
                          <span class="text-body-1">Question {{ answer?.questionNumber || index + 1 }}</span>
                          <div class="d-flex gap-2">
                            <v-chip
                              :color="feedbackReleased ? (isAnswerCorrectLocal(getAnswerValue(answer), answer?.questionNumber || index + 1, answer) ? 'success' : 'error') : 'grey'"
                              size="small"
                              variant="outlined"
                            >
                              Your Answer: {{ getAnswerValue(answer) }}
                            </v-chip>
                            <v-chip
                              v-if="feedbackReleased"
                              color="primary"
                              size="small"
                              variant="tonal"
                            >
                              Correct: {{ getCorrectAnswer(answer?.questionNumber || index + 1, answer) }}
                            </v-chip>
                          </div>
                        </div>

                        <!-- AI Explanation (if available) -->
                        <div
                          v-if="feedbackReleased && getAIComparison(answer?.questionNumber || index + 1, answer)"
                          class="text-caption text-medium-emphasis mt-1 ml-2"
                        >
                          <v-icon size="x-small" class="mr-1">mdi-robot</v-icon>
                          {{ getAIComparison(answer?.questionNumber || index + 1, answer)?.explanation }}
                          <v-chip
                            v-if="getAIComparison(answer?.questionNumber || index + 1, answer)?.confidence !== undefined"
                            size="x-small"
                            variant="text"
                            class="ml-2"
                          >
                            Confidence: {{ Math.round((getAIComparison(answer?.questionNumber || index + 1, answer)?.confidence || 0) * 100) }}%
                          </v-chip>
                        </div>
                      </div>
                    </v-list-item-title>

                    <template #append>
                      <v-icon
                        v-if="feedbackReleased"
                        :color="isAnswerCorrectLocal(getAnswerValue(answer), answer?.questionNumber || index + 1, answer) ? 'success' : 'error'"
                        :icon="isAnswerCorrectLocal(getAnswerValue(answer), answer?.questionNumber || index + 1, answer) ? 'mdi-check-circle' : 'mdi-close-circle'"
                      />
                    </template>
                  </v-list-item>
                </template>

                <!-- Fallback for other formats -->
                <template v-else>
                  <v-list-item class="answer-item">
                    <template #prepend>
                      <v-avatar
                        color="info"
                        size="32"
                      >
                        <v-icon color="white" size="small">mdi-text</v-icon>
                      </v-avatar>
                    </template>

                    <v-list-item-title>
                      <div class="d-flex align-center justify-space-between">
                        <span class="text-body-1">Student Response</span>
                        <div class="d-flex gap-2">
                          <v-chip
                            color="primary"
                            size="small"
                            variant="outlined"
                          >
                            {{ getAnswerValue(student.answers) }}
                          </v-chip>
                        </div>
                      </div>
                    </v-list-item-title>
                  </v-list-item>
                </template>
              </v-list>

              <!-- If no answers at all -->
              <div v-if="!student.answers" class="text-center pa-4">
                <v-icon size="48" color="grey">mdi-alert-circle-outline</v-icon>
                <div class="text-body-1 mt-2">No answers recorded for this submission.</div>
              </div>
            </div>
          </v-card>

          <!-- Submitted Image -->
          <v-card variant="outlined" v-if="student.image_url" class="mt-4">
            <v-card-title class="pa-3">
              <v-icon left>mdi-image</v-icon>
              Submitted Answer Sheet
            </v-card-title>

            <v-divider />

            <v-card-text class="pa-4 text-center">
              <v-img
                :src="student.image_url"
                max-height="400"
                class="rounded"
                :alt="`Answer sheet submitted by ${student.fullname}`"
              />
            </v-card-text>
          </v-card>
        </div>
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
          Close
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.results-container {
  border-radius: 0;
}

.answer-item {
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
}

.answer-item:last-child {
  border-bottom: none;
}

.gap-2 {
  gap: 0.5rem;
}
</style>

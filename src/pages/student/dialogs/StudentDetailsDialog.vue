<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useAnswerKeysStore } from '@/stores/answerKeysData';
import type { Student } from '@/stores/studentsData';
import { getScoreColor, getGradeLetter, formatDate, getQuestionNumber } from '../utils/helpers';
import { getAnswerValue, getCorrectAnswerForQuestion, isAnswerCorrect } from '../utils/getHelpers';

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

// Store
const answerKeysStore = useAnswerKeysStore();

// State
const answerKeyData = ref<any>(null);
const isLoading = ref(false);

// Computed
const passStatus = computed(() => (props.student?.score ?? 0) >= 75);
const isQuizActive = computed(() => answerKeyData.value?.is_active || false);

/**
 * Fetch answer key data when student is provided
 */
const fetchAnswerKeyData = async () => {
  if (!props.student?.answer_key_id) return;

  try {
    isLoading.value = true;
    console.log('Fetching answer key data for ID:', props.student.answer_key_id);
    const { data, error } = await answerKeysStore.fetchAnswerKeyById(props.student.answer_key_id);

    if (error) {
      console.error('Error fetching answer key:', error);
      return;
    }

    if (data) {
      answerKeyData.value = data;
      console.log('Answer key data loaded successfully:', data);
      console.log('Answer keys structure:', data.answer_keys);
    } else {
      console.warn('No answer key data returned');
    }
  } catch (error) {
    console.error('Error fetching answer key data:', error);
  } finally {
    isLoading.value = false;
  }
};

/**
 * Get correct answer from answer key data
 */
const getCorrectAnswer = (questionNumber: string | number) => {
  return getCorrectAnswerForQuestion(questionNumber, answerKeyData.value);
};

/**
 * Check if student answer is correct
 *
 * Priority:
 *  1. Stored verdict persisted at grading time (single source of truth, so the
 *     teacher view shows the exact same per-question result as the student).
 *  2. Deterministic exact-match fallback for legacy records (no live AI — live
 *     AI is non-deterministic and made the student and teacher views disagree).
 */
const isAnswerCorrectLocal = (studentAnswer: string, questionNumber: string | number, answerObj?: any) => {
  if (answerObj && typeof answerObj.isCorrect === 'boolean') {
    return answerObj.isCorrect;
  }

  // Deterministic fallback shared with the teacher view.
  return isAnswerCorrect(studentAnswer, questionNumber, answerKeyData.value);
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
  answerKeyData.value = null;
  emit('update:modelValue', false);
  emit('close');
};

/**
 * Watch for student changes
 */
watch(() => props.student, (newStudent) => {
  if (newStudent && props.modelValue) {
    fetchAnswerKeyData();
  }
}, { immediate: true });

/**
 * Watch for dialog open/close
 */
watch(() => props.modelValue, (isOpen) => {
  if (isOpen && props.student) {
    fetchAnswerKeyData();
  } else if (!isOpen) {
    answerKeyData.value = null;
  }
});
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
      <v-card-title class="d-flex align-center pa-4" :class="`bg-${getScoreColor(student.score)}`">
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
        <!-- Loading State -->
        <div v-if="isLoading" class="text-center pa-6">
          <v-progress-circular
            color="primary"
            indeterminate
            size="64"
          />
          <div class="text-h6 mt-3">Loading student details...</div>
        </div>

        <div v-else>
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
          <v-card variant="tonal" :color="getScoreColor(student.score)" class="mb-4">
            <v-card-text class="text-center pa-6">
              <div class="d-flex justify-center align-center mb-4">
                <v-avatar :color="getScoreColor(student.score)" size="80" class="text-white">
                  <span class="text-h4">{{ getGradeLetter(student.score) }}</span>
                </v-avatar>
              </div>

              <div class="text-h3 mb-2" :class="`text-${getScoreColor(student.score)}`">
                {{ student.score ?? 'N/A' }}%
              </div>

              <div class="text-h6 mb-3">
                {{ student.remarks || 'No remarks available' }}
              </div>

              <v-chip
                :color="passStatus ? 'success' : 'error'"
                variant="flat"
                size="large"
                class="text-white"
              >
                <v-icon left>{{ passStatus ? 'mdi-check-circle' : 'mdi-close-circle' }}</v-icon>
                {{ passStatus ? 'PASSED' : 'FAILED' }}
              </v-chip>
            </v-card-text>
          </v-card>

          <!-- Answer Details with Comparison -->
          <v-card variant="outlined" v-if="student.answers">
            <v-card-title class="pa-3">
              <v-icon left>mdi-clipboard-text</v-icon>
              Student Answers & Comparison
            </v-card-title>

            <v-divider />

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
                              :color="isAnswerCorrectLocal(getAnswerValue(answer), getQuestionNumber(questionKey), answer) ? 'success' : 'error'"
                              size="small"
                              variant="outlined"
                            >
                              Your Answer: {{ getAnswerValue(answer) }}
                            </v-chip>
                            <v-chip
                              v-if="!isQuizActive"
                              color="primary"
                              size="small"
                              variant="tonal"
                            >
                              Correct: {{ getCorrectAnswer(getQuestionNumber(questionKey)) }}
                            </v-chip>
                          </div>
                        </div>

                        <!-- AI Explanation (if available) -->
                        <div
                          v-if="getAIComparison(getQuestionNumber(questionKey), answer)"
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
                              :color="isAnswerCorrectLocal(getAnswerValue(answer), answer?.questionNumber || index + 1, answer) ? 'success' : 'error'"
                              size="small"
                              variant="outlined"
                            >
                              Your Answer: {{ getAnswerValue(answer) }}
                            </v-chip>
                            <v-chip
                              v-if="!isQuizActive"
                              color="primary"
                              size="small"
                              variant="tonal"
                            >
                              Correct: {{ getCorrectAnswer(answer?.questionNumber || index + 1) }}
                            </v-chip>
                          </div>
                        </div>

                        <!-- AI Explanation (if available) -->
                        <div
                          v-if="getAIComparison(answer?.questionNumber || index + 1, answer)"
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

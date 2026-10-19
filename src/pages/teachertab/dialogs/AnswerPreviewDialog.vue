<script setup lang="ts">
import { computed, watch, ref, onMounted } from 'vue'
import type { Student } from '@/stores/studentsData'
import { useAnswerKeysStore } from '@/stores/answerKeysData'
import { getScoreColor, formatFullDate } from '@/pages/student/utils/helpers'
import { getAnswerCardClass, getCorrectAnswerForQuestion, getAnswerValue, batchCheckAnswersWithAI } from '@/pages/student/utils/getHelpers'

// Props
interface Props {
  modelValue: boolean
  student: Student | null
  quizTitle?: string
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  student: null,
  quizTitle: 'Unknown Quiz'
})

// Emits
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

// Store
const answerKeysStore = useAnswerKeysStore()

// State for AI synonym checking
const aiComparisons = ref<Map<number, {
  areEquivalent: boolean;
  confidence: number;
  explanation: string;
}>>(new Map())
const isLoadingAI = ref(false)

const answerKeyData = computed(() => {
  if (!props.student?.answer_key_id) return null
  return answerKeysStore.answerKeys.find(ak => ak.id === props.student?.answer_key_id)
})

// Ensure answer keys are loaded when dialog opens
watch(() => props.modelValue, async (isOpen) => {
  if (isOpen) {
    if (answerKeysStore.answerKeys.length === 0) {
      await answerKeysStore.fetchAnswerKeys()
    }
    await performAISynonymChecking()
  }
})

// Performance summary
const performanceSummary = computed(() => {
  if (!parsedAnswers.value.length) return null

  const totalQuestions = parsedAnswers.value.length
  const answeredQuestions = parsedAnswers.value.filter(a => a.selectedAnswer).length
  const correctAnswers = parsedAnswers.value.filter(a => (a.isCorrect || isAnswerCorrectWithAI(a.questionNumber))).length
  const incorrectAnswers = parsedAnswers.value.filter(a => !(a.isCorrect || isAnswerCorrectWithAI(a.questionNumber)) && a.selectedAnswer).length
  const unansweredQuestions = totalQuestions - answeredQuestions

  return {
    totalQuestions,
    answeredQuestions,
    correctAnswers,
    incorrectAnswers,
    unansweredQuestions,
    accuracyRate: answeredQuestions > 0 ? (correctAnswers / answeredQuestions * 100) : 0
  }
})

// AI synonym checking
const performAISynonymChecking = async () => {
  if (!props.student?.answers || !answerKeyData.value?.answer_keys?.questions) {
    return
  }

  try {
    isLoadingAI.value = true
    const answerKeyQuestions = answerKeyData.value.answer_keys.questions

    // Create a map of correct answers by question number
    const correctAnswersMap = new Map<number, string>()
    answerKeyQuestions.forEach((q: any) => {
      correctAnswersMap.set(q.question_number, q.correct_answer)
    })

    // Prepare answer pairs
    const answerPairs: Array<{
      questionNumber: number;
      studentAnswer: string;
      correctAnswer: string;
    }> = []

    const studentAnswers = props.student.answers

    if (typeof studentAnswers === 'object' && !Array.isArray(studentAnswers)) {
      Object.entries(studentAnswers).forEach(([key, answer]) => {
        const qNum = parseInt(key.replace(/\D/g, '')) || getQuestionNumber(key)
        const correctAnswer = correctAnswersMap.get(qNum)
        const studentAnswer = getAnswerValue(answer)
        if (correctAnswer && studentAnswer && studentAnswer !== 'No Answer') {
          answerPairs.push({
            questionNumber: qNum,
            studentAnswer,
            correctAnswer
          })
        }
      })
    } else if (Array.isArray(studentAnswers)) {
      studentAnswers.forEach((answer, index) => {
        const qNum = answer?.questionNumber || index + 1
        const correctAnswer = correctAnswersMap.get(qNum)
        const studentAnswer = getAnswerValue(answer)
        if (correctAnswer && studentAnswer && studentAnswer !== 'No Answer') {
          answerPairs.push({
            questionNumber: qNum,
            studentAnswer,
            correctAnswer
          })
        }
      })
    }

    if (answerPairs.length === 0) return

    const results = await batchCheckAnswersWithAI(answerPairs)
    aiComparisons.value.clear()
    results.forEach((result, questionNumber) => {
      aiComparisons.value.set(questionNumber, {
        areEquivalent: result.isCorrect,
        confidence: result.confidence,
        explanation: result.explanation
      })
    })
  } catch (error) {
    console.error('Error performing AI synonym checking:', error)
  } finally {
    isLoadingAI.value = false
  }
}

const getQuestionNumber = (key: string): number => {
  const num = key.match(/\d+/)
  return num ? parseInt(num[0]) : 1
}

const getAIComparison = (questionNumber: number) => {
  return aiComparisons.value.get(questionNumber)
}

const isAnswerCorrectWithAI = (questionNumber: number) => {
  const aiResult = aiComparisons.value.get(questionNumber)
  if (aiResult) {
    return aiResult.areEquivalent
  }
  return false
}

// Get the correct answers for this student's quiz
const correctAnswers = computed(() => {
  if (!answerKeyData.value?.answer_keys) return null

  try {
    // Handle different formats of answer keys
    if (Array.isArray(answerKeyData.value.answer_keys)) {
      return answerKeyData.value.answer_keys
    }

    if (typeof answerKeyData.value.answer_keys === 'object') {
      if ('answers' in answerKeyData.value.answer_keys) {
        return answerKeyData.value.answer_keys.answers
      }
      if ('questions' in answerKeyData.value.answer_keys) {
        return answerKeyData.value.answer_keys.questions
      }
      return answerKeyData.value.answer_keys
    }

    return null
  } catch (error) {
    console.error('Error parsing correct answers:', error)
    return null
  }
})

// Computed properties
const parsedAnswers = computed(() => {
  if (!props.student?.answers) return []

  try {
    let studentAnswers: any[] = []

    // Handle different answer formats
    if (Array.isArray(props.student.answers)) {
      studentAnswers = props.student.answers
    } else if (typeof props.student.answers === 'object') {
      // If it's an object, try to convert it to array or extract answers
      if ('answers' in props.student.answers) {
        studentAnswers = props.student.answers.answers
      } else {
        // If it's a flat object with question keys, convert to array
        studentAnswers = Object.entries(props.student.answers).map(([key, value]: [string, any]) => ({
          questionNumber: parseInt(key.replace(/\D/g, '')) || getQuestionNumber(key),
          ...value
        }))
      }
    }

    // Compare with correct answers and add comparison results
    return studentAnswers.map((studentAnswer, index) => {
      const questionNum = studentAnswer.questionNumber || (index + 1)
      let correctAnswer = null
      let isCorrect = false

      // Get correct answer
      const correctAnswerValue = getCorrectAnswerForQuestion(questionNum, answerKeyData.value)
      if (correctAnswerValue !== 'N/A') {
        correctAnswer = { correct_answer: correctAnswerValue }
        // Use AI comparison if available, otherwise exact match
        const aiResult = aiComparisons.value.get(questionNum)
        if (aiResult) {
          isCorrect = aiResult.areEquivalent
        } else {
          const studentAnswerValue = getAnswerValue(studentAnswer)
          const correctStr = String(correctAnswerValue).toLowerCase().trim()
          const studentStr = String(studentAnswerValue).toLowerCase().trim()
          isCorrect = correctStr === studentStr
        }
      }

      const result = {
        ...studentAnswer,
        selectedAnswer: getAnswerValue(studentAnswer),
        questionNumber: questionNum,
        correctAnswer: correctAnswer,
        isCorrect: isCorrect
      }

      return result
    })

  } catch (error) {
    console.error('Error parsing answers:', error)
    return []
  }
})

// Watch for student changes
watch(() => props.student, async (newStudent) => {
  if (newStudent && props.modelValue) {
    aiComparisons.value.clear()
    await performAISynonymChecking()
  }
}, { immediate: true })

// Methods
const closeDialog = () => {
  emit('update:modelValue', false)
}

// Helper functions are imported from utility files
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="900"
    scrollable
  >
    <v-card v-if="student">
      <v-card-title class="d-flex align-center pa-4">
        <v-avatar class="me-3">
          <v-img
            v-if="student.image_url"
            :src="student.image_url"
            alt="Student"
          ></v-img>
          <v-icon v-else>mdi-account</v-icon>
        </v-avatar>
        <div>
          <div class="text-h6">{{ student.fullname }}</div>
          <div class="text-subtitle-2 text-medium-emphasis">Student ID: {{ student.student_id }}</div>
        </div>
        <v-spacer></v-spacer>
        <v-btn icon="mdi-close" variant="text" @click="closeDialog"></v-btn>
      </v-card-title>

      <v-divider></v-divider>

      <!-- Student Info Section -->
      <v-card-text class="pa-4">
        <v-row class="mb-4">
          <v-col cols="12" md="6">
            <v-card variant="outlined" class="pa-3">
              <div class="text-subtitle-2 text-medium-emphasis mb-2">Quiz Information</div>
              <div><strong>Quiz:</strong> {{ quizTitle }}</div>
              <div><strong>Submitted:</strong> {{ formatFullDate(student.created_at) }}</div>
            </v-card>
          </v-col>
          <v-col cols="12" md="6">
            <v-card variant="outlined" class="pa-3">
              <div class="text-subtitle-2 text-medium-emphasis mb-2">Score Information</div>
              <div class="d-flex align-center mb-1">
                <strong class="me-2">Score:</strong>
                <v-chip
                  v-if="student.score !== null"
                  :color="getScoreColor(student.score)"
                  size="small"
                >
                  {{ student.score }}%
                </v-chip>
                <v-chip v-else color="grey" size="small" variant="outlined">
                  Not graded
                </v-chip>
              </div>
              <div v-if="student.remarks">
                <strong>Remarks:</strong> {{ student.remarks }}
              </div>
              <div v-else class="text-medium-emphasis">No remarks</div>
            </v-card>
          </v-col>
        </v-row>

        <!-- Performance Summary -->
        <div v-if="performanceSummary && correctAnswers" class="mb-4">
          <v-card variant="outlined" class="pa-3">
            <div class="text-subtitle-2 text-medium-emphasis mb-2">Answer Analysis</div>
            <v-row class="text-center">
              <v-col cols="3">
                <div class="text-success text-h6 font-weight-bold">{{ performanceSummary.correctAnswers }}</div>
                <div class="text-caption">Correct</div>
              </v-col>
              <v-col cols="3">
                <div class="text-error text-h6 font-weight-bold">{{ performanceSummary.incorrectAnswers }}</div>
                <div class="text-caption">Incorrect</div>
              </v-col>
              <v-col cols="3">
                <div class="text-warning text-h6 font-weight-bold">{{ performanceSummary.unansweredQuestions }}</div>
                <div class="text-caption">Unanswered</div>
              </v-col>
              <v-col cols="3">
                <div class="text-primary text-h6 font-weight-bold">{{ performanceSummary.accuracyRate.toFixed(1) }}%</div>
                <div class="text-caption">Accuracy</div>
              </v-col>
            </v-row>
          </v-card>
        </div>

        <!-- Answers Section -->
        <div v-if="parsedAnswers && parsedAnswers.length > 0">
          <div class="d-flex align-center justify-space-between mb-4">
            <h3 class="text-h6">Student Answers</h3>
            <v-chip size="small" color="primary" variant="outlined">
              {{ parsedAnswers.length }} Questions
            </v-chip>
          </div>

          <!-- Answer Cards -->
          <v-row>
            <v-col
              v-for="(answer, index) in parsedAnswers"
              :key="`question-${answer.questionNumber || index}`"
              cols="12"
              md="6"
              lg="4"
            >
              <v-card
                variant="outlined"
                class="answer-card"
                :class="[
                  // Prioritize correctness over other states
                  (answer.correctAnswer && (answer.isCorrect || isAnswerCorrectWithAI(answer.questionNumber))) ? 'border-success' :
                  (answer.correctAnswer && !(answer.isCorrect || isAnswerCorrectWithAI(answer.questionNumber))) ? 'border-error' :
                  getAnswerCardClass(answer)
                ]"
              >
                <v-card-title class="d-flex align-center justify-space-between pa-3">
                  <span class="text-subtitle-1">Question {{ answer.questionNumber || (Number(index) + 1) }}
  
                  </span>
                  <div class="d-flex align-center">
                    <!-- Correct/Incorrect indicator -->
                    <v-tooltip v-if="answer.correctAnswer" :text="(answer.isCorrect || isAnswerCorrectWithAI(answer.questionNumber)) ? 'Correct Answer' : 'Incorrect Answer'">
                      <template #activator="{ props }">
                        <v-icon
                          v-bind="props"
                          :color="(answer.isCorrect || isAnswerCorrectWithAI(answer.questionNumber)) ? 'green' : 'red'"
                          size="20"
                          class="me-2"
                        >
                          {{ (answer.isCorrect || isAnswerCorrectWithAI(answer.questionNumber)) ? 'mdi-check-circle' : 'mdi-close-circle' }}
                        </v-icon>
                      </template>
                    </v-tooltip>

                    <!-- Manual edit indicator - only show if not showing correct/incorrect indicator -->
                    <v-tooltip v-if="answer.isManuallyEdited && !answer.correctAnswer" text="Answer was manually edited by teacher">
                      <template #activator="{ props }">
                        <v-icon v-bind="props" color="warning" size="18">mdi-pencil</v-icon>
                      </template>
                    </v-tooltip>
                  </div>
                </v-card-title>

                <v-divider></v-divider>

                <v-card-text class="pa-3">
                  <!-- Selected Answer -->
                  <div class="mb-2">
                    <div class="text-caption text-medium-emphasis mb-1">Student's Answer:</div>
                    <v-chip
                      :color="answer.selectedAnswer ? ((answer.isCorrect || isAnswerCorrectWithAI(answer.questionNumber)) ? 'green' : 'red') : 'grey'"
                      size="small"
                      variant="elevated"
                    >
                      {{ answer.selectedAnswer || 'No answer' }}
                    </v-chip>
                  </div>

                  <!-- Correct Answer -->
                  <div v-if="answer.correctAnswer" class="mb-2">
                    <div class="text-caption text-medium-emphasis mb-1">Correct Answer:</div>
                    <v-chip
                      color="green"
                      size="small"
                      variant="outlined"
                    >
                      {{ answer.correctAnswer.correct_answer || answer.correctAnswer.correctAnswer || answer.correctAnswer.answer || answer.correctAnswer }}
                    </v-chip>
                  </div>

                  <!-- AI Explanation (if available) -->
                  <div
                    v-if="getAIComparison(answer.questionNumber)"
                    class="text-caption text-medium-emphasis mt-2"
                  >
                    <v-icon size="x-small" class="mr-1">mdi-robot</v-icon>
                    {{ getAIComparison(answer.questionNumber)?.explanation }}
                    <v-chip
                      v-if="getAIComparison(answer.questionNumber)?.confidence !== undefined"
                      size="x-small"
                      variant="text"
                      class="ml-2"
                    >
                      Confidence: {{ Math.round((getAIComparison(answer.questionNumber)?.confidence || 0) * 100) }}%
                    </v-chip>
                  </div>

                  <!-- Alternative Options (if available) -->
                  <div v-if="answer.alternatives && answer.alternatives.length > 0" class="mt-3">
                    <div class="text-caption text-medium-emphasis mb-2">Alternative Options:</div>
                    <div class="d-flex flex-wrap gap-1">
                      <v-chip
                        v-for="(alt, altIndex) in answer.alternatives"
                        :key="`alt-${altIndex}`"
                        size="x-small"
                        color="grey"
                        variant="outlined"
                      >
                        {{ alt }}
                      </v-chip>
                    </div>
                  </div>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>
        </div>

        <!-- No Answers State -->
        <div v-else class="text-center py-8">
          <v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-help-circle-outline</v-icon>
          <div class="text-h6 text-medium-emphasis mb-2">No Answers Available</div>
          <div class="text-body-2 text-medium-emphasis">
            This student hasn't submitted any answers yet.
          </div>
        </div>


      </v-card-text>

      <v-card-actions class="pa-4">
        <v-spacer></v-spacer>
        <v-btn color="grey" variant="text" @click="closeDialog">
          Close
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>



<style scoped>
.answer-card {
  transition: all 0.2s ease-in-out;
  min-height: 200px;
}

.answer-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.border-warning {
  border-left: 4px solid rgb(var(--v-theme-warning)) !important;
}

.border-error {
  border-left: 4px solid #F44336 !important; /* Explicit red color */
}

.border-success {
  border-left: 4px solid #4CAF50 !important; /* Explicit green color */
}

pre {
  font-size: 12px;
  max-height: 300px;
  overflow-y: auto;
}
</style>

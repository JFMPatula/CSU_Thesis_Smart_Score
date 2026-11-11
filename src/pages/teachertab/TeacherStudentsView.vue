<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useDisplay } from 'vuetify'
import {type Student } from '@/stores/studentsData'
import { useTeacherStudents } from '@/pages/teachertab/composables/useTeacherStudents'
import InnerLayoutWrapper from '@/layouts/InnerLayoutWrapper.vue'
import AnswerPreviewDialog from '@/pages/teachertab/dialogs/AnswerPreviewDialog.vue'
import {  formatDate } from '@/pages/student/utils/helpers'
import { getScoreTextClass, getQuizTitle } from '@/pages/student/utils/getHelpers'

// Vuetify display composable for responsive design
const { mobile } = useDisplay()



// Teacher students composable
const teacherStudents = useTeacherStudents()

// State
const loading = ref(false)
const error = ref<string | null>(null)
const searchQuery = ref('')
const selectedAnswerKey = ref<number | null>(null)
const scoreFilter = ref<string | null>(null)
const viewMode = ref<'table' | 'card'>('table')

// Dialog states
const detailsDialog = ref(false)
const selectedStudent = ref<Student | null>(null)

// Data table headers
const headers = [
  { title: 'Student', key: 'fullname', sortable: true },
  { title: 'Quiz', key: 'quiz_title', sortable: false },
  { title: 'Score', key: 'score', sortable: true },
  { title: 'Remarks', key: 'remarks', sortable: false },
  { title: 'Submitted', key: 'created_at', sortable: true },
  { title: 'Actions', key: 'actions', sortable: false, width: '100px' }
]

// Filter options
const scoreFilterOptions = [
  { title: 'All Scores', value: null },
  { title: 'Excellent (90-100%)', value: 'excellent' },
  { title: 'Good (80-89%)', value: 'good' },
  { title: 'Fair (70-79%)', value: 'fair' },
  { title: 'Needs Improvement (60-69%)', value: 'needs-improvement' },
  { title: 'Below Average (<60%)', value: 'below-average' },
  { title: 'Not Graded', value: 'not-graded' }
]

// Computed properties using the composable
const answerKeyOptions = computed(() => [
  { title: 'All Quizzes', id: null },
  ...teacherStudents.userAnswerKeys.value.map(key => ({
    title: key.title,
    id: key.id
  }))
])

// Update filters in the composable when local filters change
const filteredStudents = computed(() => {
  // Set filters in the composable
  teacherStudents.setFilters({
    answerKeyId: selectedAnswerKey.value,
    scoreRange: scoreFilter.value as any,
    searchQuery: searchQuery.value
  })

  return teacherStudents.filteredStudents.value
})

// Use stats from composable
const totalStudents = computed(() => teacherStudents.stats.value.totalStudents)
const totalAnswerKeys = computed(() => teacherStudents.stats.value.totalAnswerKeys)
const averageScore = computed(() => teacherStudents.stats.value.averageScore)

// Auto switch to card view on mobile, or use manual toggle
const shouldShowCardView = computed(() => mobile.value || viewMode.value === 'card')

// Methods
const fetchData = async () => {
  loading.value = true
  error.value = null

  try {
    // Use composable's fetch method
    await teacherStudents.fetchAllData()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load data'
  } finally {
    loading.value = false
  }
}

const getAnswerKeyTitle = (answerKeyId: number | null) => {
  return getQuizTitle(answerKeyId, teacherStudents.userAnswerKeys.value)
}

// getScoreTextClass is imported from utils/getHelpers



const formatTime = (dateString: string | undefined) => {
  if (!dateString) return ''
  return new Date(dateString).toLocaleTimeString()
}

// formatFullDate is imported from utils/helpers

const viewStudentDetails = (student: Student) => {
  selectedStudent.value = student
  detailsDialog.value = true
}

const handleStudentUpdated = (student: Student) => {
  selectedStudent.value = student
}

// Lifecycle
onMounted(() => {
  fetchData()
})
</script>

<template>
  <InnerLayoutWrapper>
    <template #content>
      <v-container fluid class="pa-6">
        <div class="teacher-students-view">
          <!-- Page Header -->
    <div class="d-flex justify-space-between align-center mb-6">
      <div>
        <h1 class="text-h4 font-weight-bold mb-2">My Students</h1>
        <p class="text-subtitle-1 text-medium-emphasis">
          View and manage students who have taken your quizzes
        </p>
      </div>

      <!-- Stats Cards -->
      <div class="d-flex gap-4">
        <v-card class="pa-4" min-width="120">
          <div class="text-h6 font-weight-bold">{{ totalStudents }}</div>
          <div class="text-caption text-medium-emphasis">Total Students</div>
        </v-card>
        <v-card class="pa-4" min-width="120">
          <div class="text-h6 font-weight-bold">{{ totalAnswerKeys }}</div>
          <div class="text-caption text-medium-emphasis">Active Quizzes</div>
        </v-card>
        <v-card class="pa-4" min-width="120">
          <div class="text-h6 font-weight-bold">{{ averageScore.toFixed(1) }}%</div>
          <div class="text-caption text-medium-emphasis">Avg Score</div>
        </v-card>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="text-center py-8">
      <v-progress-circular indeterminate color="primary" size="64"></v-progress-circular>
      <p class="mt-4">Loading students data...</p>
    </div>

    <!-- Error State -->
    <v-alert v-if="error" type="error" class="mb-4">
      {{ error }}
    </v-alert>

    <!-- Main Content -->
    <div v-if="!loading && !error">
      <!-- Filter and Search Controls -->
      <v-card class="mb-4">
        <v-card-text>
          <v-row>
            <v-col cols="12" md="4">
              <v-text-field
                v-model="searchQuery"
                prepend-inner-icon="mdi-magnify"
                label="Search students..."
                variant="outlined"
                density="compact"
                clearable
              ></v-text-field>
            </v-col>
            <v-col cols="12" md="4">
              <v-select
                v-model="selectedAnswerKey"
                :items="answerKeyOptions"
                item-title="title"
                item-value="id"
                label="Filter by Quiz"
                variant="outlined"
                density="compact"
                clearable
              ></v-select>
            </v-col>
            <v-col cols="12" md="3">
              <v-select
                v-model="scoreFilter"
                :items="scoreFilterOptions"
                label="Filter by Score"
                variant="outlined"
                density="compact"
                clearable
              ></v-select>
            </v-col>
            <!-- View Toggle (hidden on mobile) -->
            <v-col v-if="!mobile" cols="12" md="1" class="d-flex align-center justify-end">
              <v-btn-toggle
                v-model="viewMode"
                mandatory
                density="compact"
                color="primary"
              >
                <v-btn value="table" icon="mdi-table" size="small"></v-btn>
                <v-btn value="card" icon="mdi-card-multiple" size="small"></v-btn>
              </v-btn-toggle>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

      <!-- Students Data Display -->
      <!-- Table View (Desktop) -->
      <v-card v-if="!shouldShowCardView">
        <v-data-table
          :headers="headers"
          :items="filteredStudents"
          :loading="loading"
          :search="searchQuery"
          :sort-by="[{ key: 'created_at', order: 'desc' }]"
          class="elevation-1"
          item-key="id"
        >
          <!-- Student Name with ID -->
          <template #item.fullname="{ item }">
            <div class="d-flex align-center">
              <v-avatar size="32" class="me-3">
                <v-img
                  v-if="item.image_url"
                  :src="item.image_url"
                  alt="Student"
                ></v-img>
                <v-icon v-else>mdi-account</v-icon>
              </v-avatar>
              <div>
                <div class="font-weight-medium d-flex align-center">
                  {{ item.fullname }}
                  <v-chip
                    v-if="item.needs_review"
                    color="warning"
                    size="x-small"
                    variant="tonal"
                    class="ms-2"
                  >
                    Needs review
                  </v-chip>
                </div>
                <div class="text-caption text-medium-emphasis">ID: {{ item.student_id }}</div>
              </div>
            </div>
          </template>

          <!-- Quiz Title -->
          <template #item.quiz_title="{ item }">
            <div>
              <div class="font-weight-medium">{{ getAnswerKeyTitle(item.answer_key_id) }}</div>
              <div class="text-caption text-medium-emphasis">Quiz ID: {{ item.answer_key_id }}</div>
            </div>
          </template>

          <!-- Score with Progress -->
          <template #item.score="{ item }">
            <div v-if="item.score !== null" class="d-flex align-center">
              <v-progress-circular
                :model-value="item.score"
                :color="teacherStudents.getScoreColor(item.score)"
                size="24"
                width="3"
                class="me-2"
              ></v-progress-circular>
              <span :class="getScoreTextClass(item.score)">
                {{ item.score }}%
              </span>
            </div>
            <v-chip v-else color="grey" size="small" variant="outlined">
              Not Graded
            </v-chip>
          </template>

          <!-- Remarks -->
          <template #item.remarks="{ item }">
            <div v-if="item.remarks" class="text-truncate" style="max-width: 200px;">
              <v-tooltip :text="item.remarks">
                <template #activator="{ props }">
                  <span v-bind="props">{{ item.remarks }}</span>
                </template>
              </v-tooltip>
            </div>
            <span v-else class="text-medium-emphasis">—</span>
          </template>

          <!-- Submission Date -->
          <template #item.created_at="{ item }">
            <div>
              <div>{{ formatDate(item.created_at) }}</div>
              <div class="text-caption text-medium-emphasis">
                {{ formatTime(item.created_at) }}
              </div>
            </div>
          </template>

          <!-- Actions -->
          <template #item.actions="{ item }">
            <div class="d-flex">
              <v-btn
                icon="mdi-eye"
                size="small"
                variant="text"
                @click="viewStudentDetails(item)"
                title="View Details"
              ></v-btn>
            </div>
          </template>
        </v-data-table>
      </v-card>

      <!-- Card View (Mobile/Manual Toggle) -->
      <div v-else>
        <v-row>
          <v-col
            v-for="student in filteredStudents"
            :key="student.id"
            cols="12"
            sm="6"
            md="4"
            lg="3"
          >
            <v-card class="student-card" elevation="2" hover>
              <!-- Student Header -->
              <v-card-text>
                <div class="d-flex align-center mb-3">
                  <v-avatar size="40" class="me-3">
                    <v-img
                      v-if="student.image_url"
                      :src="student.image_url"
                      alt="Student"
                    ></v-img>
                    <v-icon v-else>mdi-account</v-icon>
                  </v-avatar>
                  <div class="flex-grow-1">
                    <div class="font-weight-bold d-flex align-center">
                      {{ student.fullname }}
                      <v-chip
                        v-if="student.needs_review"
                        color="warning"
                        size="x-small"
                        variant="tonal"
                        class="ms-2"
                      >
                        Needs review
                      </v-chip>
                    </div>
                    <div class="text-caption text-medium-emphasis">ID: {{ student.student_id }}</div>
                  </div>
                </div>

                <!-- Quiz Info -->
                <div class="mb-3">
                  <v-chip
                    size="small"
                    color="blue"
                    variant="tonal"
                    class="mb-2"
                  >
                    {{ getAnswerKeyTitle(student.answer_key_id) }}
                  </v-chip>
                  <div class="text-caption text-medium-emphasis">
                    Quiz ID: {{ student.answer_key_id }}
                  </div>
                </div>

                <!-- Score Display -->
                <div class="mb-3">
                  <div class="d-flex align-center justify-space-between mb-2">
                    <span class="font-weight-medium">Score</span>
                    <div v-if="student.score !== null" class="d-flex align-center">
                      <v-progress-circular
                        :model-value="student.score"
                        :color="teacherStudents.getScoreColor(student.score)"
                        size="24"
                        width="3"
                        class="me-2"
                      ></v-progress-circular>
                      <span :class="getScoreTextClass(student.score)">
                        {{ student.score }}%
                      </span>
                    </div>
                    <v-chip v-else color="grey" size="small" variant="outlined">
                      Not Graded
                    </v-chip>
                  </div>
                </div>

                <!-- Remarks -->
                <div v-if="student.remarks" class="mb-3">
                  <div class="font-weight-medium mb-1">Remarks</div>
                  <div class="text-body-2 text-medium-emphasis">
                    {{ student.remarks }}
                  </div>
                </div>

                <!-- Submission Date -->
                <div class="mb-3">
                  <div class="font-weight-medium mb-1">Submitted</div>
                  <div class="text-body-2">{{ formatDate(student.created_at) }}</div>
                  <div class="text-caption text-medium-emphasis">
                    {{ formatTime(student.created_at) }}
                  </div>
                </div>
              </v-card-text>

              <!-- Card Actions -->
              <v-card-actions class="pt-0">
                <v-btn
                  variant="outlined"
                  size="small"
                  prepend-icon="mdi-eye"
                  @click="viewStudentDetails(student)"
                  block
                >
                  View Details
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-col>
        </v-row>

        <!-- No Results Message -->
        <v-card v-if="filteredStudents.length === 0" class="text-center pa-8">
          <v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-account-search</v-icon>
          <h3 class="text-h6 mb-2">No students found</h3>
          <p class="text-body-2 text-medium-emphasis">
            Try adjusting your search or filter criteria
          </p>
        </v-card>
      </div>
    </div>

    <!-- Student Details Dialog -->
    <AnswerPreviewDialog
      v-model="detailsDialog"
      :student="selectedStudent"
      :quiz-title="selectedStudent ? getAnswerKeyTitle(selectedStudent.answer_key_id) : ''"
      @updated="handleStudentUpdated"
    />
        </div>
      </v-container>
    </template>
  </InnerLayoutWrapper>
</template>



<style scoped>
.teacher-students-view {
  padding: 24px;
}

.gap-4 {
  gap: 16px;
}

.student-card {
  height: 100%;
  transition: transform 0.2s ease-in-out;
}

.student-card:hover {
  transform: translateY(-2px);
}

.student-card .v-card-text {
  padding-bottom: 8px;
}

.student-card .v-card-actions {
  padding-top: 8px;
  padding-bottom: 16px;
}

/* Responsive adjustments */
@media (max-width: 600px) {
  .teacher-students-view {
    padding: 16px;
  }

  .student-card .v-card-actions .v-btn {
    font-size: 0.75rem;
  }
}
</style>

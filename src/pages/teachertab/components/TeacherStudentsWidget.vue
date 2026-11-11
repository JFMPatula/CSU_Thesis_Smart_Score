<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useTeacherStudents } from '@/pages/teachertab/composables/useTeacherStudents'

// Props
interface Props {
  maxStudents?: number
}

const props = withDefaults(defineProps<Props>(), {
  maxStudents: 5
})
// Teacher students composable
const teacherStudents = useTeacherStudents()

// State
const loading = ref(false)
const error = ref<string | null>(null)

// Computed properties using the composable
const recentStudents = computed(() => {
  return teacherStudents.recentStudents.value.slice(0, props.maxStudents)
})

const totalStudents = computed(() => teacherStudents.stats.value.totalStudents)
const gradedStudents = computed(() => teacherStudents.stats.value.gradedStudents)
const averageScore = computed(() => teacherStudents.stats.value.averageScore)

// Methods
const fetchData = async () => {
  loading.value = true
  error.value = null

  try {
    await teacherStudents.fetchAllData()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load data'
  } finally {
    loading.value = false
  }
}

const getAnswerKeyTitle = (answerKeyId: number | null) => {
  if (!answerKeyId) return 'Unknown Quiz'
  const answerKey = teacherStudents.userAnswerKeys.value.find(key => key.id === answerKeyId)
  return answerKey?.title || `Quiz #${answerKeyId}`
}

const getScoreClass = (score: number | null) => {
  const color = teacherStudents.getScoreColor(score)
  if (score === null) return 'text-medium-emphasis'

  const colorMap: Record<string, string> = {
    'green': 'text-success font-weight-medium',
    'light-green': 'text-info font-weight-medium',
    'orange': 'text-warning font-weight-medium',
    'deep-orange': 'text-warning font-weight-medium',
    'red': 'text-error font-weight-medium',
    'grey': 'text-medium-emphasis'
  }

  return colorMap[color] || 'text-medium-emphasis'
}

// Lifecycle
onMounted(() => {
  fetchData()
})
</script>

<template>
  <v-card class="teacher-students-widget">
    <v-card-title class="d-flex align-center">
      <v-icon class="me-2">mdi-account-group</v-icon>
      My Students Summary
    </v-card-title>

    <v-card-text>
      <!-- Loading State -->
      <div v-if="loading" class="text-center py-4">
        <v-progress-circular indeterminate size="32"></v-progress-circular>
      </div>

      <!-- Error State -->
      <v-alert v-else-if="error" type="error" density="compact" class="mb-4">
        {{ error }}
      </v-alert>

      <!-- Content -->
      <div v-else>
        <!-- Stats Row -->
        <v-row class="mb-4">
          <v-col cols="4">
            <div class="text-center">
              <div class="text-h5 font-weight-bold text-primary">{{ totalStudents }}</div>
              <div class="text-caption text-medium-emphasis">Total Students</div>
            </div>
          </v-col>
          <v-col cols="4">
            <div class="text-center">
              <div class="text-h5 font-weight-bold text-success">{{ gradedStudents }}</div>
              <div class="text-caption text-medium-emphasis">Graded</div>
            </div>
          </v-col>
          <v-col cols="4">
            <div class="text-center">
              <div class="text-h5 font-weight-bold text-info">{{ averageScore.toFixed(1) }}%</div>
              <div class="text-caption text-medium-emphasis">Avg Score</div>
            </div>
          </v-col>
        </v-row>

        <!-- Recent Students -->
        <v-divider class="mb-4"></v-divider>
        <div class="mb-3">
          <h4 class="text-subtitle-1 font-weight-medium">Recent Submissions</h4>
        </div>

        <div v-if="recentStudents.length > 0">
          <div
            v-for="student in recentStudents"
            :key="student.id"
            class="d-flex align-center py-2 border-b"
          >
            <v-avatar size="32" class="me-3">
              <v-img
                v-if="student.image_url"
                :src="student.image_url"
                alt="Student"
              ></v-img>
              <v-icon v-else size="20">mdi-account</v-icon>
            </v-avatar>

            <div class="flex-grow-1">
              <div class="text-body-2 font-weight-medium d-flex align-center">
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
              <div class="text-caption text-medium-emphasis">
                {{ getAnswerKeyTitle(student.answer_key_id) }}
              </div>
            </div>

            <div class="text-right">
              <div v-if="student.score !== null" :class="getScoreClass(student.score)">
                {{ student.score }}%
              </div>
              <v-chip v-else size="x-small" color="grey" variant="outlined">
                Pending
              </v-chip>
            </div>
          </div>
        </div>

        <div v-else class="text-center py-4 text-medium-emphasis">
          <v-icon size="48" class="mb-2">mdi-account-group-outline</v-icon>
          <div>No students found</div>
        </div>
      </div>
    </v-card-text>

    <v-card-actions v-if="!loading && !error">
      <v-spacer></v-spacer>
      <v-btn
        color="primary"
        variant="text"
        :to="'/teachertab/teacher-students'"
      >
        View All Students
        <v-icon end>mdi-arrow-right</v-icon>
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<style scoped>
.teacher-students-widget {
  height: 100%;
}

.border-b:not(:last-child) {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}
</style>

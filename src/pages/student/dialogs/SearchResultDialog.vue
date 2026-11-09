<script setup lang="ts">
import { ref, computed } from 'vue';
import { useStudentsStore } from '@/stores/studentsData';
import type { Student } from '@/stores/studentsData';
import { getScoreColor, getGradeLetter, formatDate } from '../utils/helpers';
import StudentDetailsDialog from './StudentDetailsDialog.vue';

// Props
interface Props {
  modelValue: boolean;
  quizTitle?: string;
  answerKeyId?: number;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  quizTitle: 'Quiz',
});

// Emits
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

// Store
const studentsStore = useStudentsStore();

// State
const studentIdQuery = ref('');
const fullNameQuery = ref('');
const isSearching = ref(false);
const searchResults = ref<Student[]>([]);
const hasSearched = ref(false);
const selectedStudent = ref<Student | null>(null);
const showStudentDetails = ref(false);

// Computed
const canSearch = computed(() =>
  Boolean(studentIdQuery.value.trim() || fullNameQuery.value.trim())
);

const noResultsFound = computed(() =>
  hasSearched.value && searchResults.value.length === 0
);

/**
 * Search for student records
 */
const searchStudents = async () => {
  if (!canSearch.value || !props.answerKeyId) {
    return;
  }

  try {
    isSearching.value = true;
    hasSearched.value = true;

    const { data, error } = await studentsStore.searchStudentRecords(
      props.answerKeyId,
      studentIdQuery.value,
      fullNameQuery.value
    );

    if (error) {
      console.error('Error searching students:', error);
      searchResults.value = [];
      return;
    }

    searchResults.value = data || [];
  } catch (error) {
    console.error('Error searching students:', error);
    searchResults.value = [];
  } finally {
    isSearching.value = false;
  }
};

/**
 * View student details
 */
const viewStudent = (student: Student) => {
  selectedStudent.value = student;
  showStudentDetails.value = true;
};

/**
 * Close student details
 */
const closeStudentDetails = () => {
  selectedStudent.value = null;
  showStudentDetails.value = false;
};

/**
 * Handle dialog close
 */
const handleClose = () => {
  // Reset state
  studentIdQuery.value = '';
  fullNameQuery.value = '';
  searchResults.value = [];
  hasSearched.value = false;
  selectedStudent.value = null;
  showStudentDetails.value = false;

  emit('update:modelValue', false);
};

/**
 * Handle search on enter
 */
const handleSearchEnter = () => {
  searchStudents();
};
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="900"
    persistent
    scrollable
  >
    <v-card>
      <!-- Header -->
      <v-card-title class="d-flex align-center pa-4 bg-primary">
        <v-icon left color="white">mdi-account-search</v-icon>
        <span class="text-white">Search Student Records - {{ quizTitle }}</span>
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
        <!-- Search Section -->
        <v-card variant="outlined" class="mb-4">
          <v-card-text class="pa-4">
            <div class="text-h6 mb-3">
              <v-icon left>mdi-magnify</v-icon>
              Search Student
            </div>

            <v-row>
              <v-col cols="12" md="4">
                <v-text-field
                  v-model="studentIdQuery"
                  label="Student ID"
                  prepend-inner-icon="mdi-card-account-details"
                  variant="outlined"
                  density="comfortable"
                  clearable
                  @keyup.enter="handleSearchEnter"
                  :disabled="isSearching"
                />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field
                  v-model="fullNameQuery"
                  label="Full Name"
                  prepend-inner-icon="mdi-account"
                  variant="outlined"
                  density="comfortable"
                  clearable
                  @keyup.enter="handleSearchEnter"
                  :disabled="isSearching"
                />
              </v-col>
              <v-col cols="12" md="4" class="d-flex align-center">
                <v-btn
                  color="primary"
                  variant="flat"
                  @click="searchStudents"
                  :loading="isSearching"
                  :disabled="!canSearch"
                  block
                  prepend-icon="mdi-magnify"
                >
                  Search
                </v-btn>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>

        <!-- Search Results -->
        <v-card variant="outlined" v-if="hasSearched">
          <v-card-title class="pa-3">
            <v-icon left>mdi-format-list-bulleted</v-icon>
            Search Results
            <v-spacer />
            <v-chip
              :color="searchResults.length > 0 ? 'success' : 'error'"
              size="small"
            >
              {{ searchResults.length }} found
            </v-chip>
          </v-card-title>

          <v-divider />

          <!-- No Results -->
          <div v-if="noResultsFound" class="text-center pa-8">
            <v-icon size="64" color="grey">mdi-account-question</v-icon>
            <div class="text-h6 mt-4 mb-2">No Records Found</div>
            <div class="text-body-2 text-medium-emphasis">
              No student records found for the provided student ID or name in this quiz.
            </div>
          </div>

          <!-- Results List -->
          <div v-else-if="searchResults.length > 0" class="results-container" style="max-height: 400px; overflow-y: auto;">
            <v-list>
              <v-list-item
                v-for="student in searchResults"
                :key="`student-${student.id}`"
                class="result-item"
                @click="viewStudent(student)"
              >
                <template #prepend>
                  <v-avatar :color="getScoreColor(student.score)" size="40">
                    <span class="text-white font-weight-bold">
                      {{ getGradeLetter(student.score) }}
                    </span>
                  </v-avatar>
                </template>

                <v-list-item-title>
                  <div class="d-flex align-center justify-space-between">
                    <div>
                      <div class="text-body-1 font-weight-medium">{{ student.fullname }}</div>
                      <div class="text-body-2 text-medium-emphasis">ID: {{ student.student_id }}</div>
                    </div>
                    <div class="text-right">
                      <v-chip
                        :color="getScoreColor(student.score)"
                        size="small"
                        variant="flat"
                      >
                        {{ student.score ?? 'N/A' }}%
                      </v-chip>
                    </div>
                  </div>
                </v-list-item-title>

                <v-list-item-subtitle>
                  <div class="d-flex align-center justify-space-between mt-1">
                    <span>{{ formatDate(student.created_at) }}</span>
                    <span class="text-caption">{{ student.remarks || 'No remarks' }}</span>
                  </div>
                </v-list-item-subtitle>

                <template #append>
                  <v-btn
                    icon
                    variant="text"
                    size="small"
                    color="primary"
                  >
                    <v-icon>mdi-eye</v-icon>
                  </v-btn>
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
          variant="outlined"
          @click="handleClose"
        >
          Close
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- Student Details Dialog -->
    <StudentDetailsDialog
      v-model="showStudentDetails"
      :student="selectedStudent"
      @close="closeStudentDetails"
    />
  </v-dialog>
</template>

<style scoped>
.results-container {
  border-radius: 0;
}

.result-item {
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
  cursor: pointer;
  transition: background-color 0.2s;
}

.result-item:hover {
  background-color: rgba(0, 0, 0, 0.04);
}

.result-item:last-child {
  border-bottom: none;
}
</style>

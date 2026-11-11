<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useToast } from 'vue-toastification'
import InnerLayoutWrapper from '@/layouts/InnerLayoutWrapper.vue'
import StudentDetailsDialog from '@/pages/student/dialogs/StudentDetailsDialog.vue'
import { useStudentsStore } from '@/stores/studentsData'
import type { Student } from '@/stores/studentsData'
import { useAuthUserStore } from '@/stores/authUser'
import { getScoreColor, getGradeLetter, formatDate } from '@/pages/student/utils/helpers'

interface MyResult extends Student {
  quiz_title?: string | null
  quiz_description?: string | null
  needs_review?: boolean
}

const toast = useToast()
const studentsStore = useStudentsStore()
const authStore = useAuthUserStore()

const results = ref<MyResult[]>([])
const loading = ref(false)
const claiming = ref(false)
const studentId = ref('')
const fullname = ref('')
const selected = ref<MyResult | null>(null)
const showDetails = ref(false)

const isStudent = computed(() => Number(authStore.userData?.role_id || 0) === 4)
const hasResults = computed(() => results.value.length > 0)

const loadResults = async () => {
  loading.value = true
  const { data, error } = await studentsStore.fetchMyResults()
  loading.value = false

  if (error) {
    toast.error(String(error))
    return
  }

  results.value = (data || []) as MyResult[]
}

const claimResults = async () => {
  if (!studentId.value.trim() || !fullname.value.trim()) {
    toast.error('Enter the Student ID and full name you used when submitting the quiz.')
    return
  }

  claiming.value = true
  const { count, error } = await studentsStore.claimStudentRecords(studentId.value, fullname.value)
  claiming.value = false

  if (error) {
    toast.error(String(error))
    return
  }

  if (count > 0) {
    toast.success(`Linked ${count} previous result${count === 1 ? '' : 's'}.`)
    studentId.value = ''
    fullname.value = ''
    await loadResults()
    return
  }

  toast.info('No unlinked results found for that Student ID and full name.')
}

const openDetails = (result: MyResult) => {
  selected.value = result
  showDetails.value = true
}

const closeDetails = () => {
  selected.value = null
  showDetails.value = false
}

onMounted(async () => {
  if (authStore.userData === null) {
    await authStore.getCurrentUser()
  }

  if (isStudent.value) {
    await loadResults()
  }
})
</script>

<template>
  <inner-layout-wrapper>
    <template #content>
      <v-container fluid class="pa-6">
        <v-row>
          <v-col cols="12">
            <div class="d-flex align-center mb-6">
              <v-icon icon="mdi-chart-box-outline" size="large" color="primary" class="mr-3"></v-icon>
              <div>
                <h1 class="text-h4 font-weight-bold">My Results</h1>
                <p class="text-subtitle-1 text-medium-emphasis ma-0">
                  View your quiz scores and link results you submitted before creating an account.
                </p>
              </div>
            </div>
          </v-col>
        </v-row>

        <v-alert v-if="!isStudent" type="info" variant="tonal" class="mb-6">
          My Results is available for student accounts only.
        </v-alert>

        <template v-else>
          <v-card variant="outlined" class="mb-6">
            <v-card-title class="d-flex align-center">
              <v-icon class="mr-2">mdi-link-variant</v-icon>
              Link previous results
            </v-card-title>
            <v-card-text>
              <p class="text-body-2 text-medium-emphasis mb-4">
                If you answered a quiz before creating your account, enter the same Student ID and
                full name you used during submission. We will link those results to this account.
              </p>
              <v-row>
                <v-col cols="12" md="4">
                  <v-text-field
                    v-model="studentId"
                    label="Student ID"
                    variant="outlined"
                    density="comfortable"
                    prepend-inner-icon="mdi-card-account-details"
                    :disabled="claiming"
                    @keyup.enter="claimResults"
                  />
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field
                    v-model="fullname"
                    label="Full Name"
                    variant="outlined"
                    density="comfortable"
                    prepend-inner-icon="mdi-account"
                    :disabled="claiming"
                    @keyup.enter="claimResults"
                  />
                </v-col>
                <v-col cols="12" md="4" class="d-flex align-center">
                  <v-btn
                    color="primary"
                    variant="flat"
                    block
                    :loading="claiming"
                    prepend-icon="mdi-link"
                    @click="claimResults"
                  >
                    Link results
                  </v-btn>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>

          <v-card variant="outlined">
            <v-card-title class="d-flex align-center">
              <v-icon class="mr-2">mdi-format-list-bulleted</v-icon>
              Quiz results
              <v-spacer />
              <v-chip size="small" :color="hasResults ? 'success' : 'grey'">
                {{ results.length }} found
              </v-chip>
            </v-card-title>

            <v-divider />

            <div v-if="loading" class="text-center pa-8">
              <v-progress-circular indeterminate color="primary" />
            </div>

            <div v-else-if="!hasResults" class="text-center pa-8">
              <v-icon size="64" color="grey">mdi-clipboard-text-search-outline</v-icon>
              <div class="text-h6 mt-4 mb-2">No results linked yet</div>
              <div class="text-body-2 text-medium-emphasis">
                Use the form above with the Student ID and full name from your quiz submission.
              </div>
            </div>

            <v-list v-else lines="two">
              <v-list-item
                v-for="result in results"
                :key="result.id"
                @click="openDetails(result)"
              >
                <template #prepend>
                  <v-avatar :color="getScoreColor(result.score)" size="40">
                    <span class="text-white font-weight-bold">
                      {{ getGradeLetter(result.score) }}
                    </span>
                  </v-avatar>
                </template>

                <v-list-item-title class="font-weight-medium">
                  {{ result.quiz_title || 'Quiz' }}
                </v-list-item-title>
                <v-list-item-subtitle>
                  {{ formatDate(result.created_at) }} · ID: {{ result.student_id }}
                  <span v-if="result.needs_review"> · Needs review</span>
                </v-list-item-subtitle>

                <template #append>
                  <v-chip :color="getScoreColor(result.score)" size="small" variant="flat">
                    {{ result.score ?? 'N/A' }}%
                  </v-chip>
                  <v-btn icon variant="text" color="primary" class="ml-2">
                    <v-icon>mdi-eye</v-icon>
                  </v-btn>
                </template>
              </v-list-item>
            </v-list>
          </v-card>
        </template>
      </v-container>
    </template>
  </inner-layout-wrapper>

  <StudentDetailsDialog v-model="showDetails" :student="selected" @close="closeDetails" />
</template>

<template>
  <div>
    <v-form @submit.prevent="$emit('submit')">
      <v-row>
        <!-- Title -->
        <v-col cols="12">
          <v-text-field
            :model-value="formData.title"
            @update:model-value="updateField('title', $event)"
            label="Title *"
            :rules="titleRules"
            variant="outlined"
            required
          />
        </v-col>

        <!-- Description -->
        <v-col cols="12">
          <v-textarea
            :model-value="formData.description"
            @update:model-value="updateField('description', $event)"
            label="Description"
            variant="outlined"
            rows="3"
            counter="500"
          />
        </v-col>

        <!-- Status -->
        <v-col cols="12">
          <v-switch
            :model-value="formData.is_active"
            @update:model-value="updateField('is_active', $event)"
            label="Active"
            color="primary"
            inset
          />
        </v-col>

        <!-- Feedback release -->
        <v-col cols="12">
          <v-switch
            :model-value="formData.release_feedback"
            @update:model-value="updateField('release_feedback', $event)"
            label="Release answer feedback to students"
            color="primary"
            inset
            hint="When off, students only see their score and total correct count."
            persistent-hint
          />
        </v-col>

        <!-- Optional access code -->
        <v-col cols="12">
          <v-text-field
            :model-value="formData.access_code"
            @update:model-value="updateField('access_code', $event || '')"
            label="Access code (optional)"
            variant="outlined"
            prepend-inner-icon="mdi-key-outline"
            hint="Students must enter this code before submitting the quiz."
            persistent-hint
            clearable
            autocomplete="off"
          />
        </v-col>

        <!-- Selected Image Display -->
        <v-col v-if="imagePreview" cols="12">
          <v-card variant="outlined" class="pa-2">
            <v-card-title class="text-subtitle-2">Selected Image</v-card-title>
            <div class="d-flex align-center">
              <v-img
                :src="imagePreview"
                max-height="100"
                max-width="100"
                class="me-3"
              />
              <div class="flex-grow-1">
                <div class="text-body-2">
                  {{ isPdfFile ? 'PDF Document' : 'Answer Sheet Image' }}
                  <v-chip v-if="isPdfFile" size="x-small" color="red" class="ml-2">PDF</v-chip>
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{ imageFileName || 'Captured Image' }}
                  <span v-if="isPdfFile && pdfPagesCount"> - {{ pdfPagesCount || 0 }} pages</span>
                </div>
                <div v-if="isPdfFile" class="text-caption text-success">
                  PDF pages will be processed individually with AI
                </div>
              </div>
              <v-btn
                icon="mdi-pencil"
                size="small"
                variant="text"
                @click="$emit('editImage')"
              />
            </div>
          </v-card>
        </v-col>

        <!-- PDF Pages Preview (if PDF) -->
        <v-col v-if="isPdfFile && (pdfPagesCount || 0) > 0" cols="12">
          <v-card variant="outlined" class="pa-2">
            <v-card-title class="text-subtitle-2 d-flex align-center">
              <v-icon class="me-2" color="red">mdi-file-pdf-box</v-icon>
              PDF Document Preview
              <v-spacer />
              <v-chip size="small" color="red" variant="outlined">
                {{ pdfPagesCount || 0 }} pages
              </v-chip>
            </v-card-title>
            <v-card-text>
              <div class="text-body-2 mb-2">
                Each page will be processed individually with AI to extract answer key data.
              </div>
              <div class="text-caption text-medium-emphasis">
                Processing time may vary based on the number of pages and content complexity.
              </div>
            </v-card-text>
          </v-card>
        </v-col>

        <!-- AI Results Display -->
        <v-col v-if="imageResult" cols="12">
          <v-expansion-panels variant="accordion">
            <v-expansion-panel>
              <v-expansion-panel-title>
                <div class="d-flex align-center">
                  <v-icon class="me-2" color="success">mdi-brain</v-icon>
                  <span>AI-Processed Answer Key</span>
                  <v-spacer />
                  <v-chip
                    size="small"
                    color="success"
                    variant="outlined"
                  >
                    {{ imageResult.answerKeyData?.questions?.length || 0 }} Questions Found
                  </v-chip>
                </div>
              </v-expansion-panel-title>
              <v-expansion-panel-text>
                <div v-if="imageResult.answerKeyData?.questions?.length">
                  <v-row>
                    <!-- Processing Stats -->
                    <v-col cols="12">
                      <v-alert type="success" variant="tonal" class="mb-4">
                        <div class="d-flex justify-space-between">
                          <span><strong>AI Vision Analysis:</strong> Complete</span>
                          <span><strong>Processing Time:</strong> {{ (imageResult.processingTime / 1000).toFixed(2) }}s</span>
                        </div>
                      </v-alert>
                    </v-col>

                    <!-- Questions Preview -->
                    <v-col cols="12">
                      <h4 class="text-h6 mb-3">Answer Key Preview</h4>
                      <v-table density="compact">
                        <thead>
                          <tr>
                            <th>Question #</th>
                            <th>Correct Answer</th>
                            <th>Type</th>
                            <th>Points</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="question in imageResult.answerKeyData.questions.slice(0, 10)"
                            :key="question.question_number"
                          >
                            <td>{{ question.question_number }}</td>
                            <td>
                              <v-chip size="small" color="primary">{{ question.correct_answer }}</v-chip>
                            </td>
                            <td>
                              <v-chip size="small" variant="outlined">{{ question.answer_type }}</v-chip>
                            </td>
                            <td>{{ question.points || 1 }}</td>
                          </tr>
                        </tbody>
                      </v-table>

                      <div v-if="imageResult.answerKeyData.questions.length > 10" class="text-center mt-2">
                        <v-chip size="small" variant="outlined">
                          ... and {{ imageResult.answerKeyData.questions.length - 10 }} more questions
                        </v-chip>
                      </div>
                    </v-col>

                    <!-- Subject/Metadata -->
                    <v-col v-if="imageResult.answerKeyData?.metadata" cols="12">
                      <h4 class="text-h6 mb-2">Detected Information</h4>
                      <v-row>
                        <v-col v-if="imageResult.answerKeyData.metadata.subject" cols="6">
                          <div class="text-caption">Subject</div>
                          <div class="text-body-2">{{ imageResult.answerKeyData.metadata.subject }}</div>
                        </v-col>
                        <v-col v-if="imageResult.answerKeyData.metadata.difficulty" cols="6">
                          <div class="text-caption">Difficulty</div>
                          <div class="text-body-2">{{ imageResult.answerKeyData.metadata.difficulty }}</div>
                        </v-col>
                        <v-col v-if="imageResult.answerKeyData.metadata.instructions" cols="12">
                          <div class="text-caption">Instructions</div>
                          <div class="text-body-2">{{ imageResult.answerKeyData.metadata.instructions }}</div>
                        </v-col>
                      </v-row>
                    </v-col>
                  </v-row>
                </div>

                <v-alert v-else type="warning" variant="tonal">
                  No questions were detected in the image. Please ensure the image contains a clear answer key.
                </v-alert>
              </v-expansion-panel-text>
            </v-expansion-panel>


          </v-expansion-panels>
        </v-col>
      </v-row>
    </v-form>
  </div>
</template>

<script setup lang="ts">
interface FormData {
  title: string
  description: string
  is_active: boolean
  release_feedback: boolean
  access_code: string
  answer_images: string | null
  answer_keys: any
}

interface Props {
  formData: FormData
  imagePreview: string | null
  imageFileName: string | null
  imageResult?: any
  isPdfFile?: boolean
  pdfPagesCount?: number
}

interface Emits {
  (e: 'update:formData', value: FormData): void
  (e: 'editImage'): void
  (e: 'submit'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// Form validation
const titleRules = [
  (v: string) => !!v || 'Title is required',
  (v: string) => (v && v.length <= 100) || 'Title must be less than 100 characters'
]

const updateField = (field: keyof FormData, value: any) => {
  const updatedData = { ...props.formData, [field]: value }
  emit('update:formData', updatedData)
}
</script>

<style scoped>
pre {
  background-color: rgb(var(--v-theme-surface-variant));
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  max-height: 200px;
}
</style>

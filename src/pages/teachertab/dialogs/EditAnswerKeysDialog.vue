<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAnswerKeysStore } from '@/stores/answerKeysData'
import { useImageProcessor } from '@/pages/teachertab/composables/processImage'

interface Props {
  modelValue: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const answerKeysStore = useAnswerKeysStore()

// Form data
const formData = ref({
  title: '',
  description: '',
  is_active: true,
  release_feedback: false,
  access_code: '',
  answer_keys: null as any,
  answer_images: null as string | null
})

// Form validation
const titleRules = [
  (v: string) => !!v || 'Title is required',
  (v: string) => (v && v.length <= 100) || 'Title must be less than 100 characters'
]

// File handling
const imageFile = ref<File | null>(null)
const answerKeyFile = ref<File | null>(null)
const imagePreview = ref<string | null>(null)

// Dropzone state
const isDragOver = ref(false)
const hasError = ref(false)
const errorMessage = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

// Image processing
const imageProcessor = useImageProcessor()
const isProcessingImage = ref(false)

// File validation
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif']

// Computed
const isOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

const loading = computed(() => answerKeysStore.loading)
const selectedAnswerKey = computed(() => answerKeysStore.selectedAnswerKey)

// Functions
const validateFile = (file: File): boolean => {
  clearError()

  // Check file type
  if (!ALLOWED_TYPES.includes(file.type.toLowerCase())) {
    setError('Please select a valid image file (JPG, PNG, or GIF)')
    return false
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    setError('File size must be less than 10MB')
    return false
  }

  return true
}

const setError = (message: string) => {
  errorMessage.value = message
  hasError.value = true
}

const clearError = () => {
  errorMessage.value = ''
  hasError.value = false
}

// Dropzone event handlers
const onDragEnter = (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = true
}

const onDragLeave = (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()

  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const x = e.clientX
  const y = e.clientY

  if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
    isDragOver.value = false
  }
}

const onDragOver = (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = true
}

const onDrop = (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = false

  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    const file = files[0]
    handleFileProcess(file)
  }
}

const openFileDialog = () => {
  fileInput.value?.click()
}

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]

  if (file) {
    handleFileProcess(file)
  }
}

const handleFileProcess = async (file: File) => {
  if (!validateFile(file)) return

  try {
    isProcessingImage.value = true
    clearError()

    // Set image file and preview
    imageFile.value = file
    const reader = new FileReader()
    reader.onload = (e) => {
      imagePreview.value = e.target?.result as string
    }
    reader.readAsDataURL(file)

    // Process the image with AI to extract answer key data
    const result = await imageProcessor.processImage(file, false)

    if (result.answerKeyData) {
      // Update the answer_keys field with the processed data
      formData.value.answer_keys = result.answerKeyData
      console.log('Successfully processed image and extracted answer key data:', result.answerKeyData)
    }

  } catch (error) {
    console.error('Error processing image:', error)
    setError('Failed to process image. Please try again.')
  } finally {
    isProcessingImage.value = false
  }
}

// Legacy function for compatibility
const handleImageUpload = (event: Event) => {
  handleFileSelect(event)
}

const handleAnswerKeyUpload = (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]

  if (file) {
    answerKeyFile.value = file
    // Parse JSON file
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string
        formData.value.answer_keys = JSON.parse(content)
      } catch (error) {
        console.error('Error parsing answer key file:', error)
      }
    }
    reader.readAsText(file)
  }
}

const removeImage = () => {
  imageFile.value = null
  imagePreview.value = null
  formData.value.answer_images = null
}

const resetForm = () => {
  formData.value = {
    title: '',
    description: '',
    is_active: true,
    release_feedback: false,
    access_code: '',
    answer_keys: null,
    answer_images: null
  }
  imageFile.value = null
  answerKeyFile.value = null
  imagePreview.value = null
}

const loadAnswerKeyData = () => {
  if (selectedAnswerKey.value) {
    formData.value = {
      title: selectedAnswerKey.value.title,
      description: selectedAnswerKey.value.description || '',
      is_active: selectedAnswerKey.value.is_active,
      release_feedback: selectedAnswerKey.value.release_feedback === true,
      access_code: selectedAnswerKey.value.access_code || '',
      answer_keys: selectedAnswerKey.value.answer_keys,
      answer_images: selectedAnswerKey.value.answer_images || null
    }

    // Set image preview if exists
    if (selectedAnswerKey.value.answer_images) {
      imagePreview.value = selectedAnswerKey.value.answer_images
    }
  }
}

const handleSubmit = async () => {
  if (!selectedAnswerKey.value) return

  try {
    let imageUrl = formData.value.answer_images

    // Upload new image if provided
    if (imageFile.value) {
      // Delete old image if exists
      if (selectedAnswerKey.value.answer_images) {
        const oldImagePath = answerKeysStore.extractImagePathFromUrl(selectedAnswerKey.value.answer_images)
        await answerKeysStore.deleteAnswerImage(oldImagePath)
      }

      // Upload new image
      const imagePath = `answer_key_${Date.now()}_${imageFile.value.name}`
      const uploadResult = await answerKeysStore.uploadAnswerImage(imageFile.value, imagePath)

      if (uploadResult.imageUrl) {
        imageUrl = uploadResult.imageUrl
      }
    }

    // Update answer key
    const updates = {
      title: formData.value.title,
      description: formData.value.description,
      is_active: formData.value.is_active,
      release_feedback: formData.value.release_feedback,
      access_code: formData.value.access_code.trim() || null,
      answer_keys: formData.value.answer_keys,
      answer_images: imageUrl || undefined
    }

    const result = await answerKeysStore.updateAnswerKey(selectedAnswerKey.value.id!, updates)

    if (result.error === null) {
      resetForm()
      isOpen.value = false
    }
  } catch (error) {
    console.error('Error updating answer key:', error)
  }
}

const handleClose = () => {
  resetForm()
  isOpen.value = false
}

const handleViewQRCode = () => {
  if (selectedAnswerKey.value?.qr_link) {
    window.open(selectedAnswerKey.value.qr_link, '_blank')
  }
}

// Watch for dialog open/close
watch(isOpen, (newVal) => {
  if (newVal) {
    loadAnswerKeyData()
  }
})
</script>

<template>
  <v-dialog
    v-model="isOpen"
    max-width="800"
    persistent
    scrollable
  >
    <v-card>
      <v-card-title class="text-h5 font-weight-bold">
        <v-icon class="mr-2" color="primary">mdi-pencil</v-icon>
        Edit Answer Key
      </v-card-title>

      <v-card-text>
        <v-form @submit.prevent="handleSubmit">
          <v-row>
            <!-- Title -->
            <v-col cols="12">
              <v-text-field
                v-model="formData.title"
                label="Title *"
                :rules="titleRules"
                variant="outlined"
                required
              />
            </v-col>

            <!-- Description -->
            <v-col cols="12">
              <v-textarea
                v-model="formData.description"
                label="Description"
                variant="outlined"
                rows="3"
                counter="500"
              />
            </v-col>

            <!-- Status -->
            <v-col cols="12">
              <v-switch
                v-model="formData.is_active"
                label="Active"
                color="primary"
                inset
              />
            </v-col>

            <!-- Feedback release -->
            <v-col cols="12">
              <v-switch
                v-model="formData.release_feedback"
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
                v-model="formData.access_code"
                label="Access code (optional)"
                variant="outlined"
                prepend-inner-icon="mdi-key-outline"
                hint="Students must enter this code before submitting the quiz."
                persistent-hint
                clearable
                autocomplete="off"
              />
            </v-col>

            <!-- Image Upload with Dropzone -->
            <v-col cols="12">
              <div class="mb-3">
                <div class="text-subtitle-1 font-weight-medium mb-2">
                  <v-icon class="mr-2">mdi-image</v-icon>
                  Answer Sheet Image
                </div>
                <div class="text-body-2 text-medium-emphasis mb-3">
                  Upload an image of the answer sheet. AI will automatically extract the answers and update the JSON data.
                </div>
              </div>

              <!-- Dropzone -->
              <div
                class="dropzone"
                :class="{ 'dragover': isDragOver, 'error': hasError, 'processing': isProcessingImage }"
                @drop="onDrop"
                @dragover="onDragOver"
                @dragenter="onDragEnter"
                @dragleave="onDragLeave"
                @click="openFileDialog"
              >
                <div class="dropzone-content">
                  <!-- Processing State -->
                  <div v-if="isProcessingImage" class="processing-state">
                    <v-progress-circular
                      :size="64"
                      :width="6"
                      color="primary"
                      indeterminate
                      class="mb-4"
                    />
                    <div class="text-h6 font-weight-medium mb-2">Processing Image...</div>
                    <div class="text-body-2 text-medium-emphasis">
                      {{ imageProcessor.currentStatus || 'Extracting answer key data...' }}
                    </div>
                    <v-progress-linear
                      v-if="imageProcessor.progress.value > 0"
                      :model-value="imageProcessor.progress.value"
                      class="mt-3"
                      color="primary"
                    />
                  </div>

                  <!-- Default State -->
                  <div v-else>
                    <div class="upload-icon-container">
                      <v-icon size="64" :color="isDragOver ? 'primary' : 'grey-darken-1'" class="upload-icon">
                        {{ isDragOver ? 'mdi-cloud-upload' : 'mdi-image-plus' }}
                      </v-icon>
                    </div>

                    <div class="text-h6 font-weight-medium mb-2" :class="{ 'text-primary': isDragOver }">
                      {{ isDragOver ? 'Drop image here' : 'Upload Answer Sheet' }}
                    </div>

                    <div class="text-body-2 mb-3" :class="isDragOver ? 'text-primary' : 'text-medium-emphasis'">
                      {{ isDragOver ? 'Release to upload and process' : 'Drag and drop an image or click to browse' }}
                    </div>

                    <v-divider class="my-3 mx-auto" style="max-width: 200px;" />

                    <div class="text-body-2 text-medium-emphasis mb-2">
                      <v-chip size="small" variant="outlined" class="mx-1">JPG</v-chip>
                      <v-chip size="small" variant="outlined" class="mx-1">PNG</v-chip>
                      <v-chip size="small" variant="outlined" class="mx-1">GIF</v-chip>
                    </div>

                    <div class="text-caption text-medium-emphasis">
                      Maximum file size: 10MB
                    </div>
                  </div>

                  <!-- Error message -->
                  <v-alert
                    v-if="hasError"
                    type="error"
                    variant="tonal"
                    class="mt-3"
                    dismissible
                    @click:close="clearError"
                  >
                    {{ errorMessage }}
                  </v-alert>
                </div>
              </div>

              <!-- Hidden file input -->
              <input
                ref="fileInput"
                type="file"
                accept="image/*"
                style="display: none"
                @change="handleFileSelect"
              />

              <!-- Image Preview -->
              <div v-if="imagePreview" class="mt-4">
                <v-card variant="outlined" class="pa-3">
                  <div class="d-flex align-start">
                    <v-img
                      :src="imagePreview"
                      max-height="120"
                      max-width="120"
                      class="me-4 rounded"
                      cover
                    />
                    <div class="flex-grow-1">
                      <div class="d-flex align-center justify-space-between mb-2">
                        <div class="text-subtitle-1 font-weight-medium">Image Preview</div>
                        <v-btn
                          icon="mdi-close"
                          size="small"
                          variant="text"
                          @click="removeImage"
                        />
                      </div>
                      <div class="text-body-2 text-medium-emphasis mb-1">
                        {{ imageFile?.name || 'Current image' }}
                      </div>
                      <div v-if="imageFile" class="text-caption text-medium-emphasis">
                        Size: {{ Math.round(imageFile.size / 1024) }}KB
                      </div>

                      <!-- Processing Result -->
                      <div v-if="formData.answer_keys" class="mt-3">
                        <v-chip color="success" size="small" variant="outlined">
                          <v-icon start icon="mdi-check" />
                          Answer key data extracted
                        </v-chip>
                        <div class="text-caption text-medium-emphasis mt-1">
                          Found {{ formData.answer_keys.questions?.length || 0 }} questions
                        </div>
                      </div>
                    </div>
                  </div>
                </v-card>
              </div>
            </v-col>


          </v-row>
        </v-form>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="outlined"
          @click="handleClose"
          :disabled="loading"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          @click="handleSubmit"
          :loading="loading"
          :disabled="!formData.title"
        >
          Update Answer Key
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
pre {
  background-color: rgb(var(--v-theme-surface-variant));
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  max-height: 200px;
}

/* Dropzone Styles */
.dropzone {
  position: relative;
  min-height: 240px;
  border: 2px dashed rgb(var(--v-theme-outline));
  border-radius: 12px;
  background: rgba(var(--v-theme-surface), 0.8);
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.dropzone::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(45deg, transparent 49%, rgba(var(--v-theme-primary), 0.1) 51%);
  opacity: 0;
  transition: opacity 0.3s ease;
  z-index: 0;
}

.dropzone:hover {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.04);
}

.dropzone:hover::before {
  opacity: 1;
}

.dropzone.dragover {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
  transform: scale(1.02);
  box-shadow: 0 8px 25px rgba(var(--v-theme-primary), 0.15);
}

.dropzone.dragover::before {
  opacity: 1;
}

.dropzone.error {
  border-color: rgb(var(--v-theme-error));
  background: rgba(var(--v-theme-error), 0.04);
}

.dropzone.processing {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.04);
  cursor: default;
}

.dropzone-content {
  text-align: center;
  padding: 24px;
  z-index: 1;
  position: relative;
  width: 100%;
}

.upload-icon-container {
  margin-bottom: 16px;
}

.upload-icon {
  transition: all 0.3s ease;
}

.processing-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.dropzone:hover .upload-icon {
  transform: scale(1.1);
}

.dropzone.dragover .upload-icon {
  transform: scale(1.2) rotate(10deg);
}

.rounded {
  border-radius: 8px;
}

/* Responsive adjustments */
@media (max-width: 600px) {
  .dropzone {
    min-height: 200px;
  }

  .dropzone-content {
    padding: 16px;
  }

  .upload-icon {
    font-size: 48px !important;
  }
}
</style>

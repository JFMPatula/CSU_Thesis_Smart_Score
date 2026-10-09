<template>
  <div>
    <!-- Upload Mode -->
    <div v-if="imageSource === 'upload'">
      <div class="text-center mb-4">
        <h3 class="text-h6 mb-2">Upload Answer Sheet Image</h3>
        <p class="text-body-2 text-medium-emphasis">
          Drag and drop an image or PDF file, or click to select
        </p>
      </div>

      <!-- Dropzone -->
      <div
        class="dropzone"
        :class="{ 'dragover': isDragOver, 'error': hasError }"
        @drop="onDrop"
        @dragover="onDragOver"
        @dragenter="onDragEnter"
        @dragleave="onDragLeave"
        @click="openFileDialog"
      >
        <div class="dropzone-content">
          <div class="upload-icon-container">
            <v-icon size="72" :color="isDragOver ? 'primary' : 'grey-darken-1'" class="upload-icon">
              {{ isDragOver ? 'mdi-cloud-upload' : 'mdi-image-plus' }}
            </v-icon>
          </div>

          <div class="text-h5 font-weight-medium mb-3" :class="{ 'text-primary': isDragOver }">
            {{ isDragOver ? 'Drop image here' : 'Upload Answer Sheet' }}
          </div>

          <div class="text-body-1 mb-3" :class="isDragOver ? 'text-primary' : 'text-medium-emphasis'">
            {{ isDragOver ? 'Release to upload your file' : 'Drag and drop an image or PDF file, or click to browse' }}
          </div>

          <v-divider class="my-3 mx-auto" style="max-width: 200px;"></v-divider>

          <div class="text-body-2 text-medium-emphasis mb-2">
            <v-chip size="small" variant="outlined" class="mx-1">JPG</v-chip>
            <v-chip size="small" variant="outlined" class="mx-1">PNG</v-chip>
            <v-chip size="small" variant="outlined" class="mx-1">GIF</v-chip>
            <v-chip size="small" variant="outlined" class="mx-1">PDF</v-chip>
          </div>

          <div class="text-caption text-medium-emphasis">
            Maximum file size: 10MB
          </div>

          <!-- Error message -->
          <v-alert
            v-if="errorMessage"
            type="error"
            density="compact"
            class="mt-4"
            :text="errorMessage"
          />
        </div>

        <!-- Hidden file input -->
        <input
          ref="fileInput"
          type="file"
          accept="image/*,application/pdf"
          style="display: none"
          @change="handleFileSelect"
        />
      </div>

      <!-- Upload progress -->
      <div v-if="isUploading" class="mt-4">
        <v-progress-linear
          :model-value="uploadProgress"
          color="primary"
          height="6"
          rounded
        />
        <div class="text-center text-caption mt-1">
          {{ uploadProgress < 80 ? 'Creating PDF preview...' : 'Processing...' }} {{ uploadProgress }}%
        </div>
      </div>
    </div>

    <!-- Camera Mode -->
    <div v-if="imageSource === 'camera' && showCamera">
      <div class="text-center mb-4">
        <h3 class="text-h6 mb-2">Capture Answer Sheet</h3>
        <p class="text-body-2 text-medium-emphasis">
          Position the answer sheet in the camera view and tap capture
        </p>
      </div>

      <v-card variant="outlined" class="mb-4">
        <div class="camera-container">
          <video
            ref="videoElement"
            autoplay
            playsinline
            class="camera-video"
          />
          <canvas ref="canvasElement" style="display: none;" />
        </div>
        <v-card-actions class="justify-center">
          <v-btn
            color="primary"
            size="large"
            icon="mdi-camera"
            @click="captureImage"
          />
        </v-card-actions>
      </v-card>
    </div>

    <!-- Image Preview -->
    <div v-if="imagePreview">
      <div class="text-center mb-4">
        <h3 class="text-h6 mb-2">Image Preview</h3>
      </div>

      <v-card variant="outlined" class="mb-4">
        <v-img
          :src="imagePreview"
          max-height="400"
          contain
        />
        <v-card-actions class="justify-center">
          <v-btn
            variant="outlined"
            @click="$emit('retake')"
            prepend-icon="mdi-camera-retake"
          >
            Retake
          </v-btn>
          <v-btn
            color="primary"
            @click="$emit('continue')"
            prepend-icon="mdi-check"
          >
            Continue
          </v-btn>
        </v-card-actions>
      </v-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { PDFDocument } from 'pdf-lib'
import { createWorker } from 'tesseract.js'
import { prepareImageSourceForOcr } from '@/lib/ocrImage'
import * as pdfjsLib from 'pdfjs-dist'

// Set up pdf.js worker using CDN for exact version match
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/build/pdf.worker.min.mjs'

interface Props {
  imageSource: 'upload' | 'camera' | null
  imagePreview: string | null
  showCamera: boolean
}

interface PdfPageData {
  pageNumber: number
  imageFile: File
  preview: string
  ocrText?: string
  ocrConfidence?: number
}

interface OCRResult {
  text: string
  confidence: number
  words: Array<{
    text: string
    bbox: { x0: number, y0: number, x1: number, y1: number }
    confidence: number
  }>
}

interface Emits {
  (e: 'imageUploaded', file: File, isPdf?: boolean, pdfPages?: PdfPageData[]): void
  (e: 'imageCaptured', data: { file: File, preview: string }): void
  (e: 'retake'): void
  (e: 'continue'): void
  (e: 'cameraReady'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// Camera refs
const videoElement = ref<HTMLVideoElement | null>(null)
const canvasElement = ref<HTMLCanvasElement | null>(null)
const cameraStream = ref<MediaStream | null>(null)

// Dropzone refs and state
const fileInput = ref<HTMLInputElement | null>(null)
const isDragOver = ref(false)
const hasError = ref(false)
const errorMessage = ref('')
const isUploading = ref(false)
const uploadProgress = ref(0)

// File validation
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'application/pdf']

const startCamera = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' } // Use back camera if available
    })
    cameraStream.value = stream
    emit('cameraReady')

    // Wait for next tick to ensure video element exists
    await new Promise(resolve => setTimeout(resolve, 100))

    if (videoElement.value) {
      videoElement.value.srcObject = stream
      videoElement.value.play()
    }
  } catch (error) {
    console.error('Error accessing camera:', error)
    alert('Unable to access camera. Please check permissions.')
  }
}

const stopCamera = () => {
  if (cameraStream.value) {
    cameraStream.value.getTracks().forEach(track => track.stop())
    cameraStream.value = null
  }
}

const captureImage = () => {
  if (videoElement.value && canvasElement.value) {
    const canvas = canvasElement.value
    const video = videoElement.value
    const context = canvas.getContext('2d')

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    if (context) {
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `captured_${Date.now()}.jpg`, { type: 'image/jpeg' })
          const preview = canvas.toDataURL('image/jpeg')
          emit('imageCaptured', { file, preview })
          stopCamera()
        }
      }, 'image/jpeg', 0.8)
    }
  }
}

// File validation
const validateFile = (file: File): boolean => {
  clearError()

  if (!ALLOWED_TYPES.includes(file.type)) {
    setError('Please select a valid file (JPG, PNG, GIF, PDF)')
    return false
  }

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

// OCR processing function
const performOCROnImage = async (imageFile: File): Promise<OCRResult> => {
  try {
    console.log('🔍 Starting OCR processing:', {
      fileName: imageFile.name,
      fileSize: `${(imageFile.size / 1024).toFixed(2)} KB`,
      fileType: imageFile.type
    })

    const prepared = await prepareImageSourceForOcr(imageFile)
    if (prepared === null) {
      console.warn('⚠️ OCR skipped: image could not be prepared for recognition')
      return { text: '', confidence: 0, words: [] }
    }

    const worker = await createWorker('eng')

    console.log('⚙️ OCR Worker initialized')

    const { data } = await worker.recognize(prepared)

    console.log('✅ OCR Processing Complete:', {
      textLength: data.text.length,
      confidence: data.confidence,
      wordsCount: (data as any).words?.length || 0,
      extractedText: data.text.substring(0, 200) + (data.text.length > 200 ? '...' : '')
    })

    await worker.terminate()

    return {
      text: data.text,
      confidence: data.confidence,
      words: ((data as any).words || []).map((word: any) => ({
        text: word.text,
        bbox: word.bbox,
        confidence: word.confidence
      }))
    }
  } catch (error) {
    console.error('❌ OCR Error:', error)
    throw error
  }
}

// PDF to individual page images conversion using pdfjs-dist with OCR
const convertPdfToImages = async (file: File): Promise<PdfPageData[]> => {
  try {
    console.log('🔍 PDF Extraction Started:', {
      fileName: file.name,
      fileSize: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
      fileType: file.type
    })

    const arrayBuffer = await file.arrayBuffer()

    // Load PDF using pdfjs-dist for proper rendering
    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise
    const numPages = pdf.numPages

    if (numPages === 0) {
      throw new Error('PDF has no pages')
    }

    console.log('📄 PDF Document Loaded:', {
      totalPages: numPages,
      pdfInfo: pdf._pdfInfo
    })

    const pdfPages: PdfPageData[] = []
    const originalName = file.name.replace(/\.pdf$/i, '')

    // Process each page
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      console.log(`📑 Processing PDF Page ${pageNum}/${numPages}`)

      const page = await pdf.getPage(pageNum)
      const viewport = page.getViewport({ scale: 2.0 }) // High resolution for OCR

      // Create canvas for rendering
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')!
      canvas.width = viewport.width
      canvas.height = viewport.height

      // Render PDF page to canvas
      const renderContext = {
        canvasContext: context,
        viewport: viewport,
        canvas: canvas
      }

      console.log(`🖼️ Rendering PDF Page ${pageNum} to canvas:`, {
        width: viewport.width,
        height: viewport.height,
        scale: 2.0
      })

      await page.render(renderContext).promise

      // Convert canvas to blob and create File
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob)
          else reject(new Error(`Failed to create page ${pageNum} image`))
        }, 'image/jpeg', 0.9)
      })

      const pageFile = new File([blob], `${originalName}_page${pageNum}.jpg`, {
        type: 'image/jpeg'
      })

      const preview = canvas.toDataURL('image/jpeg', 0.8)

      console.log(`📄 Page ${pageNum} rendered successfully:`, {
        fileSize: `${(pageFile.size / 1024).toFixed(2)} KB`,
        dimensions: `${canvas.width}x${canvas.height}`
      })

      // Perform OCR on the rendered page
      console.log(`🔍 Starting OCR on Page ${pageNum}...`)
      const ocrResult = await performOCROnImage(pageFile)

      console.log(`✅ Page ${pageNum} OCR Complete:`, {
        textLength: ocrResult.text.length,
        confidence: ocrResult.confidence.toFixed(2),
        previewText: ocrResult.text.substring(0, 150) + (ocrResult.text.length > 150 ? '...' : '')
      })

      // Create page data with OCR results
      const pageData: PdfPageData = {
        pageNumber: pageNum,
        imageFile: pageFile,
        preview: preview,
        ocrText: ocrResult.text,
        ocrConfidence: ocrResult.confidence
      }

      pdfPages.push(pageData)

      console.log(`📄 Page ${pageNum} Processing Complete:`, {
        pageNumber: pageNum,
        fileName: pageFile.name,
        fileSize: `${(pageFile.size / 1024).toFixed(2)} KB`,
        canvasSize: `${canvas.width}x${canvas.height}`,
        ocrTextLength: ocrResult.text.length,
        ocrConfidence: `${ocrResult.confidence.toFixed(2)}%`,
        extractedTextPreview: ocrResult.text.substring(0, 200) + (ocrResult.text.length > 200 ? '...' : '')
      })
    }

    console.log('✅ PDF Extraction & OCR Complete:', {
      totalPagesProcessed: pdfPages.length,
      totalSize: `${(pdfPages.reduce((sum, p) => sum + p.imageFile.size, 0) / 1024).toFixed(2)} KB`,
      averageOCRConfidence: `${(pdfPages.reduce((sum, p) => sum + (p.ocrConfidence || 0), 0) / pdfPages.length).toFixed(2)}%`,
      totalTextExtracted: pdfPages.reduce((sum, p) => sum + (p.ocrText?.length || 0), 0),
      pageDetails: pdfPages.map(p => ({
        page: p.pageNumber,
        fileName: p.imageFile.name,
        size: `${(p.imageFile.size / 1024).toFixed(2)} KB`,
        ocrConfidence: `${(p.ocrConfidence || 0).toFixed(2)}%`,
        textLength: p.ocrText?.length || 0
      }))
    })

    return pdfPages
  } catch (error) {
    console.error('PDF conversion error:', error)
    throw new Error('Failed to process PDF file. Please ensure the PDF is not corrupted.')
  }
}

// Create a preview image for PDF (thumbnail of first page)
const createPdfPreviewImage = async (file: File): Promise<File> => {
  try {
    const pages = await convertPdfToImages(file)
    return pages[0]?.imageFile || file
  } catch (error) {
    console.error('Error creating PDF preview:', error)
    throw error
  }
}// Dropzone event handlers
const onDragEnter = (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = true
}

const onDragLeave = (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()

  // Only set dragOver to false if we're leaving the dropzone entirely
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
  if (validateFile(file)) {
    isUploading.value = true
    uploadProgress.value = 0

    try {
      let processedFile = file

      let pdfPages: PdfPageData[] = []

      // Check if file is PDF and convert to individual page images
      if (file.type === 'application/pdf') {
        console.log('🚀 Starting PDF Processing Pipeline...', { fileName: file.name })
        uploadProgress.value = 20
        pdfPages = await convertPdfToImages(file)
        console.log('📋 PDF Pages Data Ready for AI:', {
          pageCount: pdfPages.length,
          pages: pdfPages.map(p => `Page ${p.pageNumber}: ${p.imageFile.name}`)
        })
        uploadProgress.value = 60
        processedFile = await createPdfPreviewImage(file)
        uploadProgress.value = 80
      }

      // Simulate remaining upload progress
      const interval = setInterval(() => {
        uploadProgress.value += 5
        if (uploadProgress.value >= 100) {
          clearInterval(interval)
          isUploading.value = false
          // Pass the original file if it's a PDF, and indicate it's a PDF with page data
          const isPdf = file.type === 'application/pdf'
          emit('imageUploaded', isPdf ? file : processedFile, isPdf, isPdf ? pdfPages : undefined)
        }
      }, 50)
    } catch (error) {
      isUploading.value = false
      uploadProgress.value = 0
      setError('Failed to process PDF file. Please try again or use an image file.')
      console.error('File processing error:', error)
    }
  }
}

// Legacy function for compatibility (if still used elsewhere)
const handleImageUpload = (event: Event) => {
  handleFileSelect(event)
}

// Watch for camera mode activation
watch(() => props.imageSource, (newSource) => {
  if (newSource === 'camera' && props.showCamera) {
    startCamera()
  }
})

onMounted(() => {
  if (props.imageSource === 'camera' && props.showCamera) {
    startCamera()
  }
})

onUnmounted(() => {
  stopCamera()
})
</script>

<style scoped>
.camera-container {
  position: relative;
  width: 100%;
  max-width: 500px;
  margin: 0 auto;
}

.camera-video {
  width: 100%;
  height: auto;
  border-radius: 8px;
}

/* Dropzone Styles */
.dropzone {
  border: 3px dashed rgb(var(--v-theme-outline));
  border-radius: 16px;
  padding: 48px 24px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  background: linear-gradient(145deg, rgb(var(--v-theme-surface)), rgb(var(--v-theme-surface-variant)));
  min-height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.dropzone::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: radial-gradient(circle at center, rgba(var(--v-theme-primary), 0.1) 0%, transparent 70%);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.dropzone:hover {
  border-color: rgb(var(--v-theme-primary));
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(var(--v-theme-primary), 0.15);
}

.dropzone:hover::before {
  opacity: 1;
}

.dropzone.dragover {
  border-color: rgb(var(--v-theme-primary));
  border-style: solid;
  background: linear-gradient(145deg, rgba(var(--v-theme-primary), 0.05), rgba(var(--v-theme-primary), 0.1));
  transform: translateY(-4px) scale(1.02);
  box-shadow: 0 12px 30px rgba(var(--v-theme-primary), 0.2);
}

.dropzone.dragover::before {
  opacity: 1;
}

.dropzone.error {
  border-color: rgb(var(--v-theme-error));
  background: linear-gradient(145deg, rgba(var(--v-theme-error), 0.05), rgba(var(--v-theme-error), 0.1));
  animation: shake 0.5s ease-in-out;
}

.dropzone-content {
  width: 100%;
  position: relative;
  z-index: 1;
}

.upload-icon-container {
  margin-bottom: 16px;
}

.upload-icon {
  transition: all 0.3s ease;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
}

.dropzone:hover .upload-icon {
  transform: scale(1.1);
}

.dropzone.dragover .upload-icon {
  transform: scale(1.2) rotate(5deg);
  color: rgb(var(--v-theme-primary)) !important;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-5px); }
  75% { transform: translateX(5px); }
}

.text-primary {
  color: #1976d2 !important;
}

.text-error {
  color: #d32f2f !important;
}

/* Upload progress animation */
.v-progress-linear {
  border-radius: 3px;
}

/* Responsive design */
@media (max-width: 600px) {
  .dropzone {
    padding: 32px 16px;
    min-height: 220px;
  }

  .upload-icon {
    font-size: 56px !important;
  }

  .text-h5 {
    font-size: 1.25rem !important;
  }

  .text-body-1 {
    font-size: 0.95rem !important;
  }
}
</style>

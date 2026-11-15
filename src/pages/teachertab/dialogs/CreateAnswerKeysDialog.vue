<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useAnswerKeysStore } from '@/stores/answerKeysData'
import { useImageProcessor } from '@/pages/teachertab/composables/processImage'
import { useToast } from 'vue-toastification'
import { createGroqAIService } from '@/lib/aiBase'
import ImageSourceSelection from '../dialogs/answerkey/ImageSourceSelection.vue'
import ImageCaptureUpload from '../dialogs/answerkey/ImageCaptureUpload.vue'
import AnswerKeyForm from '../dialogs/answerkey/AnswerKeyForm.vue'

interface Props {
  modelValue: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const answerKeysStore = useAnswerKeysStore()
const toast = useToast()

// Initialize image processor
const {
  processImage,
  isProcessing: isImageProcessing,
  progress: imageProgress,
  currentStatus: imageStatus,
  streamingContent: imageStreamingContent,
  cleanup: cleanupImageProcessor
} = useImageProcessor()

// Additional status for submission process
const submissionStatus = ref('')// Step management
const currentStep = ref(1)
const totalSteps = 3

// Image source selection
const imageSource = ref<'upload' | 'camera' | null>(null)

// Form data
const formData = ref({
  title: '',
  description: '',
  is_active: true,
  release_feedback: false,
  access_code: '',
  answer_images: null as string | null,
  answer_keys: null as any // JSONB field for processed answer key data
})

// Image processing state
const imageResult = ref<any>(null)
const processingStep = ref<'uploading' | 'ai' | 'saving' | 'complete' | null>(null)

// Form validation
const titleRules = [
  (v: string) => !!v || 'Title is required',
  (v: string) => (v && v.length <= 100) || 'Title must be less than 100 characters'
]

// File handling
const imageFile = ref<File | null>(null)
const imagePreview = ref<string | null>(null)
const isPdfFile = ref(false)
const pdfPages = ref<Array<{pageNumber: number, imageFile: File, preview: string}>>([])

interface PdfPageData {
  pageNumber: number
  imageFile: File
  preview: string
  ocrText?: string
  ocrConfidence?: number
}

// Camera related
const showCamera = ref(false)

// Computed
const isOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

const loading = computed(() => answerKeysStore.loading || isImageProcessing.value)

// Functions
const nextStep = () => {
  if (currentStep.value < totalSteps) {
    currentStep.value++
  }
}

const prevStep = () => {
  if (currentStep.value > 1) {
    currentStep.value--
  }
}

const selectImageSource = (source: 'upload' | 'camera') => {
  imageSource.value = source
  if (source === 'camera') {
    showCamera.value = true
  }
  nextStep()
}

const retakePhoto = () => {
  imageFile.value = null
  imagePreview.value = null
  isPdfFile.value = false
  pdfPages.value = []
  currentStep.value = 1
  imageSource.value = null
  showCamera.value = false
}

const handleImageUploaded = (file: File, isPdf: boolean = false, pdfPagesData?: PdfPageData[]) => {
  imageFile.value = file
  isPdfFile.value = isPdf

  if (isPdf && pdfPagesData) {
    console.log('📥 PDF Data Received in Dialog:', {
      fileName: file.name,
      isPdf,
      pageCount: pdfPagesData.length,
      pagesData: pdfPagesData.map(p => ({
        pageNumber: p.pageNumber,
        fileName: p.imageFile.name,
        fileSize: `${(p.imageFile.size / 1024).toFixed(2)} KB`,
        hasPreview: !!p.preview
      }))
    })

    // Store PDF pages for AI processing
    pdfPages.value = pdfPagesData
    // Use the first page preview as the main preview
    imagePreview.value = pdfPagesData[0]?.preview || createPdfPreview(file)
    nextStep()
  } else if (isPdf) {
    // Fallback for PDF without pages data
    imagePreview.value = createPdfPreview(file)
    nextStep()
  } else {
    // For regular images, create preview as usual
    const reader = new FileReader()
    reader.onload = (e) => {
      imagePreview.value = e.target?.result as string
      nextStep()
    }
    reader.readAsDataURL(file)
  }
}// Create a custom preview for PDF files
const createPdfPreview = (file: File): string => {
  // Return a data URL for a custom PDF icon/preview
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  canvas.width = 200
  canvas.height = 250

  // Draw PDF icon
  ctx.fillStyle = '#f5f5f5'
  ctx.fillRect(0, 0, 200, 250)

  ctx.fillStyle = '#e74c3c'
  ctx.fillRect(50, 50, 100, 120)

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 20px Arial'
  ctx.textAlign = 'center'
  ctx.fillText('PDF', 100, 120)

  ctx.fillStyle = '#333333'
  ctx.font = '12px Arial'
  ctx.fillText(file.name, 100, 200)
  ctx.fillText(`${(file.size / 1024 / 1024).toFixed(1)} MB`, 100, 220)

  return canvas.toDataURL('image/png')
}

// Process PDF pages with AI
const processPdfPagesWithAI = async (pages: PdfPageData[]) => {
  try {
    console.log('🤖 Starting AI Processing for PDF Pages:', {
      totalPages: pages.length,
      pages: pages.map(p => ({
        pageNumber: p.pageNumber,
        fileName: p.imageFile.name,
        fileSize: `${(p.imageFile.size / 1024).toFixed(2)} KB`
      }))
    })

    const aiService = createGroqAIService()
    console.log('🔧 AI Service Initialized:', { service: 'GroqAIService' })

    const allQuestions: any[] = []
    let totalQuestions = 0
    let combinedMetadata = {
      subject: 'Unknown',
      difficulty: 'Unknown',
      instructions: '',
      total_questions: 0
    }

    submissionStatus.value = `Processing ${pages.length} PDF pages with AI...`

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]

      // Update progress
      const progress = ((i + 1) / pages.length) * 80 // 80% for processing, 20% for saving
      submissionStatus.value = `Processing page ${i + 1} of ${pages.length}...`

      try {
        console.log(`🔄 Processing Page ${i + 1}:`, {
          pageNumber: page.pageNumber,
          fileName: page.imageFile.name,
          fileSize: `${(page.imageFile.size / 1024).toFixed(2)} KB`
        })

        // Convert file to base64
        const base64 = await fileToBase64(page.imageFile)
        console.log(`📝 Base64 Conversion Complete for Page ${i + 1}:`, {
          base64Length: base64.length,
          base64Preview: base64.substring(0, 100) + '...'
        })

        // Process with AI using OCR text + vision
        console.log(`🧠 Sending Page ${i + 1} to AI Service with OCR data...`, {
          hasOCRText: !!(page.ocrText && page.ocrText.length > 0),
          ocrTextLength: page.ocrText?.length || 0,
          ocrConfidence: page.ocrConfidence || 0,
          ocrTextPreview: page.ocrText?.substring(0, 200) + (page.ocrText && page.ocrText.length > 200 ? '...' : '') || 'No OCR text'
        })

        // Choose processing method based on OCR quality and availability
        let result;
        const ocrConfidence = page.ocrConfidence || 0;
        const hasOCRText = page.ocrText && page.ocrText.length > 0;

        // Clean OCR text to remove headers, footers, and page artifacts
        let cleanedOCRText = page.ocrText || '';
        if (hasOCRText) {
          // Remove common page artifacts and repeated elements
          cleanedOCRText = cleanedOCRText
            .replace(/page\s+\d+\s+of\s+\d+/gi, '') // Remove "Page X of Y"
            .replace(/^.*?answer\s+key.*?$/gim, '') // Remove "Answer Key" headers
            .replace(/^.*?name:.*?$/gim, '') // Remove "Name:" fields
            .replace(/^.*?date:.*?$/gim, '') // Remove "Date:" fields  
            .replace(/^.*?class:.*?$/gim, '') // Remove "Class:" fields
            .replace(/^\s*\d+\s*$|^\s*[A-Z]\s*$/gim, '') // Remove isolated numbers/letters
            .replace(/\n\s*\n\s*\n/g, '\n\n') // Clean multiple newlines
            .trim()

          // Skip pages with minimal content (likely headers/footers only)
          if (cleanedOCRText.length < 50) {
            console.log(`⏭️ Skipping page ${i + 1} - minimal content after cleaning (${cleanedOCRText.length} chars)`)
            continue
          }
        }

        // Provide context about previously extracted questions to avoid duplicates
        const previousAnswers = allQuestions.map(q => q.correct_answer).join(', ')
        const contextPrompt = allQuestions.length > 0 
          ? `Previously extracted answers from other pages: [${previousAnswers}]. Only extract NEW questions not already found.`
          : ''

        if (hasOCRText && ocrConfidence > 85) {
          // High confidence OCR - use text-only processing for better accuracy
          console.log(`📝 Using text-only processing (OCR confidence: ${ocrConfidence.toFixed(2)}%)`)
          result = await aiService.processTextOnly(cleanedOCRText + '\n\n' + contextPrompt)
        } else if (hasOCRText) {
          // Medium confidence OCR - use vision + OCR combination
          console.log(`👁️📝 Using vision + OCR processing (OCR confidence: ${ocrConfidence.toFixed(2)}%)`)
          result = await aiService.processWithVision(cleanedOCRText + '\n\n' + contextPrompt, base64)
        } else {
          // No OCR or low quality - fallback to vision only
          console.log(`👁️ Using vision-only processing (no OCR data available)`)
          result = await aiService.processImageOnly(base64)
        }

        // Log comprehensive AI analysis results
        console.log(`✅ AI Processing Complete for Page ${i + 1}:`, {
          processedWithOCR: !!(page.ocrText && page.ocrText.length > 0),
          questionsFound: result.questions?.length || 0,
          metadata: result.metadata,
          textContent: result.questions?.map(q => q.question_text).join('\n'),
          answerContent: result.questions?.map(q => `${q.question_number}: ${q.correct_answer}`).join(', '),
          ocrDataUsed: {
            textLength: page.ocrText?.length || 0,
            confidence: page.ocrConfidence || 0,
            textSample: page.ocrText?.substring(0, 150) || 'No OCR text available'
          },
          fullResult: result
        })

        // Log detailed content analysis
        console.log(`📄 PDF Page ${i + 1} Content Analysis:`, {
          pageNumber: i + 1,
          fileName: page.imageFile.name,
          rawAIResponse: result,
          detectedQuestions: result.questions?.map(q => ({
            questionNumber: q.question_number,
            questionText: q.question_text || 'No text detected',
            questionTextLength: (q.question_text || '').length,
            correctAnswer: q.correct_answer,
            answerType: q.answer_type,
            options: q.options || [],
            points: q.points || 1
          })) || [],
          detectedMetadata: {
            subject: result.metadata?.subject || 'Unknown',
            difficulty: result.metadata?.difficulty || 'Unknown',
            instructions: result.metadata?.instructions || 'None detected',
            totalQuestions: result.metadata?.total_questions || 0
          },
          contentSummary: {
            hasQuestions: (result.questions?.length || 0) > 0,
            hasMultipleChoice: result.questions?.some(q => q.answer_type === 'multiple_choice') || false,
            hasTrueFalse: result.questions?.some(q => q.answer_type === 'true_false') || false,
            hasFillBlank: result.questions?.some(q => q.answer_type === 'fill_blank') || false,
            hasEssay: result.questions?.some(q => q.answer_type === 'essay') || false,
            hasMatching: result.questions?.some(q => q.answer_type === 'matching') || false
          }
        })

        if (result.questions && result.questions.length > 0) {
          // Filter out duplicate questions based on question text similarity and answer matching
          const newQuestions = result.questions.filter(newQ => {
            // Check if this question already exists in allQuestions
            const isDuplicate = allQuestions.some(existingQ => {
              // Compare answers (most reliable indicator)
              const sameAnswer = existingQ.correct_answer?.toLowerCase().trim() === newQ.correct_answer?.toLowerCase().trim()
              
              // Compare question text if available (fuzzy matching)
              let similarText = false
              if (existingQ.question_text && newQ.question_text) {
                const existingText = existingQ.question_text.toLowerCase().replace(/\s+/g, ' ').trim()
                const newText = newQ.question_text.toLowerCase().replace(/\s+/g, ' ').trim()
                // Check for exact match or significant overlap (>80% similarity)
                similarText = existingText === newText || 
                             (existingText.includes(newText) && newText.length > existingText.length * 0.8) ||
                             (newText.includes(existingText) && existingText.length > newText.length * 0.8)
              }
              
              // Question is duplicate if same answer AND (same question text OR similar question numbers)
              const sameQuestionNumber = Math.abs(existingQ.question_number - newQ.question_number) <= 1
              
              return sameAnswer && (similarText || (!existingQ.question_text && !newQ.question_text && sameQuestionNumber))
            })
            
            return !isDuplicate
          })

          // Adjust question numbers to be sequential across pages for non-duplicate questions
          const adjustedQuestions = newQuestions.map(q => ({
            ...q,
            question_number: q.question_number + totalQuestions
          }))

          console.log(`📊 Questions Processed for Page ${i + 1}:`, {
            originalQuestions: result.questions.length,
            duplicatesFiltered: result.questions.length - newQuestions.length,
            uniqueQuestions: newQuestions.length,
            adjustedQuestions: adjustedQuestions.map(q => ({
              questionNumber: q.question_number,
              questionText: q.question_text || 'No text detected',
              correctAnswer: q.correct_answer,
              answerType: q.answer_type,
              options: q.options,
              points: q.points
            })),
            runningTotal: totalQuestions + newQuestions.length,
            rawPageData: {
              detectedText: result.questions.map(q => q.question_text).filter(Boolean),
              answerPatterns: result.questions.map(q => `Q${q.question_number}: ${q.correct_answer} (${q.answer_type})`),
              contentTypes: [...new Set(result.questions.map(q => q.answer_type))]
            }
          })

          if (adjustedQuestions.length > 0) {
            allQuestions.push(...adjustedQuestions)
            totalQuestions += adjustedQuestions.length
          }
        }

        // Use metadata from first page or update if more specific
        if (i === 0 || (result.metadata?.subject && result.metadata.subject !== 'Unknown')) {
          combinedMetadata = {
            ...combinedMetadata,
            ...result.metadata,
            total_questions: totalQuestions
          }
        }

      } catch (pageError) {
        console.error(`❌ Error processing page ${i + 1}:`, {
          pageNumber: page.pageNumber,
          fileName: page.imageFile.name,
          error: pageError
        })
        // Continue processing other pages
      }
    }

    // Combine results
    const combinedResult = {
      answerKeyData: {
        questions: allQuestions,
        metadata: {
          ...combinedMetadata,
          total_questions: totalQuestions
        }
      },
      processingTime: 0 // We'll set this as needed
    }

    console.log('🎉 PDF AI Processing Complete - Final Results:', {
      totalPagesProcessed: pages.length,
      totalQuestionsExtracted: totalQuestions,
      finalMetadata: combinedResult.answerKeyData.metadata,
      allQuestions: allQuestions.map(q => ({
        questionNumber: q.question_number,
        correctAnswer: q.correct_answer,
        answerType: q.answer_type,
        questionText: q.question_text
      })),
      combinedResult
    })

    return combinedResult  } catch (error) {
    console.error('Error processing PDF pages with AI:', error)
    throw error
  }
}

// Convert File to base64
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    console.log('🔄 Converting file to base64:', {
      fileName: file.name,
      fileSize: `${(file.size / 1024).toFixed(2)} KB`,
      fileType: file.type
    })

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Remove data URL prefix to get just the base64
      const base64 = result.split(',')[1]

      console.log('✅ Base64 conversion complete:', {
        fileName: file.name,
        base64Length: base64.length,
        base64Size: `${(base64.length * 0.75 / 1024).toFixed(2)} KB`, // Approximate size
        base64Preview: base64.substring(0, 50) + '...'
      })

      resolve(base64)
    }
    reader.onerror = (error) => {
      console.error('❌ Base64 conversion failed:', {
        fileName: file.name,
        error
      })
      reject(error)
    }
    reader.readAsDataURL(file)
  })
}

const handleImageCaptured = (data: { file: File, preview: string }) => {
  imageFile.value = data.file
  imagePreview.value = data.preview
  showCamera.value = false
  nextStep()
}// Process image with AI vision
const processImageWithAI = async (file: File) => {
  try {
    processingStep.value = 'ai'

    // Process the image directly with AI vision
    const result = await processImage(file, false)

    // Store the results
    imageResult.value = result
    formData.value.answer_keys = result.answerKeyData

    // Auto-populate title if we found questions
    if (result.answerKeyData?.metadata?.total_questions) {
      const questionCount = result.answerKeyData.metadata.total_questions
      const subject = result.answerKeyData.metadata.subject !== 'Unknown'
        ? ` - ${result.answerKeyData.metadata.subject}`
        : ''
      formData.value.title = `Answer Key${subject} (${questionCount} Questions)`
    }

    // Auto-populate description with metadata
    if (result.answerKeyData?.metadata?.instructions) {
      formData.value.description = result.answerKeyData.metadata.instructions
    }

    processingStep.value = 'complete'

  } catch (error) {
    console.error('Error processing image:', error)
    processingStep.value = null
    // Reset image processing data on error
    imageResult.value = null
    formData.value.answer_keys = null
  }
}

const removeImage = () => {
  imageFile.value = null
  imagePreview.value = null
  formData.value.answer_images = null
}

const resetForm = () => {
  currentStep.value = 1
  imageSource.value = null
  formData.value = {
    title: '',
    description: '',
    is_active: true,
    release_feedback: false,
    access_code: '',
    answer_images: null,
    answer_keys: null
  }
  imageFile.value = null
  imagePreview.value = null
  isPdfFile.value = false
  pdfPages.value = []
  showCamera.value = false
  imageResult.value = null
  processingStep.value = null
  submissionStatus.value = ''
}

const handleSubmit = async () => {
  try {
    let imageUrl = null

    // First, upload the image if provided
    if (imageFile.value) {
      processingStep.value = 'uploading'
      submissionStatus.value = 'Uploading image...'

      const imagePath = `answer_key_${Date.now()}_${imageFile.value.name}`
      const uploadResult = await answerKeysStore.uploadAnswerImage(imageFile.value, imagePath)

      if (uploadResult.imageUrl) {
        imageUrl = uploadResult.imageUrl
      }
    }

    // Process image with AI
    let processedAnswerKeys = null
    if (imageFile.value && !isPdfFile.value) {
      submissionStatus.value = 'Processing image with AI...'
      processingStep.value = 'ai'

      try {
        // Process the image directly with AI vision
        const result = await processImage(imageFile.value, false)

        // Store the results
        imageResult.value = result
        processedAnswerKeys = result.answerKeyData

        // Auto-populate title if we found questions and user hasn't set one
        if (!formData.value.title && result.answerKeyData?.metadata?.total_questions) {
          const questionCount = result.answerKeyData.metadata.total_questions
          const subject = result.answerKeyData.metadata.subject !== 'Unknown'
            ? ` - ${result.answerKeyData.metadata.subject}`
            : ''
          formData.value.title = `Answer Key${subject} (${questionCount} Questions)`
        }

        // Auto-populate description if user hasn't set one
        if (!formData.value.description && result.answerKeyData?.metadata?.instructions) {
          formData.value.description = result.answerKeyData.metadata.instructions
        }

      } catch (aiError) {
        console.warn('AI processing failed, continuing without processed data:', aiError)
        // Continue with manual data entry
      }
    } else if (isPdfFile.value && pdfPages.value.length > 0) {
      // For PDFs, process each page with AI
      console.log('🚀 Starting PDF AI Processing Pipeline:', {
        fileName: imageFile.value?.name,
        totalPages: pdfPages.value.length,
        pagesInfo: pdfPages.value.map(p => ({
          pageNumber: p.pageNumber,
          fileName: p.imageFile.name,
          fileSize: `${(p.imageFile.size / 1024).toFixed(2)} KB`
        }))
      })

      submissionStatus.value = 'Processing PDF pages with AI...'
      processingStep.value = 'ai'

      try {
        const result = await processPdfPagesWithAI(pdfPages.value)

        console.log('💾 Storing PDF AI Results:', {
          questionsExtracted: result.answerKeyData?.questions?.length || 0,
          metadata: result.answerKeyData?.metadata,
          processingComplete: true
        })

        // Store the results
        imageResult.value = result
        processedAnswerKeys = result.answerKeyData

        // Auto-populate title if we found questions and user hasn't set one
        if (!formData.value.title && result.answerKeyData?.metadata?.total_questions) {
          const questionCount = result.answerKeyData.metadata.total_questions
          const subject = result.answerKeyData.metadata.subject !== 'Unknown'
            ? ` - ${result.answerKeyData.metadata.subject}`
            : ''
          formData.value.title = `PDF Answer Key${subject} (${questionCount} Questions)`

          console.log('🏷️ Auto-populated Title from PDF AI Results:', {
            title: formData.value.title,
            questionCount,
            subject
          })
        }

        // Auto-populate description if user hasn't set one
        if (!formData.value.description) {
          const pageCount = pdfPages.value.length
          const questionCount = result.answerKeyData?.metadata?.total_questions || 0
          formData.value.description = `Answer key extracted from ${pageCount} PDF pages with ${questionCount} questions detected`
        }

      } catch (aiError) {
        console.warn('AI processing of PDF failed, continuing without processed data:', aiError)
        // Provide default info for PDFs
        if (!formData.value.title) {
          formData.value.title = `Answer Key - ${imageFile.value?.name.replace('.pdf', '') || 'PDF Document'}`
        }
        if (!formData.value.description) {
          formData.value.description = `Answer key created from ${pdfPages.value.length} PDF pages`
        }
      }
    } else if (isPdfFile.value) {
      // Fallback for PDFs without extracted pages
      submissionStatus.value = 'Processing PDF file...'
      if (!formData.value.title) {
        formData.value.title = `Answer Key - ${imageFile.value?.name.replace('.pdf', '') || 'PDF Document'}`
      }
      if (!formData.value.description) {
        formData.value.description = 'Answer key created from PDF document'
      }
    }

    // Save to database
    processingStep.value = 'saving'
    submissionStatus.value = 'Saving answer key...'

    const answerKeyData = {
      title: formData.value.title,
      description: formData.value.description,
      is_active: formData.value.is_active,
      release_feedback: formData.value.release_feedback,
      access_code: formData.value.access_code.trim() || null,
      answer_images: imageUrl || undefined,
      answer_keys: processedAnswerKeys // Include processed OCR/AI data
    }

    const result = await answerKeysStore.createAnswerKey(answerKeyData)

    if (result.error === null) {
      processingStep.value = 'complete'
      submissionStatus.value = 'Answer key created successfully!'

      // Show success message with AI processing results summary
      if (processedAnswerKeys?.questions?.length) {
        toast.success(`Answer key created with ${processedAnswerKeys.questions.length} questions detected!`)
      }

      resetForm()
      isOpen.value = false
    }
  } catch (error) {
    console.error('Error creating answer key:', error)
    processingStep.value = null
    submissionStatus.value = 'Error occurred during processing'
  }
}

const handleClose = () => {
  resetForm()
  isOpen.value = false
}

// Cleanup on component unmount
onUnmounted(() => {
  cleanupImageProcessor()
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
        <v-icon class="mr-2" color="primary">mdi-plus</v-icon>
        Create Answer Key
        <v-spacer />
        <v-chip size="small" color="primary" variant="outlined">
          Step {{ currentStep }} of {{ totalSteps }}
        </v-chip>
      </v-card-title>

      <v-card-text>
        <!-- Processing Overlay -->
        <v-overlay
          v-model="loading"
          contained
          persistent
          class="d-flex align-center justify-center"
        >
          <v-card class="pa-6" min-width="400">
            <v-card-text class="text-center">
              <v-progress-circular
                :model-value="imageProgress || 50"
                :size="80"
                :width="6"
                color="primary"
                class="mb-4"
                :indeterminate="!imageProgress"
              >
                <span v-if="imageProgress">{{ Math.round(imageProgress) }}%</span>
              </v-progress-circular>

              <h3 class="text-h6 mb-2">Processing Answer Key</h3>
              <p class="text-body-2 text-medium-emphasis">{{ submissionStatus || imageStatus }}</p>

              <div class="mt-4">
                <v-chip
                  v-if="processingStep === 'uploading'"
                  size="small"
                  color="orange"
                  prepend-icon="mdi-upload"
                >
                  Uploading Image
                </v-chip>
                <v-chip
                  v-else-if="processingStep === 'ai'"
                  size="small"
                  color="success"
                  prepend-icon="mdi-brain"
                >
                  {{ isPdfFile ? 'Processing PDF' : 'AI Vision Analysis' }}
                </v-chip>
                <v-chip
                  v-else-if="processingStep === 'saving'"
                  size="small"
                  color="primary"
                  prepend-icon="mdi-content-save"
                >
                  Saving Answer Key
                </v-chip>
              </div>

              <!-- AI Streaming Content Preview -->
              <div v-if="imageStreamingContent && processingStep === 'ai' && !isPdfFile" class="mt-4">
                <v-card variant="outlined" class="pa-3">
                  <div class="text-caption text-medium-emphasis mb-2">
                    <v-icon size="small" class="me-1">mdi-lightning-bolt</v-icon>
                    Live AI Processing...
                  </div>
                  <div class="text-body-2" style="max-height: 200px; overflow-y: auto;">
                    <pre class="text-wrap">{{ imageStreamingContent }}</pre>
                  </div>
                </v-card>
              </div>
            </v-card-text>
          </v-card>
        </v-overlay>

        <!-- Step 1: Choose Image Source -->
        <ImageSourceSelection
          v-if="currentStep === 1"
          :selected-source="imageSource"
          @select="selectImageSource"
        />

        <!-- Step 2: Image Capture/Upload -->
        <ImageCaptureUpload
          v-if="currentStep === 2"
          :image-source="imageSource"
          :image-preview="imagePreview"
          :show-camera="showCamera"
          @image-uploaded="handleImageUploaded"
          @image-captured="handleImageCaptured"
          @retake="retakePhoto"
          @continue="nextStep"
          @camera-ready="showCamera = true"
        />

        <!-- Step 3: Form Details -->
        <AnswerKeyForm
          v-if="currentStep === 3"
          v-model:form-data="formData"
          :image-preview="imagePreview"
          :image-file-name="imageFile?.name || null"
          :image-result="imageResult"
          :is-pdf-file="isPdfFile"
          :pdf-pages-count="pdfPages.length"
          @edit-image="retakePhoto"
          @submit="handleSubmit"
        />
      </v-card-text>

      <v-card-actions>
        <v-btn
          v-if="currentStep > 1"
          variant="outlined"
          @click="prevStep"
          prepend-icon="mdi-arrow-left"
        >
          Back
        </v-btn>

        <v-spacer />

        <v-btn
          variant="outlined"
          @click="handleClose"
          :disabled="loading"
        >
          Cancel
        </v-btn>

        <v-btn
          v-if="currentStep === 3"
          color="primary"
          @click="handleSubmit"
          :loading="loading || !!processingStep"
          :disabled="!formData.title || loading || !!processingStep"
        >
          {{ imageFile && !isPdfFile ? 'Process with AI & Create Answer Key' : 'Create Answer Key' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* Minimal styles needed for the main dialog */
</style>

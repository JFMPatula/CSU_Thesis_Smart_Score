import { ref } from 'vue'
import { createGroqAIService, type GroqAIService } from '@/lib/aiBase'
import { useToast } from 'vue-toastification'

interface ProcessedAnswerResult {
  extractedAnswers: any
  confidence: number
  processingTime: number
}

interface ExtractedAnswer {
  questionNumber: number
  selectedAnswer: string
  confidence: number
  alternatives?: string[]
}

/**
 * Composable for processing student answer images with Groq AI vision model
 */
export function useAnswerProcessor() {
  const toast = useToast()

  // State
  const isProcessing = ref(false)
  const progress = ref(0)
  const currentStatus = ref('')
  const streamingContent = ref('')

  // Services
  let groqService: GroqAIService | null = null

  /**
   * Initialize AI service
   */
  const initializeServices = async (): Promise<void> => {
    try {
      currentStatus.value = 'Initializing AI service...'
      progress.value = 10

      if (!groqService) {
        groqService = createGroqAIService()
      }
    } catch (error) {
      console.error('Error initializing AI service:', error)
      toast.error('Failed to initialize AI service')
      throw error
    }
  }

  /**
   * Convert file to base64 string
   */
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        // Remove data:image/...;base64, prefix
        const base64 = result.split(',')[1]
        resolve(base64)
      }
      reader.onerror = () => reject(new Error('Failed to convert file to base64'))
      reader.readAsDataURL(file)
    })
  }



  /**
   * Process answer sheet image with Groq AI vision
   */
  const processAnswerSheet = async (
    file: File | Blob,
    answerKeyData?: any,
    useStreaming = false
  ): Promise<ProcessedAnswerResult> => {
    const startTime = Date.now()

    try {
      isProcessing.value = true
      progress.value = 0
      streamingContent.value = ''

      // Convert Blob to File if necessary
      let processFile: File
      if (file instanceof Blob && !(file instanceof File)) {
        processFile = new File([file], 'answer-sheet.jpg', { type: 'image/jpeg' })
      } else {
        processFile = file as File
      }

      // Initialize services
      await initializeServices()

      // Convert image to base64 for AI processing
      currentStatus.value = 'Preparing image for AI analysis...'
      progress.value = 30

      const imageBase64 = await fileToBase64(processFile)

      // Create AI prompt for answer extraction
      const extractionPrompt = createAnswerExtractionPrompt(answerKeyData)

      // Process with AI (OCR + free text model)
      currentStatus.value = 'Analyzing answer sheet with AI...'
      progress.value = 60

      let extractedAnswers
      try {
        extractedAnswers = await groqService!.processStudentAnswerSheet(imageBase64, extractionPrompt)

        // Log the extracted answers result
        console.log('✅ Groq AI Vision Processing Result:', {
          extractedAnswers,
          type: typeof extractedAnswers,
          length: Array.isArray(extractedAnswers) ? extractedAnswers.length : 'Not an array'
        })
      } catch (visionError) {
        console.error('Vision model failed:', visionError)
        toast.error('AI vision processing failed. Please ensure the image is clear and try again.')
        throw new Error('AI vision processing failed')
      }

      progress.value = 100
      currentStatus.value = 'Answer extraction completed successfully!'

      const processingTime = Date.now() - startTime

      toast.success(`Answer sheet processed successfully!`)

      const finalResult = {
        extractedAnswers,
        confidence: 0.85, // Default confidence for vision processing
        processingTime
      }

      // Log the final result being returned
      console.log('🎯 Final ProcessAnswer Result:', finalResult)

      return finalResult

    } catch (error: any) {
      console.error('Answer processing error:', error)
      toast.error(`Failed to process answer sheet: ${error.message}`)
      throw error
    } finally {
      isProcessing.value = false
      progress.value = 0
      currentStatus.value = ''
      streamingContent.value = ''
    }
  }

  /**
   * Create AI prompt for answer extraction from image
   */
  const createAnswerExtractionPrompt = (answerKeyData?: any): string => {
    let prompt = `
You are an expert at extracting student written answers from answer sheet images. Your task is to analyze the provided image and extract the student's text-based answers (full words, phrases, or short answers) in a structured format.

Please carefully examine the image and extract the student's written answers (not multiple choice letters), returning them in the following JSON format:
{
  "answers": [
    {
      "questionNumber": 1,
      "selectedAnswer": "photosynthesis",
      "confidence": 0.95,
      "alternatives": ["photosynth"] // if there are alternative spellings or unclear text
    }
  ],
  "metadata": {
    "totalQuestions": 10,
    "processedQuestions": 8,
    "studentName": "extracted name if visible",
    "studentId": "extracted ID if visible"
  }
}

Instructions:
1. Carefully look at the image for numbered questions and their corresponding written answers
2. Extract full word answers, not just multiple choice letters (A, B, C, D)
3. Look for written text answers, whether handwritten or typed
4. If text is unclear or has multiple possible interpretations, include alternatives
5. Set confidence based on text clarity (high for clear text, low for unclear/illegible text)
6. Extract any visible student information (name, ID number, date, etc.)
7. Handle various answer formats (short answers, single words, phrases, numbers, etc.)
8. If text is partially legible, provide the best interpretation with lower confidence
9. Pay attention to the sequence of question numbers
10. Look for any corrections, cross-outs, or erasures that might indicate the final intended answer
11. For illegible text, try to provide the closest reasonable interpretation
12. Use OCR-like analysis to extract handwritten or printed text accurately
13. Focus on actual words, phrases, numbers, or short text responses
14. Ignore multiple choice bubbles (A, B, C, D) unless they are part of written text
15. Return only valid JSON format without any additional text or explanation
`

    if (answerKeyData?.questions) {
      prompt += `

Reference Answer Key (for context on expected format):
${JSON.stringify(answerKeyData.questions, null, 2)}

Use this to understand the expected number of questions and answer format, but extract what you actually see in the image.
`
    }

    return prompt
  }

  /**
   * Validate extracted answers
   */
  const validateExtractedAnswers = (
    answers: ExtractedAnswer[],
    expectedQuestions?: number
  ): { isValid: boolean; issues: string[] } => {
    const issues: string[] = []
    let isValid = true

    // Check if any answers were found
    if (!answers || answers.length === 0) {
      issues.push('No answers were detected in the image.')
      isValid = false
      return { isValid, issues }
    }

    // Check for expected number of questions
    if (expectedQuestions && answers.length < expectedQuestions * 0.5) {
      issues.push(`Expected ${expectedQuestions} questions, but only found ${answers.length} answers.`)
      isValid = false
    }

    // Check for low confidence answers
    const lowConfidenceCount = answers.filter(answer => answer.confidence < 0.5).length
    if (lowConfidenceCount > answers.length * 0.3) {
      issues.push(`${lowConfidenceCount} answers have low confidence. Please review manually.`)
    }

    // Check for duplicate question numbers
    const questionNumbers = answers.map(answer => answer.questionNumber)
    const duplicates = questionNumbers.filter((num, index) => questionNumbers.indexOf(num) !== index)
    if (duplicates.length > 0) {
      issues.push(`Duplicate question numbers found: ${duplicates.join(', ')}`)
    }

    // Check for missing sequential questions
    const sortedNumbers = questionNumbers.sort((a, b) => a - b)
    const gaps = []
    for (let i = 1; i < sortedNumbers[sortedNumbers.length - 1]; i++) {
      if (!sortedNumbers.includes(i)) {
        gaps.push(i)
      }
    }
    if (gaps.length > 0) {
      issues.push(`Missing questions: ${gaps.join(', ')}`)
    }

    return { isValid, issues }
  }

  /**
   * Pre-process image for better OCR results on answer sheets
   */
  const preprocessAnswerSheet = async (file: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const img = new Image()

      img.onload = () => {
        try {
          canvas.width = img.width
          canvas.height = img.height

          if (!ctx) {
            reject(new Error('Failed to get canvas context'))
            return
          }

          // Draw image
          ctx.drawImage(img, 0, 0)

          // Get image data
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const data = imageData.data

          // Apply preprocessing for answer sheets
          for (let i = 0; i < data.length; i += 4) {
            // Convert to grayscale first
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]

            // Apply high contrast for better bubble/text detection
            const threshold = 128
            const contrast = gray > threshold ? 255 : 0

            data[i] = contrast     // Red
            data[i + 1] = contrast // Green
            data[i + 2] = contrast // Blue
          }

          // Put processed image data back
          ctx.putImageData(imageData, 0, 0)

          // Convert to blob
          canvas.toBlob((blob) => {
            if (blob) {
              const processedFile = new File([blob], file.name, { type: 'image/jpeg' })
              resolve(processedFile)
            } else {
              reject(new Error('Failed to process answer sheet'))
            }
          }, 'image/jpeg', 0.95)
        } catch (error) {
          reject(error)
        }
      }

      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = URL.createObjectURL(file)
    })
  }

  /**
   * Cleanup resources
   */
  const cleanup = async (): Promise<void> => {
    try {
      // Clear any remaining processing state
      isProcessing.value = false
      progress.value = 0
      currentStatus.value = ''
      streamingContent.value = ''

      // Cleanup AI service if needed
      groqService = null
    } catch (error) {
      console.warn('Error during cleanup:', error)
    }
  }

  return {
    // State
    isProcessing,
    progress,
    currentStatus,
    streamingContent,

    // Methods
    processAnswerSheet,
    validateExtractedAnswers,
    preprocessAnswerSheet,
    cleanup,

    // For manual initialization if needed
    initializeServices
  }
}

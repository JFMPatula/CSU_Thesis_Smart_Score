import { Groq } from 'groq-sdk';

// Free-tier text model on this Groq key. No vision model is free on this
// account, so images are OCR'd locally (Tesseract) then structured to JSON here.
const TEXT_MODEL = 'openai/gpt-oss-120b';

interface AnswerKeyData {
  questions: Array<{
    question_number: number;
    question_text?: string;
    correct_answer: string;
    answer_type: 'multiple_choice' | 'true_false' | 'fill_blank' | 'essay' | 'matching';
    options?: string[];
    points?: number;
  }>;
  metadata?: {
    total_questions: number;
    subject?: string;
    difficulty?: string;
    instructions?: string;
  };
}

/**
 * Groq AI service for OCR-ing images locally and extracting structured answer keys
 * using the free-tier text model.
 */
export class GroqAIService {
  private groq: Groq;

  // Keep responses deterministic and easier to parse.
  private static readonly DEFAULT_TEMPERATURE = 0.1;

  constructor(apiKey: string) {
    this.groq = new Groq({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true // Required for browser usage
    });
  }

  /**
   * Process an image-only upload. OCRs the image locally with Tesseract,
   * then structures the text into answer-key JSON with the free text model.
   * @param imageBase64 - Base64 encoded image
   * @returns Structured answer key data
   */
  async processImageOnly(imageBase64: string): Promise<AnswerKeyData> {
    console.log('🚀 Starting image processing:', {
      imageBase64Length: imageBase64.length,
      imageSize: `~${(imageBase64.length * 0.75 / 1024).toFixed(2)} KB`,
      stage: 'local OCR (Tesseract)'
    });

    const ocrText = await this.extractOcrTextFromBase64(imageBase64);
    if (!ocrText.trim().length) {
      console.warn('⚠️ OCR returned no text; unable to extract an answer key.');
      return {
        questions: [],
        metadata: { total_questions: 0, subject: 'Unknown', difficulty: 'Unknown' }
      };
    }

    return this.processTextOnly(ocrText);
  }

  /**
   * Process OCR text along with the image for context. OCR text is used
   * directly when present; otherwise the image is OCR'd locally first.
   * @param ocrText - Raw text extracted from OCR
   * @param imageBase64 - Base64 encoded image (used when ocrText is empty)
   * @returns Structured answer key data
   */
  async processWithVision(ocrText: string, imageBase64: string): Promise<AnswerKeyData> {
    let text = (ocrText || '').trim();
    if (!text.length && imageBase64) {
      text = (await this.extractOcrTextFromBase64(imageBase64)).trim();
    }
    if (!text.length) {
      console.warn('⚠️ No OCR text available for processing.');
      return {
        questions: [],
        metadata: { total_questions: 0, subject: 'Unknown', difficulty: 'Unknown' }
      };
    }
    return this.processTextOnly(text);
  }

  /**
   * Process a student answer-sheet image. OCRs the image locally, then sends the
   * custom extraction prompt together with the OCR text to the free text model.
   * Returns the raw parsed JSON (preserves the student "answers" schema).
   * @param imageBase64 - Base64 encoded answer-sheet image
   * @param extractionPrompt - Student-specific extraction prompt
   * @returns Raw parsed JSON object
   */
  async processStudentAnswerSheet(imageBase64: string, extractionPrompt: string): Promise<any> {
    console.log('📄 Starting student answer sheet processing:', {
      imageBase64Length: imageBase64.length,
      imageSize: `~${(imageBase64.length * 0.75 / 1024).toFixed(2)} KB`,
      stage: 'local OCR (Tesseract)'
    });

    const ocrText = await this.extractOcrTextFromBase64(imageBase64);
    if (!ocrText.trim().length) {
      console.warn('⚠️ OCR returned no text from the answer sheet.');
      return { answers: [], metadata: { totalQuestions: 0, processedQuestions: 0 } };
    }

    console.log('🔤 Starting Student OCR Analysis:', {
      textLength: ocrText.length,
      model: TEXT_MODEL,
      textPreview: ocrText.substring(0, 300) + (ocrText.length > 300 ? '...' : '')
    });

    try {
      const chatCompletion = await this.groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: this.createJsonOnlySystemPrompt()
          },
          {
            role: 'user',
            content: `${extractionPrompt}\n\n---\nOCR Extracted Text from the image:\n${ocrText}`
          }
        ],
        model: TEXT_MODEL,
        temperature: GroqAIService.DEFAULT_TEMPERATURE,
        max_completion_tokens: 4000,
        top_p: 0.95,
        response_format: {
          type: 'json_object'
        } as any
      });

      const response = chatCompletion.choices[0]?.message?.content || '';
      console.log('🤖 Raw Student OCR Analysis Response:', {
        model: TEXT_MODEL,
        responseLength: response.length,
        rawResponse: response
      });

      return this.parseRawJson(response);
    } catch (error) {
      console.error('Error with student answer processing:', error);
      throw new Error(`Answer processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Process OCR text only (without image) using the free text model
   * @param ocrText - OCR extracted text from PDF/image
   * @returns Structured answer key data
   */
  async processTextOnly(ocrText: string): Promise<AnswerKeyData> {
    const prompt = this.createTextOnlyPrompt(ocrText);

    console.log('🔤 Starting OCR Text Analysis:', {
      textLength: ocrText.length,
      model: TEXT_MODEL,
      promptLength: prompt.length,
      textPreview: ocrText.substring(0, 300) + (ocrText.length > 300 ? '...' : '')
    });

    try {
      const chatCompletion = await this.groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: this.createJsonOnlySystemPrompt()
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        model: TEXT_MODEL,
        temperature: GroqAIService.DEFAULT_TEMPERATURE,
        max_completion_tokens: 4000,
        top_p: 0.95,
        response_format: {
          type: 'json_object'
        } as any
      });

      const response = chatCompletion.choices[0]?.message?.content;
      console.log('🤖 Raw OCR Text Analysis Response:', {
        model: TEXT_MODEL,
        responseLength: response?.length || 0,
        rawResponse: response
      });

      return this.parseResponse(response || '');
    } catch (error) {
      console.error('Error with text-only processing:', error);
      throw new Error(`Text processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create prompt for text-only processing using OCR extracted text
   */
  private createTextOnlyPrompt(ocrText: string): string {
    return `You are an expert educational assessment analyzer. I have extracted text from an answer key document using OCR.

OCR Extracted Text:
${ocrText}

Please analyze this text and extract the answer key information. Return a JSON object with the following structure:

{
  "questions": [
    {
      "question_number": 1,
      "question_text": "Optional question text if clearly visible",
      "correct_answer": "A",
      "answer_type": "multiple_choice",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "points": 1
    }
  ],
  "metadata": {
    "total_questions": 10,
    "subject": "Optional subject if identifiable",
    "difficulty": "Optional difficulty level",
    "instructions": "Any special instructions found"
  }
}

Guidelines:
- Parse all text carefully to identify answer patterns
- Extract question numbers and their corresponding correct answers
- Determine answer types: multiple_choice, true_false, fill_blank, essay, matching
- Look for patterns like "1. A", "Question 1: B", "1) True", etc.
- Include question text if present in the OCR text
- For multiple choice, extract all available options if listed
- Handle OCR errors and inconsistencies gracefully
- Look for headers, titles, or labels that indicate this is an answer key
- Count total questions based on parsed content
- Return valid JSON only, no additional text or explanations`;
  }

  /**
   * Parse AI response into structured data
   */
  private parseResponse(content: string): AnswerKeyData {
    console.log('🔍 Parsing AI Response:', {
      contentLength: content.length,
      rawContent: content
    });

    try {
      // Qwen3 models prepend a `thinking` reasoning block before the answer.
      // Strip it so JSON extraction is reliable.
      const cleanedContent = this.stripThinkingPreamble(content);

      // 1) Try to parse as-is.
      const direct = this.tryParseJson(cleanedContent);
      if (direct) {
        const sanitizedData = this.validateAndSanitizeData(direct);
        return sanitizedData;
      }

      // 2) Extract first JSON object.
      const jsonMatch = this.extractFirstJsonObject(cleanedContent);
      if (!jsonMatch) {
        console.error('❌ No JSON found in AI response:', {
          content,
          contentPreview: content.substring(0, 500) + '...'
        });
        throw new Error('No JSON found in response');
      }

      console.log('📝 JSON extracted from AI response:', {
        jsonString: jsonMatch[0],
        jsonLength: jsonMatch[0].length
      });

  const repaired = this.repairCommonJsonIssues(jsonMatch);
  const parsedData = JSON.parse(repaired);

      console.log('✅ Successfully parsed JSON from AI:', {
        parsedData,
        questionsFound: parsedData.questions?.length || 0,
        metadata: parsedData.metadata
      });

      // Validate and sanitize the response
      const sanitizedData = this.validateAndSanitizeData(parsedData);

      console.log('🔧 Data validation and sanitization complete:', {
        originalQuestions: parsedData.questions?.length || 0,
        sanitizedQuestions: sanitizedData.questions.length,
        sanitizedData
      });

      return sanitizedData;
    } catch (error) {
      console.error('❌ Error parsing AI response:', {
        error,
        content,
        contentType: typeof content,
        contentPreview: content.substring(0, 1000)
      });
      // Return basic structure if parsing fails
      return {
        questions: [],
        metadata: {
          total_questions: 0,
          subject: 'Unknown',
          difficulty: 'Unknown'
        }
      };
    }
  }

  /**
   * Parse an AI response into raw JSON without the answer-key sanitization.
   * Used for student answer sheets that return an "answers" schema.
   */
  private parseRawJson(content: string): any {
    console.log('🔍 Parsing Raw AI Response:', {
      contentLength: content.length,
      rawContent: content
    });

    try {
      const cleanedContent = this.stripThinkingPreamble(content);
      const direct = this.tryParseJson(cleanedContent);
      if (direct) return direct;

      const jsonMatch = this.extractFirstJsonObject(cleanedContent);
      if (!jsonMatch) {
        console.error('❌ No JSON found in AI response:', {
          contentPreview: content.substring(0, 500)
        });
        throw new Error('No JSON found in response');
      }

      return JSON.parse(this.repairCommonJsonIssues(jsonMatch));
    } catch (error) {
      console.error('❌ Error parsing raw AI response:', {
        error,
        contentPreview: content.substring(0, 1000)
      });
      return { answers: [], metadata: { totalQuestions: 0, processedQuestions: 0 } };
    }
  }

  /**
   * Validate and sanitize parsed data
   */
  private validateAndSanitizeData(data: any): AnswerKeyData {
    const sanitized: AnswerKeyData = {
      questions: [],
      metadata: {
        total_questions: 0,
        subject: data.metadata?.subject || 'Unknown',
        difficulty: data.metadata?.difficulty || 'Unknown',
        instructions: data.metadata?.instructions || ''
      }
    };

    if (Array.isArray(data.questions)) {
      sanitized.questions = data.questions.map((q: any, index: number) => ({
        question_number: q.question_number || (index + 1),
        question_text: q.question_text || '',
        correct_answer: q.correct_answer || '',
        answer_type: this.validateAnswerType(q.answer_type),
        options: Array.isArray(q.options) ? q.options : [],
        points: typeof q.points === 'number' ? q.points : 1
      }));
    }

    if (sanitized.metadata) {
      sanitized.metadata.total_questions = sanitized.questions.length;
    }
    return sanitized;
  }

  /**
   * Validate answer type
   */
  private validateAnswerType(type: string): 'multiple_choice' | 'true_false' | 'fill_blank' | 'essay' | 'matching' {
    const validTypes: Array<'multiple_choice' | 'true_false' | 'fill_blank' | 'essay' | 'matching'> = [
      'multiple_choice', 'true_false', 'fill_blank', 'essay', 'matching'
    ];

    return validTypes.includes(type as any) ? type as any : 'multiple_choice';
  }

  /**
   * Some responses include markdown fences, trailing commas, or other minor issues.
   * These helpers make parsing more resilient.
   */
  private tryParseJson(text: string): any | null {
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '');

    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }

  private extractFirstJsonObject(text: string): string | null {
    const match = text.match(/\{[\s\S]*\}/);
    return match?.[0] ?? null;
  }

  /**
   * Qwen3 reasoning models emit a `thinking` block that ends with a
   * ` response` marker. Remove everything before it to leave clean JSON.
   */
  private stripThinkingPreamble(text: string): string {
    const marker = '\n response\n';
    const index = text.lastIndexOf(marker);
    if (index === -1) return text;
    return text.slice(index + marker.length);
  }

  private repairCommonJsonIssues(jsonLike: string): string {
    // Remove trailing commas before } or ]
    return jsonLike
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/\u0000/g, '')
      .trim();
  }

  private createJsonOnlySystemPrompt(): string {
    return [
      'You are a careful extraction engine.',
      'Return ONLY a single valid JSON object and nothing else.',
      'Do not wrap it in markdown fences.',
      'Use double quotes for all keys and string values.',
      'If a field is unknown, use an empty string or omit optional fields.',
    ].join(' ');
  }

  /**
   * Detect common image MIME types from base64 payload.
   */
  private detectMimeTypeFromBase64(base64: string): string | null {
    const head = base64.slice(0, 16);
    // JPEG: /9j/
    if (head.startsWith('/9j/')) return 'image/jpeg';
    // PNG: iVBORw0KGgo
    if (head.startsWith('iVBORw0KGgo')) return 'image/png';
    // GIF: R0lGOD
    if (head.startsWith('R0lGOD')) return 'image/gif';
    // WEBP: UklGR
    if (head.startsWith('UklGR')) return 'image/webp';
    return null;
  }

  /**
   * Lightweight OCR fallback using Tesseract.js already in the project.
   */
  private async extractOcrTextFromBase64(imageBase64: string): Promise<string> {
    try {
      const { createWorker } = await import('tesseract.js');
      const mimeType = this.detectMimeTypeFromBase64(imageBase64) ?? 'image/jpeg';
      const worker = await createWorker('eng');
      const {
        data: { text }
      } = await worker.recognize(`data:${mimeType};base64,${imageBase64}`);
      await worker.terminate();
      return (text ?? '').toString();
    } catch (e) {
      console.warn('OCR fallback failed:', e);
      return '';
    }
  }


}

/**
 * Initialize Groq AI service with API key from environment
 */
export function createGroqAIService(): GroqAIService {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY environment variable is not set');
  }
  return new GroqAIService(apiKey);
}

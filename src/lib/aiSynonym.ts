import { Groq } from 'groq-sdk';

// Free-tier text model on this Groq key.
const TEXT_MODEL = 'openai/gpt-oss-120b';

interface SynonymCheckResult {
  areEquivalent: boolean;
  confidence: number;
  explanation: string;
  synonyms?: string[];
}

interface BatchSynonymCheckResult {
  comparisons: Array<{
    questionNumber: number;
    studentAnswer: string;
    correctAnswer: string;
    areEquivalent: boolean;
    confidence: number;
    explanation: string;
  }>;
}

/**
 * Groq AI service for checking if two answers are synonymous or semantically equivalent
 */
export class GroqSynonymService {
  private groq: Groq;

  constructor(apiKey: string) {
    this.groq = new Groq({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true // Required for browser usage
    });
  }

  /**
   * Check if two answers are synonymous or semantically equivalent
   * @param studentAnswer - The answer provided by the student
   * @param correctAnswer - The correct/expected answer
   * @returns SynonymCheckResult with equivalence status, confidence, and explanation
   */
  async checkSynonym(studentAnswer: string, correctAnswer: string): Promise<SynonymCheckResult> {
    const prompt = this.createSynonymCheckPrompt(studentAnswer, correctAnswer);

    try {
      const chatCompletion = await this.groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: 'You are an expert educational assessment evaluator specializing in semantic analysis of student answers. You determine if student answers are semantically equivalent to correct answers, accounting for synonyms, paraphrasing, and variations in expression.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        model: TEXT_MODEL, // Fast and accurate model for text analysis
        temperature: 0.2, // Low temperature for consistent, accurate results
        max_completion_tokens: 512,
        top_p: 1,
        stream: false,
        stop: null,
        response_format: {
          type: 'json_object'
        } as any
      });

      const content = chatCompletion.choices[0]?.message?.content || '';
      return this.parseResponse(content);
    } catch (error) {
      console.error('Error checking synonym:', error);
      // Fallback to exact match if AI fails
      return {
        areEquivalent: studentAnswer.toLowerCase().trim() === correctAnswer.toLowerCase().trim(),
        confidence: 0.5,
        explanation: 'AI service unavailable, using exact match comparison'
      };
    }
  }

  /**
   * Batch check multiple answer pairs for synonymy
   * @param answerPairs - Array of {questionNumber, studentAnswer, correctAnswer}
   * @returns BatchSynonymCheckResult with all comparisons
   */
  async checkBatchSynonyms(answerPairs: Array<{
    questionNumber: number;
    studentAnswer: string;
    correctAnswer: string;
  }>): Promise<BatchSynonymCheckResult> {
    const prompt = this.createBatchSynonymCheckPrompt(answerPairs);

    try {
      const chatCompletion = await this.groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: 'You are an expert educational assessment evaluator specializing in semantic analysis of student answers. You determine if student answers are semantically equivalent to correct answers, accounting for synonyms, paraphrasing, and variations in expression. Analyze multiple answer pairs efficiently.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        model: TEXT_MODEL,
        temperature: 0.2,
        max_completion_tokens: 2048,
        top_p: 1,
        stream: false,
        stop: null,
        response_format: {
          type: 'json_object'
        } as any
      });

      const content = chatCompletion.choices[0]?.message?.content || '';
      return this.parseBatchResponse(content, answerPairs);
    } catch (error) {
      console.error('Error in batch synonym check:', error);
      // Fallback to exact match for all pairs
      return {
        comparisons: answerPairs.map(pair => ({
          questionNumber: pair.questionNumber,
          studentAnswer: pair.studentAnswer,
          correctAnswer: pair.correctAnswer,
          areEquivalent: pair.studentAnswer.toLowerCase().trim() === pair.correctAnswer.toLowerCase().trim(),
          confidence: 0.5,
          explanation: 'AI service unavailable, using exact match comparison'
        }))
      };
    }
  }

  /**
   * Create prompt for single synonym check
   */
  private createSynonymCheckPrompt(studentAnswer: string, correctAnswer: string): string {
    return `Analyze if these two answers are semantically equivalent:

Student Answer: "${studentAnswer}"
Correct Answer: "${correctAnswer}"

Consider the following:
- Are they synonyms? (e.g., "cleaning" = "cleansing", "scrubbing", "washing", "sanitizing", "tidying")
- Are they semantically equivalent despite different wording?
- Do they convey the same meaning in an educational context?
- Account for minor spelling variations or typos that don't change meaning
- For multiple-choice answers (A, B, C, D), they must match exactly

Return a JSON object with this exact structure:
{
  "areEquivalent": true or false,
  "confidence": 0.0 to 1.0,
  "explanation": "Brief explanation of why they are or aren't equivalent",
  "synonyms": ["optional", "list", "of", "related", "terms"]
}

Return ONLY valid JSON, no additional text.`;
  }

  /**
   * Create prompt for batch synonym check
   */
  private createBatchSynonymCheckPrompt(answerPairs: Array<{
    questionNumber: number;
    studentAnswer: string;
    correctAnswer: string;
  }>): string {
    const pairsText = answerPairs.map((pair, index) =>
      `${index + 1}. Question ${pair.questionNumber}:
   Student: "${pair.studentAnswer}"
   Correct: "${pair.correctAnswer}"`
    ).join('\n\n');

    return `Analyze if each pair of answers below are semantically equivalent:

${pairsText}

For each pair, consider:
- Are they synonyms or semantically equivalent?
- Do they convey the same meaning in an educational context?
- Account for minor variations that don't change meaning
- For multiple-choice answers (A, B, C, D), they must match exactly

Return a JSON object with this exact structure:
{
  "comparisons": [
    {
      "questionNumber": 1,
      "areEquivalent": true or false,
      "confidence": 0.0 to 1.0,
      "explanation": "Brief explanation"
    }
  ]
}

Return ONLY valid JSON, no additional text.`;
  }

  /**
   * Parse AI response for single synonym check
   */
  private parseResponse(content: string): SynonymCheckResult {
    try {
      // Clean the response to extract JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsedData = JSON.parse(jsonMatch[0]);

      return {
        areEquivalent: parsedData.areEquivalent || false,
        confidence: typeof parsedData.confidence === 'number' ? parsedData.confidence : 0.5,
        explanation: parsedData.explanation || 'No explanation provided',
        synonyms: Array.isArray(parsedData.synonyms) ? parsedData.synonyms : undefined
      };
    } catch (error) {
      console.error('Error parsing synonym check response:', error);
      return {
        areEquivalent: false,
        confidence: 0,
        explanation: 'Failed to parse AI response'
      };
    }
  }

  /**
   * Parse AI response for batch synonym check
   */
  private parseBatchResponse(content: string, originalPairs: Array<{
    questionNumber: number;
    studentAnswer: string;
    correctAnswer: string;
  }>): BatchSynonymCheckResult {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsedData = JSON.parse(jsonMatch[0]);

      if (!Array.isArray(parsedData.comparisons)) {
        throw new Error('Invalid response format');
      }

      const comparisons = parsedData.comparisons.map((comp: any, index: number) => {
        const originalPair = originalPairs[index];
        return {
          questionNumber: comp.questionNumber || originalPair.questionNumber,
          studentAnswer: originalPair.studentAnswer,
          correctAnswer: originalPair.correctAnswer,
          areEquivalent: comp.areEquivalent || false,
          confidence: typeof comp.confidence === 'number' ? comp.confidence : 0.5,
          explanation: comp.explanation || 'No explanation provided'
        };
      });

      return { comparisons };
    } catch (error) {
      console.error('Error parsing batch synonym check response:', error);
      // Return fallback with exact match
      return {
        comparisons: originalPairs.map(pair => ({
          questionNumber: pair.questionNumber,
          studentAnswer: pair.studentAnswer,
          correctAnswer: pair.correctAnswer,
          areEquivalent: pair.studentAnswer.toLowerCase().trim() === pair.correctAnswer.toLowerCase().trim(),
          confidence: 0.5,
          explanation: 'Failed to parse AI response, using exact match'
        }))
      };
    }
  }
}

/**
 * Initialize Groq Synonym service with API key from environment
 */
export function createGroqSynonymService(): GroqSynonymService {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY environment variable is not set');
  }
  return new GroqSynonymService(apiKey);
}

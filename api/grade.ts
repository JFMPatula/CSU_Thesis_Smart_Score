import { applyRateLimit, getAdminClient, parseBody } from './_lib/http.js'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = process.env.GROQ_GRADING_MODEL || 'openai/gpt-oss-120b'

function normalize(value: unknown): string {
  return String(value ?? '').trim()
}

function isChoice(value: string): boolean {
  return /^[A-Da-d]$/.test(value)
}

function exactMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

async function synonymMatches(
  pairs: Array<{ questionNumber: number; studentAnswer: string; correctAnswer: string }>
): Promise<Map<number, { areEquivalent: boolean; confidence: number; explanation: string }>> {
  const results = new Map<number, { areEquivalent: boolean; confidence: number; explanation: string }>()
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey || pairs.length === 0) return results

  const pairsText = pairs
    .map(
      (pair, index) =>
        `${index + 1}. Question ${pair.questionNumber}:\n   Student: "${pair.studentAnswer}"\n   Correct: "${pair.correctAnswer}"`
    )
    .join('\n\n')

  const prompt = `Analyze if each pair of answers below are semantically equivalent.

${pairsText}

For each pair consider synonyms, paraphrasing, and minor spelling variations. Multiple-choice answers (A, B, C, D) must match exactly.

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

Return ONLY valid JSON, no additional text.`

  try {
    const resp = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert educational assessment evaluator. Determine whether student answers are semantically equivalent to correct answers.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_completion_tokens: 2048,
        response_format: { type: 'json_object' },
      }),
    })

    const json = await resp.json().catch(() => null)
    if (!resp.ok) return results

    const content = json?.choices?.[0]?.message?.content || ''
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) return results

    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed.comparisons)) return results

    parsed.comparisons.forEach((comparison: any) => {
      const questionNumber = Number(comparison?.questionNumber)
      if (!Number.isFinite(questionNumber)) return
      results.set(questionNumber, {
        areEquivalent: comparison?.areEquivalent === true,
        confidence:
          typeof comparison?.confidence === 'number' ? comparison.confidence : 0.5,
        explanation:
          typeof comparison?.explanation === 'string' ? comparison.explanation : '',
      })
    })
  } catch (err) {
    console.error('Grading synonym check failed:', err)
  }

  return results
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!applyRateLimit(req, res, 20, 60_000)) return

  const admin = getAdminClient()
  if (!admin) {
    res.status(500).json({ error: 'Server is not configured' })
    return
  }

  const body = parseBody(req)
  const quizId = Number(body.quizId)
  const answers = body.answers
  const student = body.student || {}
  const fullname = normalize(student.fullname)
  const studentId = normalize(student.student_id || student.studentId)
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.slice(0, 2048) : null

  if (!Number.isInteger(quizId) || quizId <= 0) {
    res.status(400).json({ error: 'Invalid quiz id' })
    return
  }
  if (!Array.isArray(answers) || answers.length === 0 || answers.length > 500) {
    res.status(400).json({ error: 'Invalid answers' })
    return
  }
  if (fullname.length < 2 || fullname.length > 200) {
    res.status(400).json({ error: 'Invalid student name' })
    return
  }
  if (studentId.length < 1 || studentId.length > 100) {
    res.status(400).json({ error: 'Invalid student id' })
    return
  }

  const { data: answerKeyRow, error: answerKeyError } = await admin
    .from('answer_keys')
    .select('id,is_active,answer_keys')
    .eq('id', quizId)
    .maybeSingle()

  if (answerKeyError) {
    res.status(400).json({ error: answerKeyError.message })
    return
  }
  if (!answerKeyRow || !answerKeyRow.is_active) {
    res.status(404).json({ error: 'Quiz not found or inactive' })
    return
  }

  let answerKeyData = answerKeyRow.answer_keys
  if (typeof answerKeyData === 'string') {
    try {
      answerKeyData = JSON.parse(answerKeyData)
    } catch {
      answerKeyData = null
    }
  }

  const questions = Array.isArray(answerKeyData?.questions) ? answerKeyData.questions : []
  if (questions.length === 0) {
    res.status(422).json({ error: 'Answer key has no questions' })
    return
  }

  const correctByQuestion = new Map<number, string>()
  questions.forEach((question: any) => {
    const questionNumber = Number(question?.question_number ?? question?.questionNumber)
    if (Number.isFinite(questionNumber)) {
      correctByQuestion.set(questionNumber, normalize(question?.correct_answer))
    }
  })

  const submitted = answers.map((answer: any) => ({
    questionNumber: Number(answer?.questionNumber),
    selectedAnswer: normalize(answer?.selectedAnswer),
    confidence: typeof answer?.confidence === 'number' ? answer.confidence : undefined,
    alternatives: Array.isArray(answer?.alternatives) ? answer.alternatives : undefined,
  }))

  const synonymPairs = submitted
    .filter((answer) => correctByQuestion.has(answer.questionNumber))
    .filter((answer) => {
      const correct = correctByQuestion.get(answer.questionNumber) || ''
      return !(isChoice(answer.selectedAnswer) && isChoice(correct))
    })
    .map((answer) => ({
      questionNumber: answer.questionNumber,
      studentAnswer: answer.selectedAnswer,
      correctAnswer: correctByQuestion.get(answer.questionNumber) || '',
    }))

  const synonymResults = await synonymMatches(synonymPairs)

  const comparisons: any[] = []
  const answersWithVerdict: any[] = []
  let totalCorrect = 0

  submitted.forEach((answer) => {
    const correctAnswer = correctByQuestion.get(answer.questionNumber)
    if (correctAnswer === undefined) return

    const choice = isChoice(answer.selectedAnswer) && isChoice(correctAnswer)
    let isCorrect = choice
      ? answer.selectedAnswer.toUpperCase() === correctAnswer.toUpperCase()
      : exactMatch(answer.selectedAnswer, correctAnswer)
    let confidence: number | undefined
    let explanation: string | undefined

    if (!choice) {
      const synonym = synonymResults.get(answer.questionNumber)
      if (synonym) {
        isCorrect = synonym.areEquivalent
        confidence = synonym.confidence
        explanation = synonym.explanation
      }
    }

    if (isCorrect) totalCorrect += 1

    const comparison = {
      questionNumber: answer.questionNumber,
      studentAnswer: answer.selectedAnswer,
      correctAnswer,
      isCorrect,
      points: isCorrect ? 1 : 0,
      confidence,
      explanation,
    }
    comparisons.push(comparison)
    answersWithVerdict.push({
      ...answer,
      isCorrect,
      correctAnswer,
      correctAnswerText: correctAnswer,
      aiConfidence: confidence,
      aiExplanation: explanation,
    })
  })

  const totalQuestions = questions.length
  const score = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0
  let remarks = 'Needs improvement.'
  if (score >= 90) remarks = 'Excellent performance!'
  else if (score >= 80) remarks = 'Very good work!'
  else if (score >= 70) remarks = 'Good job!'
  else if (score >= 60) remarks = 'Satisfactory performance.'

  const { data: inserted, error: insertError } = await admin
    .from('students')
    .insert({
      fullname,
      student_id: studentId,
      answer_key_id: quizId,
      answers: answersWithVerdict,
      image_url: imageUrl,
      score,
      remarks,
    })
    .select('id')
    .single()

  if (insertError) {
    res.status(400).json({ error: insertError.message })
    return
  }

  res.status(200).json({
    success: true,
    studentRecordId: inserted?.id,
    score,
    remarks,
    totalCorrect,
    totalIncorrect: totalQuestions - totalCorrect,
    totalQuestions,
    percentageScore: score,
    correctAnswers: totalCorrect,
    incorrectAnswers: totalQuestions - totalCorrect,
    comparisons,
  })
}

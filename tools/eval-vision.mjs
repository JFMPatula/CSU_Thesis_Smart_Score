#!/usr/bin/env node
// Evaluate the vision/answer-extraction pipeline against a labeled set of
// answer-sheet images.
//
// Usage:
//   node tools/eval-vision.mjs --dir tools/eval/samples
//   node tools/eval-vision.mjs --dir tools/eval/samples --url https://csu-smartscore.vercel.app/api/vision --token "$SMARTSCORE_TOKEN"
//
// labels.json format:
//   [
//     {
//       "image": "sheet-01.jpg",
//       "answers": [
//         { "questionNumber": 1, "selectedAnswer": "A" },
//         { "questionNumber": 2, "selectedAnswer": "photosynthesis" }
//       ]
//     }
//   ]
//
// The token is optional: the student quiz page is public, so the endpoint also
// accepts anonymous requests (with a tighter rate limit).

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
function arg(name, fallback = '') {
  const index = args.indexOf(`--${name}`)
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback
}

const dir = path.resolve(arg('dir', 'tools/eval/samples'))
const labelsPath = path.resolve(arg('labels', path.join(dir, 'labels.json')))
const url = arg('url', 'https://csu-smartscore.vercel.app/api/vision')
const token = arg('token', process.env.SMARTSCORE_TOKEN || '')
const outPath = path.resolve(arg('out', path.join(dir, 'eval-report.json')))

const STUDENT_PROMPT = `You are an expert at extracting student written answers from answer sheet images. Read the image directly and extract the student's written answers (handwritten or printed).

Return a JSON object with this exact structure:
{
  "answers": [
    {
      "questionNumber": 1,
      "selectedAnswer": "photosynthesis",
      "confidence": 0.95,
      "alternatives": ["photosynth"]
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
- Look for numbered questions and their corresponding written answers.
- Include multiple-choice letters (A, B, C, D) when that is what the student wrote.
- If text is unclear, include alternative readings and lower the confidence.
- Return only valid JSON, no additional text.`

const MAX_IMAGE_BYTES = 4_000_000

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/jpeg'
}

function estimateDimensionsFromHeader(bytes) {
  if (bytes.length > 10 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i < bytes.length - 1; i++) {
      if (bytes[i] === 0xff && (bytes[i + 1] & 0xf0) === 0xc0) {
        const length = bytes[i + 2] * 256 + bytes[i + 3]
        if (i + 5 + length <= bytes.length) {
          const height = bytes[i + 5] * 256 + bytes[i + 6]
          const width = bytes[i + 7] * 256 + bytes[i + 8]
          return { width, height }
        }
      }
    }
  }
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]
    return { width, height }
  }
  return null
}

function detectMimeFromBase64(base64) {
  const head = base64.slice(0, 16)
  if (head.startsWith('/9j/')) return 'image/jpeg'
  if (head.startsWith('iVBORw0KGgo')) return 'image/png'
  if (head.startsWith('R0lGOD')) return 'image/gif'
  if (head.startsWith('UklGR')) return 'image/webp'
  return 'image/jpeg'
}

function validateImageSize(filePath, base64) {
  const raw = Buffer.from(base64, 'base64')
  const sizeKB = (raw.length / 1024).toFixed(1)
  const dims = estimateDimensionsFromHeader(raw)
  const issues = []
  let usable = true

  if (!dims) {
    issues.push('could not read image dimensions')
    usable = false
  } else {
    if (dims.width < 32 || dims.height < 32) {
      issues.push(`image too small: ${dims.width}x${dims.height}`)
      usable = false
    }
    const ar = dims.width / dims.height
    if (ar > 3 || ar < 0.33) {
      issues.push(`unusual aspect ratio: ${ar.toFixed(2)}`)
    }
  }
  if (raw.length > MAX_IMAGE_BYTES) {
    issues.push(`file too large: ${sizeKB}KB (max 4000KB)`)
    usable = false
  }

  return { usable, issues, sizeKB, dims }
}

function normalize(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.!?;,]+$/g, '')
    .replace(/\s+/g, ' ')
}

function parseJson(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/,\s*([}\]])/g, '$1')
  try {
    return JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    return match ? JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1')) : null
  }
}

async function extract(file, base64) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  const sizeCheck = validateImageSize(file, base64)
  if (!sizeCheck.usable) {
    throw new Error(`Image validation failed: ${sizeCheck.issues.join('; ')}`)
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      image: base64,
      mimeType: mimeFor(file),
      prompt: STUDENT_PROMPT,
      mode: 'json',
    }),
  })

  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(body?.detail || body?.error || `HTTP ${res.status}`)
  }
  const parsed = parseJson(body?.text)
  if (!parsed) throw new Error('Vision response was not valid JSON')
  return { parsed, provider: body?.provider, model: body?.model }
}

function computeMetrics(results) {
  let expectedTotal = 0
  let detectedTotal = 0
  let correctTotal = 0
  let totalElapsed = 0
  let successCount = 0
  const providerStats = {}

  for (const r of results) {
    if (r.error) continue
    successCount++
    totalElapsed += r.elapsedMs
    expectedTotal += r.expected
    detectedTotal += r.detected
    correctTotal += r.exactMatches

    const p = r.provider || 'unknown'
    if (!providerStats[p]) {
      providerStats[p] = { cases: 0, expected: 0, detected: 0, correct: 0, totalElapsed: 0 }
    }
    providerStats[p].cases++
    providerStats[p].expected += r.expected
    providerStats[p].detected += r.detected
    providerStats[p].correct += r.exactMatches
    providerStats[p].totalElapsed += r.elapsedMs
  }

  const detectionRecall = expectedTotal ? detectedTotal / expectedTotal : 0
  const answerAccuracy = expectedTotal ? correctTotal / expectedTotal : 0
  const precision = detectedTotal ? correctTotal / detectedTotal : 0
  const f1 = (precision + detectionRecall) > 0
    ? 2 * (precision * detectionRecall) / (precision + detectionRecall)
    : 0
  const avgLatency = successCount ? totalElapsed / successCount : 0

  const providerSummary = {}
  for (const [p, s] of Object.entries(providerStats)) {
    const prec = s.detected ? s.correct / s.detected : 0
    const rec = s.expected ? s.detected / s.expected : 0
    providerSummary[p] = {
      cases: s.cases,
      expectedAnswers: s.expected,
      detectedAnswers: s.detected,
      exactMatches: s.correct,
      detectionRecall: rec,
      answerPrecision: prec,
      f1Score: (prec + rec) > 0 ? 2 * (prec * rec) / (prec + rec) : 0,
      avgLatencyMs: s.cases ? Math.round(s.totalElapsed / s.cases) : 0,
    }
  }

  return {
    cases: results.length,
    successfulCases: successCount,
    failedCases: results.length - successCount,
    expectedAnswers: expectedTotal,
    detectedAnswers: detectedTotal,
    exactMatches: correctTotal,
    detectionRecall,
    answerPrecision: precision,
    answerAccuracy,
    f1Score: f1,
    avgLatencyMs: Math.round(avgLatency),
    providerBreakdown: providerSummary,
  }
}

async function main() {
  if (!fs.existsSync(labelsPath)) {
    console.error(`labels file not found: ${labelsPath}`)
    console.error('Create it from tools/eval/labels.example.json')
    process.exit(2)
  }

  const cases = JSON.parse(fs.readFileSync(labelsPath, 'utf8'))
  const results = []
  let expectedTotal = 0
  let detectedTotal = 0
  let correctTotal = 0

  for (const testCase of cases) {
    const file = path.resolve(dir, testCase.image)
    const expected = Array.isArray(testCase.answers) ? testCase.answers : []
    expectedTotal += expected.length

    try {
      const base64 = fs.readFileSync(file).toString('base64')
      const startedAt = Date.now()
      const { parsed, provider, model } = await extract(file, base64)
      const elapsedMs = Date.now() - startedAt

      const actual = new Map()
      for (const answer of parsed?.answers || []) {
        const qn = Number(answer?.questionNumber)
        if (Number.isInteger(qn) && qn > 0) {
          actual.set(qn, answer?.selectedAnswer)
        }
      }

      const perAnswer = expected.map((item) => {
        const qn = Number(item.questionNumber)
        const has = actual.has(qn)
        if (has) detectedTotal += 1
        const ok = has && normalize(actual.get(qn)) === normalize(item.selectedAnswer)
        if (ok) correctTotal += 1
        return {
          questionNumber: qn,
          expected: item.selectedAnswer,
          actual: has ? actual.get(qn) : null,
          status: !has ? 'missing' : ok ? 'ok' : 'wrong',
        }
      })

      const detected = expected.filter((item) => actual.has(Number(item.questionNumber))).length
      results.push({
        image: testCase.image,
        provider,
        model,
        elapsedMs,
        expected: expected.length,
        detected,
        exactMatches: perAnswer.filter((item) => item.status === 'ok').length,
        answers: perAnswer,
      })
      console.log(
        `${testCase.image}: ${perAnswer.filter((i) => i.status === 'ok').length}/${expected.length} exact` +
          ` (detected ${detected}/${expected.length}, ${provider || '?'}/${model || '?'}, ${elapsedMs}ms)`,
      )
    } catch (error) {
      results.push({ image: testCase.image, error: String(error?.message || error) })
      console.error(`${testCase.image}: ERROR ${error?.message || error}`)
    }
  }

  const summary = computeMetrics(results)
  summary.url = url
  summary.generatedAt = new Date().toISOString()

  const report = { summary, results }
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))

  console.log('\n=== VISION LAYER EVALUATION SUMMARY ===')
  console.log(`  Cases evaluated : ${summary.cases}`)
  console.log(`  Successful      : ${summary.successfulCases}`)
  console.log(`  Failed          : ${summary.failedCases}`)
  console.log(`  Expected answers: ${summary.expectedAnswers}`)
  console.log(`  Detected answers: ${summary.detectedAnswers}`)
  console.log(`  Exact matches   : ${summary.exactMatches}`)
  console.log(`  Detection recall: ${(summary.detectionRecall * 100).toFixed(1)}%`)
  console.log(`  Answer precision: ${(summary.answerPrecision * 100).toFixed(1)}%`)
  console.log(`  Answer accuracy : ${(summary.answerAccuracy * 100).toFixed(1)}%`)
  console.log(`  F1 score        : ${(summary.f1Score * 100).toFixed(1)}%`)
  console.log(`  Avg latency     : ${summary.avgLatencyMs}ms`)
  console.log('\nPer-provider breakdown:')
  for (const [p, s] of Object.entries(summary.providerBreakdown)) {
    console.log(`  ${p}: recall=${(s.detectionRecall * 100).toFixed(1)}% precision=${(s.answerPrecision * 100).toFixed(1)}%` +
      ` f1=${(s.f1Score * 100).toFixed(1)}% avgLatency=${s.avgLatencyMs}ms (${s.cases} cases)`)
  }
  console.log(`\nReport: ${outPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

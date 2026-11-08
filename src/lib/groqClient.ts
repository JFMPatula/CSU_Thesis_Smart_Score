import { supabase } from './supabase'

export interface GroqMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface GroqCompletionOptions {
  messages: GroqMessage[]
  model?: string
  temperature?: number
  max_completion_tokens?: number
  response_format?: { type: 'json_object' }
}

export interface GroqCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
}

export async function groqChatCompletion(
  options: GroqCompletionOptions
): Promise<GroqCompletionResponse> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const response = await fetch('/api/groq', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(options),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || `Groq request failed (${response.status})`)
  }

  return payload as GroqCompletionResponse
}

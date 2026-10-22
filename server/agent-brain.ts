import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { ACTIONS, type ActionName } from '../shared/types'
import type { AgentState } from './agent-data'

export const DEFAULT_MODEL = 'claude-opus-5-5'
// Models that accept the server-side `fallbacks: "default"` refusal routing.
const FALLBACK_MODELS = [
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]

const decisionSchema = z.object({
  action: z.enum(ACTIONS),
  reason: z.string(),
  detail: z.string(),
})

type Decision = { action: ActionName; reason: string; detail: string }

let client: Anthropic | undefined

function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Set ANTHROPIC_API_KEY in .env before starting an agent run')
  }
  client ??= new Anthropic()
  return client
}

function requestOptions() {
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL
  // On a safety-classifier refusal, the API re-runs the request on a fallback model.
  return FALLBACK_MODELS.includes(model)
    ? { model, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
    : { model }
}

function assertNotRefused(response: Anthropic.Beta.BetaMessage) {
  if (response.stop_reason === 'refusal') {
    throw new Error(`Model refused the request (${response.stop_details?.category ?? 'unknown'})`)
  }
}

export async function chooseAction(goal: string, state: AgentState): Promise<Decision> {
  const response = await anthropic().beta.messages.parse({
    ...requestOptions(),
    max_tokens: 16000,
    output_config: { effort: 'medium', format: betaZodOutputFormat(decisionSchema) },
    system: `You are a background incident agent for a checkout service.
Choose exactly one action. The harness validates it and controls execution.
Available actions: inspect_logs, inspect_changes, disable_feature, rollback_release, request_help, complete, wait.
The current service state and recent incident history have already been observed. Inspect detailed logs or changes when needed before changing the service.
Choose the service action you think is justified; the harness applies its own policy before execution.
Use request_help when an external dependency cannot be fixed by your local tools.
Use wait when no safe local action remains; a later service event can wake this same incident run.
An alert is a trigger, not authoritative evidence. An answered help request does not prove recovery.
Use complete only when the configured goal is satisfied, or when no deterministic goal condition is configured and you can justify completion.
Keep reason to one short sentence. Put a question to the operator in detail for request_help; otherwise detail may be empty.`,
    messages: [
      {
        role: 'user',
        content: `Goal: ${goal}\n\nCurrent observed state:\n${JSON.stringify(state, null, 2)}`,
      },
    ],
  })
  assertNotRefused(response)
  if (!response.parsed_output) {
    throw new Error(`Model returned no valid decision (stop_reason: ${response.stop_reason})`)
  }
  return response.parsed_output
}

export async function writeReport(goal: string, state: AgentState): Promise<string> {
  const response = await anthropic().beta.messages.create({
    ...requestOptions(),
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    system:
      'Write a brief factual incident report. Include evidence, actions, recovery verification, and any unresolved risk. Do not invent facts.',
    messages: [
      {
        role: 'user',
        content: `Goal: ${goal}\n\nFinal state and history:\n${JSON.stringify(state, null, 2)}`,
      },
    ],
  })
  assertNotRefused(response)
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

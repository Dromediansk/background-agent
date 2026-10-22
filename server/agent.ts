import 'dotenv/config'
import express from 'express'
import { serve } from 'inngest/express'
import { DEFAULT_MODEL } from './agent-brain'
import { incidentAgent } from './agent-workflow'
import { inngest } from './inngest'

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('Set ANTHROPIC_API_KEY before starting the real agent')
}
const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL

const app = express()
// Inngest replays prior step results to this local endpoint; long incident runs exceed Express's 100 KB default.
app.use(express.json({ limit: '10mb' }))
app.get('/api/health', (_request, response) =>
  response.json({
    ok: true,
    process: 'agent',
    mode: 'anthropic',
    model,
  }),
)
app.use('/api/inngest', serve({ client: inngest, functions: [incidentAgent] }))

app.listen(3002, '127.0.0.1', () =>
  console.log(`Agent endpoint http://127.0.0.1:3002/api/inngest | REAL MODEL: ${model}`),
)

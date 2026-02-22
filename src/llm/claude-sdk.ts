import { createLogger } from '../utils/logger.js'

const log = createLogger('claude-sdk')

export interface ClaudeSdkOptions {
  prompt: string
  systemPrompt?: string
  model?: string
  maxTurns?: number
  cwd?: string
  allowedTools?: string[]
}

export interface ClaudeSdkResult {
  content: string
  costUsd?: number
}

interface SdkMessage {
  role: string
  content: Array<{ type: string; text?: string }>
  cost_usd?: number
}

interface SdkModule {
  query: (params: {
    prompt: string
    options: {
      model?: string
      systemPrompt?: string
      maxTurns?: number
      allowedTools?: string[]
      cwd?: string
    }
  }) => Promise<SdkMessage[]>
}

export async function runClaudeSdk(options: ClaudeSdkOptions): Promise<ClaudeSdkResult> {
  let claudeModule: SdkModule
  try {
    const moduleName = '@anthropic-ai/claude-code'
    claudeModule = await import(/* webpackIgnore: true */ moduleName) as SdkModule
  } catch {
    throw new Error(
      'Claude Code SDK not installed. Run: npm install @anthropic-ai/claude-code',
    )
  }

  log.info(`Executing SDK: "${options.prompt.slice(0, 60)}..."`)

  const messages = await claudeModule.query({
    prompt: options.prompt,
    options: {
      model: options.model,
      systemPrompt: options.systemPrompt,
      maxTurns: options.maxTurns ?? 3,
      allowedTools: options.allowedTools ?? [],
      cwd: options.cwd,
    },
  })

  const lastMessage = messages.filter((m: SdkMessage) => m.role === 'assistant').pop()
  let content = ''
  let costUsd: number | undefined

  if (lastMessage) {
    for (const block of lastMessage.content) {
      if (block.type === 'text' && block.text) {
        content += block.text
      }
    }
    costUsd = lastMessage.cost_usd
  }

  return { content, costUsd }
}

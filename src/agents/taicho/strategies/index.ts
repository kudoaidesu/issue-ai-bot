import type { CodingStrategy } from '../types.js'
import { ClaudeCliStrategy } from './claude-cli.js'

const strategies = new Map<string, CodingStrategy>()

export function registerStrategy(strategy: CodingStrategy): void {
  strategies.set(strategy.name, strategy)
}

export function getStrategy(name: string): CodingStrategy {
  const strategy = strategies.get(name)
  if (!strategy) {
    const available = [...strategies.keys()].join(', ')
    throw new Error(`Unknown coding strategy: "${name}". Available: ${available}`)
  }
  return strategy
}

export function getDefaultStrategy(): CodingStrategy {
  return getStrategy('claude-cli')
}

// 組み込み Strategy を自動登録
registerStrategy(new ClaudeCliStrategy())

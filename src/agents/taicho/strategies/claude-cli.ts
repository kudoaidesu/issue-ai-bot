import { config } from '../../../config.js'
import { runClaudeCli } from '../../../llm/claude-cli.js'
import { TAICHO_SYSTEM_PROMPT, buildUserPrompt } from '../prompt.js'
import type { CodingStrategy, CodingContext, CodingResult } from '../types.js'

/**
 * Claude CLI (claude -p) を使ったコード生成 Strategy。
 * 現行の実装をそのまま Strategy に切り出したもの。
 */
export class ClaudeCliStrategy implements CodingStrategy {
  readonly name = 'claude-cli'

  async execute(ctx: CodingContext): Promise<CodingResult> {
    const result = await runClaudeCli({
      prompt: buildUserPrompt(ctx.issue),
      systemPrompt: TAICHO_SYSTEM_PROMPT,
      model: config.llm.model,
      maxBudgetUsd: config.taicho.maxBudgetUsd,
      cwd: ctx.project.localPath,
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
      timeoutMs: config.taicho.timeoutMs,
      skipPermissions: true,
    })

    return { costUsd: result.costUsd }
  }
}

import type { IssueInfo } from '../../github/issues.js'

export type IssueDifficulty = 'S' | 'M' | 'L' | 'XL'

/**
 * Issue ラベルから難易度を判定します。
 *
 * 優先順位:
 * 1. Issue ラベル（`difficulty:S`, `difficulty:M`, `difficulty:L`, `difficulty:XL`）が最優先
 * 2. ラベルがない場合はデフォルト `M` を返す
 *
 * 参考: Issue.labels は GitHub から取得したラベルの配列
 */
export function extractDifficulty(labels: string[] = []): IssueDifficulty {
  for (const label of labels) {
    if (label.startsWith('difficulty:')) {
      const difficulty = label.substring('difficulty:'.length).toUpperCase()
      if (['S', 'M', 'L', 'XL'].includes(difficulty)) {
        return difficulty as IssueDifficulty
      }
    }
  }

  // ラベルがない場合はデフォルト M（中程度）
  return 'M'
}

/**
 * 難易度に基づいて、推奨される Strategy を返します。
 *
 * 参考: Issue #26 docs/taicho-strategies.md の「Strategy 自動選択ロジック」
 */
export function getRecommendedStrategy(difficulty: IssueDifficulty): string {
  switch (difficulty) {
    case 'S':
      // Simple: claude-cli が推奨
      return 'claude-cli'

    case 'M':
      // Medium: claude-cli または orchestrator-workers
      // 初期実装では、保守的に claude-cli を使用
      // 将来: 運用データから最適な Strategy を選択
      return 'claude-cli'

    case 'L':
      // Large: orchestrator-workers または shogun
      // 初期実装では orchestrator-workers を推奨
      return 'orchestrator-workers'

    case 'XL':
      // Extra Large: shogun または enterprise
      // 初期実装では shogun を推奨
      return 'shogun'

    default:
      const _exhaustive: never = difficulty
      return _exhaustive
  }
}

/**
 * Issue ラベルから難易度を抽出し、推奨 Strategy を返します。
 * ワンステップの便利関数。
 */
export function selectStrategyByDifficulty(issue: IssueInfo): string {
  const difficulty = extractDifficulty(issue.labels)
  return getRecommendedStrategy(difficulty)
}

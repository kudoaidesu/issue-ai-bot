/**
 * ショーグンがBashツール経由で呼び出すキュー登録CLI
 *
 * 使用例（ショーグンのBashツールから）:
 *   npx tsx scripts/enqueue.ts 42 owner/repo medium
 *   npx tsx scripts/enqueue.ts 42 owner/repo high
 *   npx tsx scripts/enqueue.ts 42 owner/repo           # デフォルト: medium
 */

import { enqueue } from '../src/queue/processor.js'
import type { Priority } from '../src/queue/processor.js'

const [issueNumberStr, repository, priorityArg] = process.argv.slice(2)

if (!issueNumberStr || !repository) {
  console.error('Usage: npx tsx scripts/enqueue.ts <issueNumber> <owner/repo> [high|medium|low]')
  process.exit(1)
}

const issueNumber = parseInt(issueNumberStr, 10)
if (isNaN(issueNumber) || issueNumber <= 0) {
  console.error(`Invalid issue number: ${issueNumberStr}`)
  process.exit(1)
}

const validPriorities: Priority[] = ['high', 'medium', 'low']
const priority: Priority = validPriorities.includes(priorityArg as Priority)
  ? (priorityArg as Priority)
  : 'medium'

const item = enqueue(issueNumber, repository, priority)

if (!item) {
  console.log(`SKIPPED: Issue #${issueNumber} (${repository}) は既にキューに存在します`)
  process.exit(0)
}

console.log(`QUEUED: Issue #${issueNumber} (${repository}) [${priority}] id=${item.id}`)

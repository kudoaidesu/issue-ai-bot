/**
 * ショーグンがBashツール経由で呼び出す即時処理CLI
 *
 * ダッシュボードAPIを通じて processImmediate を起動する。
 * ロック中の場合は高優先度（high）キューに自動フォールバックする。
 *
 * 使用例:
 *   npx tsx scripts/process-immediate.ts 42 owner/repo
 */

const [issueNumberStr, repository] = process.argv.slice(2)

if (!issueNumberStr || !repository) {
  console.error('Usage: npx tsx scripts/process-immediate.ts <issueNumber> <owner/repo>')
  process.exit(1)
}

const issueNumber = parseInt(issueNumberStr, 10)
if (isNaN(issueNumber) || issueNumber <= 0) {
  console.error(`Invalid issue number: ${issueNumberStr}`)
  process.exit(1)
}

const port = process.env.DASHBOARD_PORT ?? '3000'
const url = `http://127.0.0.1:${port}/api/process-immediate`

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ issueNumber, repository }),
  })

  if (!res.ok) {
    console.error(`API error: ${res.status} ${res.statusText}`)
    process.exit(1)
  }

  const data = await res.json() as { status: string; fallback?: string }

  if (data.status === 'started') {
    console.log(`IMMEDIATE: Issue #${issueNumber} (${repository}) の即時処理を開始しました`)
  } else {
    console.log(`QUEUED_HIGH: Issue #${issueNumber} (${repository}) を高優先度キューに追加しました (reason: ${data.status})`)
  }
} catch (err) {
  console.error(`Failed to reach dashboard API at ${url}: ${err}`)
  process.exit(1)
}

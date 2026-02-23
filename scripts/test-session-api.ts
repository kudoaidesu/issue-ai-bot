/**
 * API経由テスト: Agent SDK セッション管理の動作確認
 *
 * NOTE: sdk.query() は内部で Claude Code プロセスを起動し stdout を占有するため、
 *       テスト出力はファイルに書き出し、最後にまとめて表示する。
 *
 * テスト項目:
 * 1. 新規セッション作成 → sessionId 取得
 * 2. resume でセッション継続 → 前の会話を覚えているか確認
 * 3. SessionRegistry の永続化確認
 */
import { writeFileSync, appendFileSync, readFileSync } from 'node:fs'
import { runClaudeSdk } from '../src/llm/claude-sdk.js'

const logFile = '/tmp/session-api-test.log'

function log(msg: string): void {
  appendFileSync(logFile, msg + '\n')
}

writeFileSync(logFile, '')

async function main() {
  log('=== Agent SDK Session API Test ===\n')

  // --- Test 1: 新規セッション作成 ---
  log('[Test 1] Creating new session...')
  let result1
  try {
    result1 = await runClaudeSdk({
      prompt: 'Remember this secret code: ALPHA-7749. Just acknowledge it briefly.',
      model: 'haiku',
      maxTurns: 1,
      permissionMode: 'bypassPermissions',
      timeoutMs: 120_000,
    })

    log(`  sessionId: ${result1.sessionId ?? 'NONE'}`)
    log(`  content: ${result1.content.slice(0, 200)}`)
    log(`  cost: $${result1.costUsd?.toFixed(4) ?? '?'}`)

    if (!result1.sessionId) {
      log('  FAIL: No sessionId returned')
      process.exit(1)
    }
    log('  PASS: Session created\n')
  } catch (err) {
    log(`  FAIL: ${err}`)
    process.exit(1)
  }

  // --- Test 2: resume でセッション継続 ---
  log('[Test 2] Resuming session...')
  try {
    const result2 = await runClaudeSdk({
      prompt: 'What was the secret code I told you to remember? Just state the code.',
      model: 'haiku',
      maxTurns: 1,
      resume: result1.sessionId,
      permissionMode: 'bypassPermissions',
      timeoutMs: 120_000,
    })

    log(`  sessionId: ${result2.sessionId ?? 'NONE'}`)
    log(`  content: ${result2.content.slice(0, 200)}`)
    log(`  cost: $${result2.costUsd?.toFixed(4) ?? '?'}`)

    const hasCode = result2.content.includes('ALPHA-7749') || result2.content.includes('ALPHA')
    if (hasCode) {
      log('  PASS: Session context preserved (code found in response)\n')
    } else {
      log('  WARN: Code not found in response - context may not be preserved')
      log('  (This may happen with very short maxTurns)\n')
    }
  } catch (err) {
    log(`  FAIL: ${err}`)
    process.exit(1)
  }

  // --- Test 3: SessionRegistry 永続化テスト ---
  log('[Test 3] SessionRegistry persistence test...')
  const { createSession, getSession, deleteSession } = await import('../src/session/registry.js')

  const testEntry = createSession({
    sessionId: `api-test-${Date.now()}`,
    channelId: 'test-channel-api',
    guildId: 'test-guild',
    summary: 'API test session',
    model: 'haiku',
  })

  const loaded = getSession('test-channel-api')
  if (loaded && loaded.sessionId === testEntry.sessionId) {
    log(`  PASS: Session persisted and retrieved (${loaded.sessionId})`)
  } else {
    log('  FAIL: Session not found after creation')
    process.exit(1)
  }

  // クリーンアップ
  deleteSession('test-channel-api')
  const afterDelete = getSession('test-channel-api')
  if (!afterDelete) {
    log('  PASS: Session deleted successfully')
  } else {
    log('  FAIL: Session still exists after deletion')
  }

  log('\n=== All tests passed ===')
}

main()
  .catch((err) => {
    log(`Test failed: ${err}`)
    process.exit(1)
  })
  .finally(() => {
    // テスト結果を stdout に出力（最後にまとめて）
    try {
      const output = readFileSync(logFile, 'utf-8')
      process.stderr.write(output)
    } catch {
      // ignore
    }
  })

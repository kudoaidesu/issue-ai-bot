import { execFile } from 'node:child_process'
import { createLogger } from '../utils/logger.js'

const log = createLogger('github-pulls')

function gh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`gh command failed: ${stderr || error.message}`))
        return
      }
      resolve(stdout.trim())
    })
  })
}

/**
 * PR URL からリポジトリと PR 番号を抽出し、gh pr merge を実行する。
 * Draft PR の場合は ready にしてからマージする。
 */
export async function mergePr(prUrl: string): Promise<void> {
  const match = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
  if (!match) {
    throw new Error(`Invalid PR URL: ${prUrl}`)
  }

  const repo = match[1]
  const prNumber = match[2]

  // Draft を ready にする（既に ready でもエラーにならないよう catch）
  try {
    await gh(['pr', 'ready', prNumber, '--repo', repo])
    log.info(`PR #${prNumber} marked as ready`)
  } catch {
    log.info(`PR #${prNumber} may already be ready, continuing`)
  }

  await gh(['pr', 'merge', prNumber, '--repo', repo, '--squash', '--delete-branch'])
  log.info(`PR #${prNumber} merged and branch deleted`)
}

/**
 * ブランチ保護ルールを設定するワンショットスクリプト
 *
 * Usage: npx tsx src/scripts/setup-branch-protection.ts [owner/repo]
 *
 * - main: PR必須 + レビュー1名必須
 * - develop: PR必須
 */

import { execFileSync } from 'node:child_process'

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf-8' }).trim()
}

function getRepo(): string {
  const arg = process.argv[2]
  if (arg) return arg

  const json = gh(['repo', 'view', '--json', 'nameWithOwner'])
  return (JSON.parse(json) as { nameWithOwner: string }).nameWithOwner
}

function setupBranchProtection(repo: string, branch: string, requireReview: boolean): void {
  const [owner, repoName] = repo.split('/')

  const body: Record<string, unknown> = {
    required_status_checks: null,
    enforce_admins: false,
    required_pull_request_reviews: requireReview
      ? {
          required_approving_review_count: 1,
          dismiss_stale_reviews: true,
        }
      : null,
    restrictions: null,
  }

  console.log(`Setting up branch protection for ${owner}/${repoName}:${branch}...`)

  try {
    gh([
      'api',
      `repos/${owner}/${repoName}/branches/${branch}/protection`,
      '--method', 'PUT',
      '--input', '-',
    ])
    // Note: gh api --input - reads from stdin, so we use a different approach
  } catch {
    // Use the raw body approach
    const bodyStr = JSON.stringify(body)
    execFileSync('gh', [
      'api',
      `repos/${owner}/${repoName}/branches/${branch}/protection`,
      '--method', 'PUT',
      '-H', 'Accept: application/vnd.github+json',
      '--input', '-',
    ], {
      input: bodyStr,
      encoding: 'utf-8',
    })
  }

  console.log(`  Branch protection set for ${branch}`)
}

function main(): void {
  const repo = getRepo()
  console.log(`Repository: ${repo}`)
  console.log('')

  try {
    setupBranchProtection(repo, 'main', true)
  } catch (err) {
    console.error(`  Failed to set protection for main: ${err instanceof Error ? err.message : err}`)
  }

  try {
    setupBranchProtection(repo, 'develop', false)
  } catch (err) {
    console.error(`  Failed to set protection for develop: ${err instanceof Error ? err.message : err}`)
  }

  console.log('')
  console.log('Done. Verify with: gh api repos/<owner>/<repo>/branches/<branch>/protection')
}

main()

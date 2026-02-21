import { execFile } from 'node:child_process'
import { createLogger } from '../utils/logger.js'

const log = createLogger('github')

export interface CreateIssueParams {
  title: string
  body: string
  labels?: string[]
}

export interface IssueInfo {
  number: number
  title: string
  state: string
  body: string | null
  labels: string[]
  htmlUrl: string
}

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

interface GhIssueJson {
  number: number
  title: string
  state: string
  body: string
  labels: Array<{ name: string }>
  url: string
}

export async function createIssue(params: CreateIssueParams): Promise<IssueInfo> {
  const args = ['issue', 'create', '--title', params.title, '--body', params.body]

  for (const label of params.labels ?? []) {
    args.push('--label', label)
  }

  // gh issue create は URL を返す。--json 非対応なので URL からIssue番号を取得
  const url = await gh(args)
  const issueNumber = Number(url.split('/').pop())

  log.info(`Issue #${issueNumber} created: ${params.title}`)

  // 作成直後のIssue情報を取得
  return getIssue(issueNumber)
}

export async function getIssue(issueNumber: number): Promise<IssueInfo> {
  const json = await gh([
    'issue', 'view', String(issueNumber),
    '--json', 'number,title,state,body,labels,url',
  ])

  const data = JSON.parse(json) as GhIssueJson
  return toIssueInfo(data)
}

export async function updateIssueState(
  issueNumber: number,
  state: 'open' | 'closed',
): Promise<void> {
  const subcommand = state === 'closed' ? 'close' : 'reopen'
  await gh(['issue', subcommand, String(issueNumber)])

  log.info(`Issue #${issueNumber} → ${state}`)
}

export async function addComment(
  issueNumber: number,
  comment: string,
): Promise<void> {
  await gh(['issue', 'comment', String(issueNumber), '--body', comment])

  log.info(`Comment added to Issue #${issueNumber}`)
}

function toIssueInfo(data: GhIssueJson): IssueInfo {
  return {
    number: data.number,
    title: data.title,
    state: data.state,
    body: data.body ?? null,
    labels: data.labels.map((l) => l.name),
    htmlUrl: data.url,
  }
}

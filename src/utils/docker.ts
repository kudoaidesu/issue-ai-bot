import { execFile } from 'node:child_process'
import { createLogger } from './logger.js'

const log = createLogger('docker')

const CONTAINER_NAME = 'issue-ai-sandbox'
const TIMEOUT_MS = 10 * 60 * 1000 // 10分

export interface DockerRunOptions {
  command: string
  cwd?: string
  timeoutMs?: number
}

export interface DockerRunResult {
  stdout: string
  stderr: string
  exitCode: number
}

export function isSandboxAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('docker', ['info'], (error) => {
      resolve(!error)
    })
  })
}

export function runInDocker(options: DockerRunOptions): Promise<DockerRunResult> {
  const timeout = options.timeoutMs ?? TIMEOUT_MS
  const args = [
    'exec',
    ...(options.cwd ? ['-w', options.cwd] : []),
    CONTAINER_NAME,
    'bash', '-c', options.command,
  ]

  log.info(`Docker exec: ${options.command.slice(0, 100)}`)

  return new Promise((resolve, reject) => {
    const proc = execFile(
      'docker',
      args,
      { maxBuffer: 10 * 1024 * 1024, timeout },
      (error, stdout, stderr) => {
        const exitCode = error && 'code' in error ? (error.code as number) : 0
        resolve({ stdout, stderr, exitCode })
      },
    )

    // タイムアウト時のクリーンアップ
    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(new Error(`Docker exec timed out after ${timeout}ms`))
    }, timeout + 1000)

    proc.on('exit', () => clearTimeout(timer))
  })
}

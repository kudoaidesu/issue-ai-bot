import 'dotenv/config'
import { existsSync, mkdirSync } from 'node:fs'

const CLAUDE_USAGE_URL = 'https://claude.ai/settings/usage'
const CODEX_USAGE_URL = 'https://chatgpt.com/codex/settings/usage'
const DEFAULT_USER_DATA_DIR = './data/chrome-usage-profile'

async function main(): Promise<void> {
  const { chromium } = await import('playwright')
  const userDataDir = process.env.USAGE_CHROME_USER_DATA_DIR ?? DEFAULT_USER_DATA_DIR

  if (!existsSync(userDataDir)) {
    mkdirSync(userDataDir, { recursive: true })
  }

  console.log('Usage Monitor 用の Chrome プロファイルをセットアップします。')
  console.log('以下のサイトにログインしてください:')
  console.log(`  1. ${CLAUDE_USAGE_URL}`)
  console.log(`  2. ${CODEX_USAGE_URL}`)
  console.log('ログイン完了後、ブラウザを閉じてください。')

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  })

  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(CLAUDE_USAGE_URL)

  await new Promise<void>((resolve) => {
    context.on('close', () => resolve())
  })

  console.log('プロファイルを保存しました。Usage Monitor の準備完了です。')
}

main().catch((err: unknown) => {
  console.error('セットアップ失敗:', err)
  process.exit(1)
})

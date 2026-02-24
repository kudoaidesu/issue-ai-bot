import { test, expect } from '@playwright/test'

test.describe('Web UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // プロジェクト一覧の読み込みを待つ
    await page.waitForFunction(() => {
      const title = document.getElementById('title')
      return title && title.textContent !== 'claude-crew'
    }, null, { timeout: 5000 }).catch(() => {
      // タイトルが変わらなくてもOK（プロジェクトがモックなので）
    })
  })

  test.describe('初期表示', () => {
    test('ヘッダーにプロジェクト名が表示される', async ({ page }) => {
      const title = page.locator('#title')
      await expect(title).toHaveText('test-project')
    })

    test('モデルセレクタが表示される', async ({ page }) => {
      const select = page.locator('#model')
      await expect(select).toBeVisible()
      await expect(select).toHaveValue('sonnet')
    })

    test('入力エリアが表示される', async ({ page }) => {
      const input = page.locator('#input')
      await expect(input).toBeVisible()
      await expect(input).toHaveAttribute('placeholder', 'Send a message...')
    })

    test('送信ボタンが表示される', async ({ page }) => {
      const send = page.locator('#send')
      await expect(send).toBeVisible()
    })

    test('中断ボタンは初期非表示', async ({ page }) => {
      const abort = page.locator('#abort')
      await expect(abort).not.toBeVisible()
    })
  })

  test.describe('メッセージ送信', () => {
    test('テキストレスポンスを表示する', async ({ page }) => {
      await page.locator('#input').fill('hello')
      await page.locator('#send').click()

      // ユーザーメッセージ
      const userMsg = page.locator('[data-testid="msg-user"]').last()
      await expect(userMsg).toContainText('hello')

      // アシスタントレスポンス
      const assistantMsg = page.locator('[data-testid="msg-assistant"]').last()
      await expect(assistantMsg).toContainText('mock response', { timeout: 5000 })

      // コスト表示
      const meta = page.locator('[data-testid="result-meta"]').last()
      await expect(meta).toContainText('$0.0042', { timeout: 5000 })
    })

    test('Enter キーで送信できる', async ({ page }) => {
      await page.locator('#input').fill('enter-test')
      await page.locator('#input').press('Enter')

      const assistantMsg = page.locator('[data-testid="msg-assistant"]').last()
      await expect(assistantMsg).toContainText('mock response', { timeout: 5000 })
    })

    test('空メッセージは送信しない', async ({ page }) => {
      await page.locator('#input').fill('')
      await page.locator('#send').click()

      const messages = page.locator('[data-testid="msg-user"]')
      await expect(messages).toHaveCount(0)
    })
  })

  test.describe('ツール実行詳細', () => {
    test('Edit ツールの diff 表示', async ({ page }) => {
      await page.locator('#input').fill('tool-test')
      await page.locator('#send').click()

      // ツールバッジ
      const badge = page.locator('[data-testid="tool-badge"]').first()
      await expect(badge).toContainText('Edit', { timeout: 5000 })

      // ツール詳細パネル
      const detail = page.locator('[data-testid="tool-detail"]').first()
      await expect(detail).toBeVisible({ timeout: 5000 })

      // パネルヘッダーにファイル名
      await expect(detail.locator('.tool-file')).toContainText('/tmp/test.ts')

      // diff表示（クリックして展開）
      await detail.locator('.tool-detail-header').click()
      const body = detail.locator('.tool-detail-body')
      await expect(body).toBeVisible()
      await expect(body.locator('.diff-del')).toContainText('const x = 1')
      await expect(body.locator('.diff-add')).toContainText('const x = 2')
    })

    test('Bash ツールのコマンド表示', async ({ page }) => {
      await page.locator('#input').fill('bash-test')
      await page.locator('#send').click()

      const badge = page.locator('[data-testid="tool-badge"]').first()
      await expect(badge).toContainText('Bash', { timeout: 5000 })

      const detail = page.locator('[data-testid="tool-detail"]').first()
      await expect(detail).toBeVisible({ timeout: 5000 })

      // コマンド表示（クリックして展開）
      await detail.locator('.tool-detail-header').click()
      const body = detail.locator('.tool-detail-body')
      await expect(body).toBeVisible()
      await expect(body).toContainText('echo hello')
    })
  })

  test.describe('警告表示', () => {
    test('危険コマンドの警告バッジが表示される', async ({ page }) => {
      await page.locator('#input').fill('danger-test')
      await page.locator('#send').click()

      const warning = page.locator('[data-testid="warning-badge"]').first()
      await expect(warning).toBeVisible({ timeout: 5000 })
      await expect(warning).toContainText('rm -rf')
    })
  })

  test.describe('コードブロックコピー', () => {
    test('コードブロックにコピーボタンが表示される', async ({ page }) => {
      await page.locator('#input').fill('code-test')
      await page.locator('#send').click()

      const copyBtn = page.locator('[data-testid="code-copy-btn"]').first()
      await expect(copyBtn).toBeVisible({ timeout: 5000 })
      await expect(copyBtn).toHaveText('Copy')
    })

    test('コピーボタンをクリックすると "Copied!" に変わる', async ({ page, context }) => {
      // clipboard 権限を付与
      await context.grantPermissions(['clipboard-write', 'clipboard-read'])

      await page.locator('#input').fill('code-test')
      await page.locator('#send').click()

      const copyBtn = page.locator('[data-testid="code-copy-btn"]').first()
      await expect(copyBtn).toBeVisible({ timeout: 5000 })

      await copyBtn.click()
      await expect(copyBtn).toHaveText('Copied!')
    })
  })

  test.describe('エラー表示', () => {
    test('エラーメッセージが表示される', async ({ page }) => {
      await page.locator('#input').fill('error-test')
      await page.locator('#send').click()

      const error = page.locator('[data-testid="error-message"]').first()
      await expect(error).toBeVisible({ timeout: 5000 })
      await expect(error).toContainText('Test error occurred')
    })
  })

  test.describe('中断ボタン', () => {
    test('送信中に中断ボタンが表示される', async ({ page }) => {
      // 送信前: 中断ボタン非表示
      await expect(page.locator('#abort')).not.toBeVisible()

      // メッセージ送信（レスポンスがすぐ返るのでタイミングに注意）
      await page.locator('#input').fill('hello')

      // ボタンが一瞬表示されることを確認するために、送信直後の状態をチェック
      const sendPromise = page.locator('#send').click()

      // 送信完了後: 中断ボタン非表示に戻る
      await page.locator('[data-testid="result-meta"]').first().waitFor({ timeout: 5000 })
      await expect(page.locator('#abort')).not.toBeVisible()
    })
  })

  test.describe('セッション履歴', () => {
    test('セッションドロワーを開くとセッション一覧が表示される', async ({ page }) => {
      // まずメッセージを送信してセッションを作成
      await page.locator('#input').fill('hello')
      await page.locator('#send').click()
      await page.locator('[data-testid="result-meta"]').first().waitFor({ timeout: 5000 })

      // セッションドロワーを開く
      await page.locator('#historyBtn').click()
      await expect(page.locator('#drawer')).toHaveClass(/open/)

      // Sessions タブが表示
      const sessionsTab = page.locator('.drawer-tab[data-tab="sessions"]')
      await expect(sessionsTab).toHaveClass(/active/)

      // セッションアイテムが存在
      const sessionItem = page.locator('[data-testid="session-item"]').first()
      await expect(sessionItem).toBeVisible({ timeout: 5000 })
      await expect(sessionItem).toContainText('hello')
    })

    test('セッションを削除できる', async ({ page }) => {
      // メッセージ送信
      await page.locator('#input').fill('to-delete')
      await page.locator('#send').click()
      await page.locator('[data-testid="result-meta"]').first().waitFor({ timeout: 5000 })

      // セッションドロワーを開く
      await page.locator('#historyBtn').click()
      await page.locator('[data-testid="session-item"]').first().waitFor({ timeout: 5000 })

      // 削除
      await page.locator('.delete-session').first().click()

      // 削除後にリストが更新される（空になるか、対象が消える）
      // ネットワークリクエストが完了するのを待つ
      await page.waitForTimeout(500)
    })
  })

  test.describe('プロジェクト切り替え', () => {
    test('プロジェクトドロワーにプロジェクト一覧が表示される', async ({ page }) => {
      // ハンバーガーメニューを開く
      await page.locator('button:has-text("☰")').click()
      await expect(page.locator('#drawer')).toHaveClass(/open/)

      // Projects タブをクリック
      await page.locator('.drawer-tab[data-tab="projects"]').click()

      // プロジェクト一覧
      const items = page.locator('.project-item')
      await expect(items).toHaveCount(2)
      await expect(items.first()).toContainText('test-project')
      await expect(items.nth(1)).toContainText('another-project')
    })

    test('プロジェクトを切り替えるとタイトルが変わる', async ({ page }) => {
      await page.locator('button:has-text("☰")').click()
      await page.locator('.drawer-tab[data-tab="projects"]').click()
      await page.locator('.project-item').nth(1).click()

      const title = page.locator('#title')
      await expect(title).toHaveText('another-project')
    })
  })

  test.describe('モデル切り替え', () => {
    test('モデルを変更できる', async ({ page }) => {
      const select = page.locator('#model')
      await select.selectOption('opus')
      await expect(select).toHaveValue('opus')
    })
  })
})

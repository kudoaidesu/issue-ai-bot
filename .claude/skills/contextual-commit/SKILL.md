---
name: contextual-commit
description: |
  コミット履歴にコンテキスト（何を・なぜ・設計判断）を残す構造化コミット＋PR作成ワークフロー。
  大量の未コミット変更を論理単位に分割し、featureブランチ→段階的コミット→PRの流れで整理する。
  トリガー: 「コミットして」「プッシュして」「PRにして」「コミット履歴を残して」「変更をまとめて」
  「ブランチ切って」「コンテキスト付きでコミット」「履歴がわかるように」。
  通常の1ファイル修正の小さなコミットには不要。複数ファイルにまたがる機能実装や
  リファクタリングなど、コミット分割が有効な場面で使用する。
---

# Contextual Commit ワークフロー

コミット履歴を「将来の自分やAIが読んで文脈を復元できる」品質で残す。

## 前提チェック

```bash
# 1. 変更量の把握
git status                    # 変更ファイル一覧
git diff --stat HEAD          # 変更行数サマリ
git log --oneline -5          # 直近コミット確認

# 2. マージ先ブランチの確認（必須）
git branch -a                 # ブランチ一覧
# CLAUDE.md や CONTRIBUTING.md にブランチ戦略の記載を確認する。
# 明記されていればそれに従う。
# 明記されていなければ、AskUserQuestion でユーザーに選択させる:
#   - マージ先ブランチ（main / develop / release 等）
#   - ブランチ命名規則（feature/* / feat/* / fix/* 等）
# ※ 推測で決めない。必ずユーザーに選ばせる。

# 3. リモート認証の確認（pushする場合）
git remote -v                 # リモートURL
gh auth status                # アクティブアカウント確認
# アカウントが違う場合: gh auth switch --user <account>
```

## コミット分割の原則

### 分割単位（依存順に並べる）

| 順序 | カテゴリ | 例 |
|-----|---------|---|
| 1 | 基盤・設定 | package.json, tsconfig, .env, CI設定 |
| 2 | 共通ユーティリティ | config, logger, 型定義, 共通関数 |
| 3 | コアロジック | ビジネスロジック、データ層、API |
| 4 | UI・インターフェース | コマンド、ハンドラ、画面 |
| 5 | エントリーポイント | main, index, 初期化処理 |
| 6 | ドキュメント | README, CLAUDE.md, 設計ドキュメント |

**依存の下流から上流へコミットする。** 各コミットが単独でビルド可能である必要はないが、
変更の意図が1コミット=1トピックで明確であること。

### 分割しないケース

- 変更が1-3ファイルで1トピックに収まる → 1コミットでOK
- 型定義と実装が密結合 → 同じコミットに含める

## コミットメッセージの書き方

```
<type>: <日本語で簡潔な要約>

<何をしたか — 箇条書きで構造を示す>

<なぜそうしたか — 設計判断・トレードオフ・背景>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

### type

`feat` / `fix` / `refactor` / `docs` / `test` / `chore`

### 良いメッセージの条件

1. **要約行で全体像がわかる**: 「feat: Discord Bot を実装」
2. **本文で構造がわかる**: 何のファイルが何の役割か箇条書き
3. **設計判断が残る**: なぜその技術選択をしたか、なぜその構造か
4. **将来の検索性**: grepで見つかるキーワードを含む

### 例

```
feat: GitHub Issue CRUD を gh CLI 経由で実装

CLI-First 思想に基づき、Octokit SDK ではなく `gh` CLI を使用。
GITHUB_TOKEN の環境変数管理が不要になり、`gh auth login` の
認証セッションをそのまま利用する。

- createIssue(): `gh issue create --title --body --label`
- getIssue(): `gh issue view <number> --json`
- updateIssueState(): `gh issue close/reopen`
- addComment(): `gh issue comment <number> --body`

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

## ブランチ + PR の流れ

```bash
# 1. マージ先ブランチの確認（必須 — 推測で決めない）
#    CLAUDE.md / CONTRIBUTING.md のブランチ戦略を確認する。
#    明記されていればそれに従う。
#    明記されていなければ AskUserQuestion で選択させる:
#      question: "どのブランチにマージしますか？"
#      options: 既存ブランチ一覧から候補を提示
#              (main, develop, staging 等)

# 2. featureブランチ作成（命名規則もプロジェクトに従う）
git checkout -b feature/<topic> <base-branch>

# 3. 論理単位でステージ→コミット（上の分割順序に従う）
git add <files>
git commit -m "$(cat <<'EOF'
<message>
EOF
)"

# 4. リモートアカウント確認 → push
gh auth status
git push -u origin feature/<topic>

# 5. PR作成（--base でマージ先を明示）
gh pr create --base <target-branch> --title "<短いタイトル>" --body "$(cat <<'EOF'
## Summary
<箇条書きで変更概要>

### コミット一覧
| コミット | 内容 |
|---------|------|
| `feat: ...` | ... |
| `feat: ...` | ... |

## Test plan
- [ ] テスト項目1
- [ ] テスト項目2

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## PR本文の書き方

- **Summary**: 全コミットの俯瞰。「何が変わったか」を3行以内で
- **コミット一覧テーブル**: 各コミットの1行要約。レビュアーが流れを追える
- **設計判断**（大きな変更時）: なぜこのアプローチを選んだか
- **Test plan**: チェックリスト形式。手動確認項目を明記

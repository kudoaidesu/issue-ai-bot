import type { ChannelInfo } from './api.js'

export function renderDashboard(channels: ChannelInfo[]): string {
  const channelItems = channels.map((ch) => {
    const lastAct = ch.lastActivity
      ? new Date(ch.lastActivity).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
      : '—'
    return `<li class="channel-item" onclick="loadConversation('${ch.guildId}', '${ch.channelId}')">
      <span class="channel-name">#${ch.channelId.slice(-6)}</span>
      <span class="channel-meta">${ch.messageCount}件 · ${lastAct}</span>
    </li>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>issue-ai-bot ダッシュボード</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e2e8f0; height: 100vh; display: flex; flex-direction: column; }
    header { background: #1a1d27; border-bottom: 1px solid #2d3148; padding: 12px 24px; display: flex; align-items: center; gap: 16px; }
    header h1 { font-size: 18px; font-weight: 700; color: #818cf8; }
    nav { display: flex; gap: 4px; margin-left: auto; }
    nav button { background: transparent; border: 1px solid #2d3148; color: #94a3b8; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; transition: all 0.15s; }
    nav button:hover, nav button.active { background: #4f46e5; border-color: #4f46e5; color: #fff; }
    .layout { display: flex; flex: 1; overflow: hidden; }
    .sidebar { width: 280px; background: #13151f; border-right: 1px solid #2d3148; overflow-y: auto; flex-shrink: 0; }
    .sidebar-header { padding: 16px; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #2d3148; }
    .channel-list { list-style: none; padding: 8px; }
    .channel-item { padding: 10px 12px; border-radius: 8px; cursor: pointer; transition: background 0.1s; }
    .channel-item:hover { background: #1e2235; }
    .channel-item.selected { background: #2d3148; }
    .channel-name { display: block; font-size: 13px; font-weight: 500; color: #c7d2fe; }
    .channel-meta { display: block; font-size: 11px; color: #64748b; margin-top: 2px; }
    .main { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
    .tab-content { display: none; flex: 1; overflow-y: auto; padding: 24px; }
    .tab-content.active { display: flex; flex-direction: column; }
    .messages { display: flex; flex-direction: column; gap: 12px; }
    .message { border-radius: 10px; padding: 14px 16px; max-width: 80%; line-height: 1.6; font-size: 14px; }
    .message.user { background: #1e3a5f; align-self: flex-end; border-bottom-right-radius: 2px; }
    .message.assistant { background: #1a1d27; border: 1px solid #2d3148; align-self: flex-start; border-bottom-left-radius: 2px; }
    .message-header { font-size: 11px; color: #64748b; margin-bottom: 6px; display: flex; gap: 8px; }
    .message-header .role { font-weight: 600; color: #818cf8; }
    .message-header .role.user { color: #38bdf8; }
    .message-content { white-space: pre-wrap; word-break: break-word; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: #1a1d27; border: 1px solid #2d3148; border-radius: 10px; padding: 20px; }
    .stat-label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-value { font-size: 28px; font-weight: 700; color: #818cf8; margin-top: 8px; }
    .stat-sub { font-size: 12px; color: #64748b; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #1a1d27; padding: 10px 14px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; border-bottom: 1px solid #2d3148; }
    td { padding: 10px 14px; border-bottom: 1px solid #1e2235; color: #cbd5e1; }
    tr:hover td { background: #1a1d27; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge-success { background: #052e16; color: #4ade80; }
    .badge-error { background: #450a0a; color: #f87171; }
    .badge-allow { background: #052e16; color: #4ade80; }
    .badge-block { background: #450a0a; color: #f87171; }
    .empty { text-align: center; color: #64748b; padding: 60px 0; font-size: 14px; }
    .loading { text-align: center; color: #64748b; padding: 40px; font-size: 14px; }
    .section-title { font-size: 14px; font-weight: 600; color: #94a3b8; margin-bottom: 12px; }
    .progress-bar { background: #1e2235; border-radius: 4px; height: 8px; overflow: hidden; margin-top: 8px; }
    .progress-fill { height: 100%; background: #4f46e5; border-radius: 4px; transition: width 0.3s; }
    .limit-selector { margin-bottom: 16px; display: flex; align-items: center; gap: 10px; font-size: 13px; color: #64748b; }
    .limit-selector select { background: #1a1d27; border: 1px solid #2d3148; color: #e2e8f0; padding: 4px 10px; border-radius: 6px; font-size: 13px; }
  </style>
</head>
<body>
<header>
  <h1>🤖 issue-ai-bot</h1>
  <span style="color:#64748b;font-size:13px;">ダッシュボード</span>
  <nav>
    <button class="active" onclick="showTab('chat')">💬 チャット履歴</button>
    <button onclick="showTab('costs')">💰 コスト</button>
    <button onclick="showTab('audit')">🔍 監査ログ</button>
  </nav>
</header>
<div class="layout">
  <aside class="sidebar">
    <div class="sidebar-header">チャンネル (${channels.length})</div>
    <ul class="channel-list">${channelItems || '<li style="padding:16px;color:#64748b;font-size:13px;">会話履歴なし</li>'}</ul>
  </aside>
  <main class="main">
    <div id="tab-chat" class="tab-content active">
      <div id="chat-area" class="messages">
        <div class="empty">👆 左のチャンネルを選択してください</div>
      </div>
    </div>
    <div id="tab-costs" class="tab-content">
      <div id="costs-area"><div class="loading">読み込み中...</div></div>
    </div>
    <div id="tab-audit" class="tab-content">
      <div class="limit-selector">
        表示件数:
        <select id="audit-limit" onchange="loadAudit()">
          <option value="50">50件</option>
          <option value="100" selected>100件</option>
          <option value="200">200件</option>
        </select>
      </div>
      <div id="audit-area"><div class="loading">読み込み中...</div></div>
    </div>
  </main>
</div>
<script>
function showTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'))
  document.querySelectorAll('nav button').forEach(el => el.classList.remove('active'))
  document.getElementById('tab-' + name).classList.add('active')
  event.target.classList.add('active')
  if (name === 'costs') loadCosts()
  if (name === 'audit') loadAudit()
}

function loadConversation(guildId, channelId) {
  document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('selected'))
  event.currentTarget.classList.add('selected')

  const area = document.getElementById('chat-area')
  area.innerHTML = '<div class="loading">読み込み中...</div>'

  fetch('/api/conversations/' + guildId + '/' + channelId + '?limit=100')
    .then(r => r.json())
    .then(data => {
      if (!data.messages || data.messages.length === 0) {
        area.innerHTML = '<div class="empty">メッセージがありません</div>'
        return
      }
      area.innerHTML = data.messages.map(m => {
        const time = new Date(m.timestamp).toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'})
        const name = m.username || (m.role === 'user' ? 'ユーザー' : 'アシスタント')
        return '<div class="message ' + m.role + '">' +
          '<div class="message-header">' +
          '<span class="role ' + m.role + '">' + (m.role === 'user' ? '👤 ' : '🤖 ') + name + '</span>' +
          '<span>' + time + '</span>' +
          (data.total > 100 ? '<span style="color:#4f46e5">最新100件 / 計' + data.total + '件</span>' : '') +
          '</div>' +
          '<div class="message-content">' + escapeHtml(m.content) + '</div>' +
          '</div>'
      }).join('')
      area.scrollTop = area.scrollHeight
    })
    .catch(() => { area.innerHTML = '<div class="empty">エラーが発生しました</div>' })
}

function loadCosts() {
  const area = document.getElementById('costs-area')
  area.innerHTML = '<div class="loading">読み込み中...</div>'
  fetch('/api/costs')
    .then(r => r.json())
    .then(data => {
      const barWidth = Math.min(data.dailyBudgetUsedPercent, 100).toFixed(1)
      let html = '<div class="stats-grid">' +
        '<div class="stat-card"><div class="stat-label">今日</div><div class="stat-value">$' + data.today.toFixed(2) + '</div>' +
        '<div class="stat-sub">日次予算消化率</div>' +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + barWidth + '%"></div></div>' +
        '<div class="stat-sub" style="margin-top:4px">' + data.dailyBudgetUsedPercent.toFixed(1) + '%</div></div>' +
        '<div class="stat-card"><div class="stat-label">今週</div><div class="stat-value">$' + data.thisWeek.toFixed(2) + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">今月</div><div class="stat-value">$' + data.thisMonth.toFixed(2) + '</div></div>' +
        '</div>'

      if (data.recentEntries && data.recentEntries.length > 0) {
        html += '<div class="section-title">直近の処理</div>' +
          '<table><thead><tr><th>日時</th><th>Issue</th><th>リポジトリ</th><th>コスト</th><th>時間</th><th>結果</th></tr></thead><tbody>' +
          data.recentEntries.map(e => {
            const t = new Date(e.timestamp).toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'})
            const dur = (e.durationMs / 1000).toFixed(1) + 's'
            const badge = e.success ? '<span class="badge badge-success">成功</span>' : '<span class="badge badge-error">失敗</span>'
            return '<tr><td>' + t + '</td><td>#' + e.issueNumber + '</td><td>' + e.repository + '</td><td>$' + e.costUsd.toFixed(4) + '</td><td>' + dur + '</td><td>' + badge + '</td></tr>'
          }).join('') +
          '</tbody></table>'
      } else {
        html += '<div class="empty">コスト履歴がありません</div>'
      }
      area.innerHTML = html
    })
    .catch(() => { area.innerHTML = '<div class="empty">エラーが発生しました</div>' })
}

function loadAudit() {
  const area = document.getElementById('audit-area')
  area.innerHTML = '<div class="loading">読み込み中...</div>'
  const limit = document.getElementById('audit-limit').value
  fetch('/api/audit?limit=' + limit)
    .then(r => r.json())
    .then(data => {
      if (!data || data.length === 0) {
        area.innerHTML = '<div class="empty">監査ログがありません</div>'
        return
      }
      area.innerHTML = '<table><thead><tr><th>日時</th><th>アクション</th><th>実行者</th><th>詳細</th><th>結果</th></tr></thead><tbody>' +
        data.map(e => {
          const t = new Date(e.timestamp).toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'})
          const badge = '<span class="badge badge-' + e.result + '">' + e.result + '</span>'
          return '<tr><td>' + t + '</td><td>' + escapeHtml(e.action) + '</td><td>' + escapeHtml(e.actor) + '</td><td>' + escapeHtml(e.detail) + '</td><td>' + badge + '</td></tr>'
        }).join('') +
        '</tbody></table>'
    })
    .catch(() => { area.innerHTML = '<div class="empty">エラーが発生しました</div>' })
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
</script>
</body>
</html>`
}

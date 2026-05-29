# Git Branch Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web app to view and switch branches across multiple git repos in one dashboard.

**Architecture:** Hono serves a REST API that shells out to git commands. A single HTML page with vanilla JS renders the dashboard and handles user interactions. No build step, no framework.

**Tech Stack:** Hono, @hono/node-server, child_process (execFile), vanilla HTML/JS/CSS

---

## File Structure

```
git-branch-manager/
├── package.json
├── server.js              — Hono app + API routes + static serving
└── public/
    └── index.html         — Single-page dashboard (HTML + CSS + JS inline)
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `server.js` (minimal hello world)

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "git-branch-manager",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "hono": "^4.7.0",
    "@hono/node-server": "^1.14.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd /Users/ext.zhengdixin1/code/git-branch-manager && npm install`
Expected: node_modules created, lock file generated

- [ ] **Step 3: Create minimal server.js**

```js
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'

const app = new Hono()

app.use('/public/*', serveStatic({ root: './' }))

app.get('/', (c) => c.redirect('/public/index.html'))

serve({ fetch: app.fetch, port: 3456 }, (info) => {
  console.log(`Git Branch Manager running at http://localhost:${info.port}`)
})

export default app
```

- [ ] **Step 4: Create placeholder index.html**

Create `public/index.html`:
```html
<!DOCTYPE html>
<html><head><title>Git Branch Manager</title></head>
<body><h1>Git Branch Manager</h1></body></html>
```

- [ ] **Step 5: Verify server starts**

Run: `cd /Users/ext.zhengdixin1/code/git-branch-manager && node server.js &`
Then: `curl http://localhost:3456/` — should 302 redirect
Then: `curl http://localhost:3456/public/index.html` — should return HTML
Kill the process after.

- [ ] **Step 6: Commit**

```bash
git init
git add package.json package-lock.json server.js public/index.html
git commit -m "feat: project scaffold with Hono server"
```

---

### Task 2: Git Helper Module (Backend API)

**Files:**
- Modify: `server.js` — add all API routes

The repos base path is `/Users/ext.zhengdixin1/code`. We scan for directories containing `.git`.

- [ ] **Step 1: Add git utility functions to server.js**

Add after imports in `server.js`:

```js
import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const REPOS_BASE = '/Users/ext.zhengdixin1/code'

function git(repoPath, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stdout.trim())
    })
  })
}

async function getRepos() {
  const entries = await readdir(REPOS_BASE, { withFileTypes: true })
  const repos = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const fullPath = join(REPOS_BASE, entry.name)
    try {
      await stat(join(fullPath, '.git'))
      repos.push({ name: entry.name, path: fullPath })
    } catch { /* not a git repo */ }
  }
  return repos
}
```

- [ ] **Step 2: Add GET /api/repos route**

```js
app.get('/api/repos', async (c) => {
  const repos = await getRepos()
  const result = await Promise.all(repos.map(async (repo) => {
    const branch = await git(repo.path, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const status = await git(repo.path, ['status', '--porcelain'])
    return {
      name: repo.name,
      path: repo.path,
      currentBranch: branch,
      dirty: status.length > 0
    }
  }))
  return c.json(result)
})
```

- [ ] **Step 3: Add GET /api/repos/:name/branches route**

```js
app.get('/api/repos/:name/branches', async (c) => {
  const repos = await getRepos()
  const repo = repos.find(r => r.name === c.req.param('name'))
  if (!repo) return c.json({ error: 'Repo not found' }, 404)

  const output = await git(repo.path, ['branch', '--list', '--format=%(refname:short)'])
  const branches = output.split('\n').filter(Boolean)
  return c.json(branches)
})
```

- [ ] **Step 4: Add POST /api/repos/:name/checkout route**

```js
app.post('/api/repos/:name/checkout', async (c) => {
  const repos = await getRepos()
  const repo = repos.find(r => r.name === c.req.param('name'))
  if (!repo) return c.json({ error: 'Repo not found' }, 404)

  const { branch } = await c.req.json()
  if (!branch) return c.json({ error: 'Branch required' }, 400)

  try {
    await git(repo.path, ['checkout', branch])
    return c.json({ success: true, branch })
  } catch (e) {
    return c.json({ error: e.message }, 400)
  }
})
```

- [ ] **Step 5: Add POST /api/repos/:name/stash route**

```js
app.post('/api/repos/:name/stash', async (c) => {
  const repos = await getRepos()
  const repo = repos.find(r => r.name === c.req.param('name'))
  if (!repo) return c.json({ error: 'Repo not found' }, 404)

  try {
    await git(repo.path, ['stash', 'push', '-m', `auto-stash before branch switch`])
    return c.json({ success: true })
  } catch (e) {
    return c.json({ error: e.message }, 400)
  }
})
```

- [ ] **Step 6: Add POST /api/batch-checkout route**

```js
app.post('/api/batch-checkout', async (c) => {
  const { branch, repoNames } = await c.req.json()
  if (!branch || !repoNames?.length) return c.json({ error: 'branch and repoNames required' }, 400)

  const repos = await getRepos()
  const results = await Promise.all(repoNames.map(async (name) => {
    const repo = repos.find(r => r.name === name)
    if (!repo) return { name, success: false, error: 'Not found' }
    try {
      await git(repo.path, ['checkout', branch])
      return { name, success: true }
    } catch (e) {
      return { name, success: false, error: e.message }
    }
  }))
  return c.json(results)
})
```

- [ ] **Step 7: Verify APIs work**

Run: `cd /Users/ext.zhengdixin1/code/git-branch-manager && node server.js &`
Then:
```bash
curl http://localhost:3456/api/repos | python3 -m json.tool
curl http://localhost:3456/api/repos/HerAPP/branches | python3 -m json.tool
```
Expected: JSON array of repos with branches. Kill process after.

- [ ] **Step 8: Commit**

```bash
git add server.js
git commit -m "feat: add git API routes (repos, branches, checkout, stash, batch)"
```

---

### Task 3: Frontend Dashboard

**Files:**
- Modify: `public/index.html` — full single-page app

- [ ] **Step 1: Write complete index.html**

The page includes:
- A header with title
- Status cards grid showing all repos (name, current branch, dirty indicator)
- Clicking a card expands branch list with search filter
- Batch checkout panel: branch input + repo checkboxes + execute button
- Modal dialog for dirty repo confirmation (stash / cancel)

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Git Branch Manager</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0f0f0f;
      --surface: #1a1a1a;
      --surface-hover: #242424;
      --border: #2a2a2a;
      --text: #e4e4e4;
      --text-muted: #888;
      --accent: #6c9eff;
      --accent-hover: #8ab4ff;
      --danger: #ff6b6b;
      --success: #69db7c;
      --radius: 10px;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 24px;
      min-height: 100vh;
    }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 24px; }
    .section-title { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 12px; }

    /* Batch Panel */
    .batch-panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px 20px;
      margin-bottom: 24px;
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    .batch-panel input[type="text"] {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      padding: 8px 12px;
      font-size: 0.9rem;
      width: 240px;
    }
    .batch-panel input[type="text"]:focus { outline: none; border-color: var(--accent); }
    .batch-panel button {
      background: var(--accent);
      color: #000;
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }
    .batch-panel button:hover { background: var(--accent-hover); }
    .batch-panel .repo-checks { display: flex; gap: 8px; flex-wrap: wrap; }
    .batch-panel label {
      font-size: 0.8rem;
      display: flex;
      align-items: center;
      gap: 4px;
      color: var(--text-muted);
      cursor: pointer;
    }
    .batch-panel label:hover { color: var(--text); }
    .select-all { font-size: 0.75rem; color: var(--accent); cursor: pointer; text-decoration: underline; }

    /* Repo Grid */
    .repo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
    .repo-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }
    .repo-card:hover { background: var(--surface-hover); border-color: var(--accent); }
    .repo-card.expanded { border-color: var(--accent); }
    .repo-card .header { display: flex; justify-content: space-between; align-items: center; }
    .repo-card .name { font-weight: 600; font-size: 0.95rem; }
    .repo-card .branch { font-size: 0.8rem; color: var(--accent); font-family: monospace; }
    .repo-card .dirty-badge {
      font-size: 0.7rem;
      background: var(--danger);
      color: #000;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
      margin-left: 8px;
    }

    /* Branch list inside card */
    .branch-list {
      margin-top: 12px;
      max-height: 200px;
      overflow-y: auto;
      border-top: 1px solid var(--border);
      padding-top: 8px;
    }
    .branch-list .search {
      width: 100%;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      padding: 6px 10px;
      font-size: 0.8rem;
      margin-bottom: 6px;
    }
    .branch-list .search:focus { outline: none; border-color: var(--accent); }
    .branch-item {
      padding: 5px 8px;
      font-size: 0.8rem;
      font-family: monospace;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.1s;
    }
    .branch-item:hover { background: var(--surface-hover); }
    .branch-item.current { color: var(--success); font-weight: 600; }

    /* Modal */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      justify-content: center;
      align-items: center;
      z-index: 100;
    }
    .modal-overlay.active { display: flex; }
    .modal {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      max-width: 400px;
      width: 90%;
    }
    .modal h3 { margin-bottom: 12px; font-size: 1rem; }
    .modal p { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 16px; }
    .modal .actions { display: flex; gap: 8px; justify-content: flex-end; }
    .modal button {
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 0.85rem;
      cursor: pointer;
      border: none;
      font-weight: 500;
    }
    .modal .btn-stash { background: var(--accent); color: #000; }
    .modal .btn-cancel { background: var(--border); color: var(--text); }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px 20px;
      font-size: 0.85rem;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.3s;
      z-index: 200;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
    .toast.success { border-color: var(--success); }
    .toast.error { border-color: var(--danger); }
  </style>
</head>
<body>
  <h1>Git Branch Manager</h1>

  <div class="section-title">批量切换</div>
  <div class="batch-panel">
    <input type="text" id="batchBranch" placeholder="输入分支名...">
    <span class="select-all" id="selectAll">全选</span>
    <div class="repo-checks" id="repoChecks"></div>
    <button id="batchBtn">批量切换</button>
  </div>

  <div class="section-title">仓库状态</div>
  <div class="repo-grid" id="repoGrid"></div>

  <div class="modal-overlay" id="modalOverlay">
    <div class="modal">
      <h3>检测到未提交的改动</h3>
      <p id="modalMsg"></p>
      <div class="actions">
        <button class="btn-cancel" id="modalCancel">取消</button>
        <button class="btn-stash" id="modalStash">Stash 并切换</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const API = ''
    let repos = []
    let pendingAction = null

    async function fetchRepos() {
      const res = await fetch(`${API}/api/repos`)
      repos = await res.json()
      render()
    }

    function render() {
      const grid = document.getElementById('repoGrid')
      grid.innerHTML = repos.map(repo => `
        <div class="repo-card" data-name="${repo.name}" onclick="toggleCard(this, '${repo.name}')">
          <div class="header">
            <span class="name">${repo.name}</span>
            <span>
              <span class="branch">${repo.currentBranch}</span>
              ${repo.dirty ? '<span class="dirty-badge">未提交</span>' : ''}
            </span>
          </div>
        </div>
      `).join('')

      const checks = document.getElementById('repoChecks')
      checks.innerHTML = repos.map(repo => `
        <label><input type="checkbox" value="${repo.name}" checked> ${repo.name}</label>
      `).join('')
    }

    async function toggleCard(el, name) {
      if (el.classList.contains('expanded')) {
        el.classList.remove('expanded')
        const list = el.querySelector('.branch-list')
        if (list) list.remove()
        return
      }

      document.querySelectorAll('.repo-card').forEach(c => {
        c.classList.remove('expanded')
        const l = c.querySelector('.branch-list')
        if (l) l.remove()
      })

      el.classList.add('expanded')
      const res = await fetch(`${API}/api/repos/${name}/branches`)
      const branches = await res.json()
      const repo = repos.find(r => r.name === name)

      const div = document.createElement('div')
      div.className = 'branch-list'
      div.innerHTML = `<input class="search" placeholder="搜索分支..." oninput="filterBranches(this)">` +
        branches.map(b => `<div class="branch-item${b === repo.currentBranch ? ' current' : ''}" onclick="event.stopPropagation(); switchBranch('${name}', '${b}')">${b}</div>`).join('')
      el.appendChild(div)
    }

    function filterBranches(input) {
      const val = input.value.toLowerCase()
      const items = input.parentElement.querySelectorAll('.branch-item')
      items.forEach(item => {
        item.style.display = item.textContent.toLowerCase().includes(val) ? '' : 'none'
      })
    }

    async function switchBranch(repoName, branch) {
      const repo = repos.find(r => r.name === repoName)
      if (repo.currentBranch === branch) return

      if (repo.dirty) {
        pendingAction = { type: 'single', repoName, branch }
        document.getElementById('modalMsg').textContent = `${repoName} 有未提交的改动，是否 stash 后再切换到 ${branch}？`
        document.getElementById('modalOverlay').classList.add('active')
        return
      }

      await doCheckout(repoName, branch)
    }

    async function doCheckout(repoName, branch) {
      try {
        const res = await fetch(`${API}/api/repos/${repoName}/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branch })
        })
        const data = await res.json()
        if (data.success) {
          showToast(`${repoName} 已切换到 ${branch}`, 'success')
          await fetchRepos()
        } else {
          showToast(`${repoName}: ${data.error}`, 'error')
        }
      } catch (e) {
        showToast(`错误: ${e.message}`, 'error')
      }
    }

    async function doStash(repoName) {
      const res = await fetch(`${API}/api/repos/${repoName}/stash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      return (await res.json()).success
    }

    // Batch checkout
    document.getElementById('batchBtn').addEventListener('click', async () => {
      const branch = document.getElementById('batchBranch').value.trim()
      if (!branch) { showToast('请输入分支名', 'error'); return }

      const checked = [...document.querySelectorAll('#repoChecks input:checked')].map(i => i.value)
      if (!checked.length) { showToast('请选择仓库', 'error'); return }

      const dirtyRepos = repos.filter(r => checked.includes(r.name) && r.dirty)
      if (dirtyRepos.length) {
        pendingAction = { type: 'batch', branch, repoNames: checked, dirtyRepos }
        document.getElementById('modalMsg').textContent = `以下仓库有未提交改动: ${dirtyRepos.map(r => r.name).join(', ')}。是否 stash 后再切换？`
        document.getElementById('modalOverlay').classList.add('active')
        return
      }

      await doBatchCheckout(branch, checked)
    })

    async function doBatchCheckout(branch, repoNames) {
      const res = await fetch(`${API}/api/batch-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch, repoNames })
      })
      const results = await res.json()
      const ok = results.filter(r => r.success).length
      const fail = results.filter(r => !r.success)
      if (fail.length) {
        showToast(`成功 ${ok} 个，失败 ${fail.length} 个: ${fail.map(f => f.name + '(' + f.error + ')').join(', ')}`, 'error')
      } else {
        showToast(`全部 ${ok} 个仓库已切换到 ${branch}`, 'success')
      }
      await fetchRepos()
    }

    // Modal
    document.getElementById('modalCancel').addEventListener('click', () => {
      document.getElementById('modalOverlay').classList.remove('active')
      pendingAction = null
    })

    document.getElementById('modalStash').addEventListener('click', async () => {
      document.getElementById('modalOverlay').classList.remove('active')
      if (!pendingAction) return

      if (pendingAction.type === 'single') {
        await doStash(pendingAction.repoName)
        await doCheckout(pendingAction.repoName, pendingAction.branch)
      } else if (pendingAction.type === 'batch') {
        for (const repo of pendingAction.dirtyRepos) {
          await doStash(repo.name)
        }
        await doBatchCheckout(pendingAction.branch, pendingAction.repoNames)
      }
      pendingAction = null
    })

    // Select all
    document.getElementById('selectAll').addEventListener('click', () => {
      const checks = document.querySelectorAll('#repoChecks input')
      const allChecked = [...checks].every(c => c.checked)
      checks.forEach(c => c.checked = !allChecked)
      document.getElementById('selectAll').textContent = allChecked ? '全选' : '取消全选'
    })

    // Toast
    function showToast(msg, type) {
      const t = document.getElementById('toast')
      t.textContent = msg
      t.className = `toast show ${type}`
      setTimeout(() => t.classList.remove('show'), 3000)
    }

    fetchRepos()
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify full app**

Run: `cd /Users/ext.zhengdixin1/code/git-branch-manager && node server.js &`
Open: `http://localhost:3456` in browser
Verify:
- All 6 repos shown with current branch
- Dirty repos have red badge
- Clicking a card shows branch list with search
- Switching branch works
- Batch checkout works
Kill process after.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: frontend dashboard with status, switch, and batch checkout"
```

---

### Task 4: Final Polish & Verify

- [ ] **Step 1: Add .gitignore**

Create `.gitignore`:
```
node_modules/
```

- [ ] **Step 2: Verify all features end-to-end**

Start server and test in browser:
1. Dashboard loads showing all repos
2. Dirty indicator shows correctly
3. Click card → branch list appears with search
4. Switch branch on clean repo → success toast
5. Switch branch on dirty repo → modal appears → stash and switch works
6. Batch checkout with branch name → all selected repos switch
7. Batch checkout with dirty repos → modal → stash all then switch

- [ ] **Step 3: Final commit**

```bash
git add .gitignore
git commit -m "chore: add gitignore"
```

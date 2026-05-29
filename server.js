import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { execFile } from 'node:child_process'
import { readdir, stat, readFile, writeFile } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(__dirname, 'config.json')

const app = new Hono()

let config = { baseDirs: [], repos: [] }

async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8')
    config = JSON.parse(raw)
  } catch {
    config = { baseDirs: [], repos: [] }
    await saveConfig()
  }
}

async function saveConfig() {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
}

app.use('/public/*', serveStatic({ root: './' }))
app.get('/', (c) => c.redirect('/public/index.html'))

function git(repoPath, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stdout.trim())
    })
  })
}

async function getRepos() {
  const repos = []
  const seen = new Set()
  for (const baseDir of config.baseDirs) {
    try {
      const entries = await readdir(baseDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const fullPath = join(baseDir, entry.name)
        if (seen.has(fullPath)) continue
        try {
          await stat(join(fullPath, '.git'))
          seen.add(fullPath)
          repos.push({ name: entry.name, path: fullPath })
        } catch {}
      }
    } catch {}
  }
  for (const repoPath of config.repos) {
    if (seen.has(repoPath)) continue
    try {
      await stat(join(repoPath, '.git'))
      seen.add(repoPath)
      repos.push({ name: basename(repoPath), path: repoPath })
    } catch {}
  }
  return repos
}

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

app.get('/api/repos/:name/branches', async (c) => {
  const repos = await getRepos()
  const repo = repos.find(r => r.name === c.req.param('name'))
  if (!repo) return c.json({ error: 'Repo not found' }, 404)
  const output = await git(repo.path, ['branch', '--list', '--format=%(refname:short)'])
  const branches = output.split('\n').filter(Boolean)
  return c.json(branches)
})

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

app.post('/api/repos/:name/stash', async (c) => {
  const repos = await getRepos()
  const repo = repos.find(r => r.name === c.req.param('name'))
  if (!repo) return c.json({ error: 'Repo not found' }, 404)
  try {
    await git(repo.path, ['stash', 'push', '-u', '-m', 'auto-stash before branch switch'])
    return c.json({ success: true })
  } catch (e) {
    return c.json({ error: e.message }, 400)
  }
})

app.post('/api/repos/:name/stash-pop', async (c) => {
  const repos = await getRepos()
  const repo = repos.find(r => r.name === c.req.param('name'))
  if (!repo) return c.json({ error: 'Repo not found' }, 404)
  try {
    await git(repo.path, ['stash', 'pop'])
    return c.json({ success: true })
  } catch (e) {
    return c.json({ error: e.message }, 400)
  }
})

app.post('/api/batch-pull', async (c) => {
  const { repoNames } = await c.req.json()
  if (!repoNames?.length) return c.json({ error: 'repoNames required' }, 400)
  const repos = await getRepos()
  const results = await Promise.all(repoNames.map(async (name) => {
    const repo = repos.find(r => r.name === name)
    if (!repo) return { name, success: false, error: 'Not found' }
    try {
      await git(repo.path, ['pull', '--no-edit'])
      return { name, success: true }
    } catch {
      try {
        await git(repo.path, ['merge', '--abort'])
      } catch {}
      try {
        await git(repo.path, ['reset', '--hard', 'HEAD'])
      } catch {}
      return { name, success: false, error: '拉取冲突，已丢弃' }
    }
  }))
  return c.json(results)
})

app.post('/api/batch-push', async (c) => {
  const { repoNames } = await c.req.json()
  if (!repoNames?.length) return c.json({ error: 'repoNames required' }, 400)
  const repos = await getRepos()
  const results = await Promise.all(repoNames.map(async (name) => {
    const repo = repos.find(r => r.name === name)
    if (!repo) return { name, success: false, error: 'Not found' }
    try {
      await git(repo.path, ['push'])
      return { name, success: true }
    } catch (e) {
      return { name, success: false, error: e.message }
    }
  }))
  return c.json(results)
})

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

app.post('/api/batch-create-branch', async (c) => {
  const { branch, repoNames, pullFirst } = await c.req.json()
  if (!branch || !repoNames?.length) return c.json({ error: 'branch and repoNames required' }, 400)
  const repos = await getRepos()
  const results = await Promise.all(repoNames.map(async (name) => {
    const repo = repos.find(r => r.name === name)
    if (!repo) return { name, success: false, error: 'Not found' }
    try {
      if (pullFirst) {
        try {
          await git(repo.path, ['pull'])
        } catch (e) {
          return { name, success: false, error: 'pull 失败: ' + e.message }
        }
      }
      await git(repo.path, ['checkout', '-b', branch])
      return { name, success: true }
    } catch (e) {
      return { name, success: false, error: e.message }
    }
  }))
  return c.json(results)
})

app.post('/api/batch-delete-branch', async (c) => {
  const { branch, repoNames } = await c.req.json()
  if (!branch || !repoNames?.length) return c.json({ error: 'branch and repoNames required' }, 400)
  const repos = await getRepos()
  const results = await Promise.all(repoNames.map(async (name) => {
    const repo = repos.find(r => r.name === name)
    if (!repo) return { name, success: false, error: 'Not found' }
    try {
      const currentBranch = await git(repo.path, ['rev-parse', '--abbrev-ref', 'HEAD'])
      if (currentBranch === branch) {
        const fallback = await findFallbackBranch(repo.path, branch)
        if (!fallback) return { name, success: false, error: '无可用的回退分支' }
        await git(repo.path, ['checkout', fallback])
      }
      await git(repo.path, ['branch', '-D', branch])
      return { name, success: true }
    } catch (e) {
      return { name, success: false, error: e.message }
    }
  }))
  return c.json(results)
})

app.post('/api/batch-sync', async (c) => {
  const { sourceBranch, targetBranch, repoNames } = await c.req.json()
  if (!sourceBranch || !targetBranch || !repoNames?.length) return c.json({ error: 'sourceBranch, targetBranch and repoNames required' }, 400)
  const repos = await getRepos()
  const results = await Promise.all(repoNames.map(async (name) => {
    const repo = repos.find(r => r.name === name)
    if (!repo) return { name, success: false, error: 'Not found' }
    let stashed = false
    try {
      const currentBranch = await git(repo.path, ['rev-parse', '--abbrev-ref', 'HEAD'])
      if (currentBranch !== targetBranch) {
        return { name, success: false, error: `当前分支 ${currentBranch} ≠ ${targetBranch}，跳过`, skipped: true }
      }
      try {
        await git(repo.path, ['ls-remote', '--exit-code', '--heads', 'origin', sourceBranch])
      } catch {
        return { name, success: false, error: `远端分支 origin/${sourceBranch} 不存在` }
      }
      const dirty = await git(repo.path, ['status', '--porcelain'])
      if (dirty.length > 0) {
        await git(repo.path, ['stash', 'push', '-u', '-m', 'auto-stash before sync'])
        stashed = true
      }
      await git(repo.path, ['fetch', 'origin', sourceBranch])
      try {
        await git(repo.path, ['branch', '-f', sourceBranch, `origin/${sourceBranch}`])
      } catch {}
      try {
        await git(repo.path, ['merge', `origin/${sourceBranch}`, '--no-edit'])
      } catch (mergeErr) {
        try { await git(repo.path, ['merge', '--abort']) } catch {}
        if (stashed) { try { await git(repo.path, ['stash', 'pop']) } catch {} }
        return { name, success: false, error: `合并冲突，已回滚`, currentBranch }
      }
      if (stashed) {
        try { await git(repo.path, ['stash', 'pop']) } catch {}
      }
      return { name, success: true, currentBranch }
    } catch (e) {
      if (stashed) { try { await git(repo.path, ['stash', 'pop']) } catch {} }
      return { name, success: false, error: e.message }
    }
  }))
  return c.json(results)
})

async function findFallbackBranch(repoPath, excludeBranch) {
  const output = await git(repoPath, ['branch', '--list', '--format=%(refname:short)'])
  const branches = output.split('\n').filter(Boolean)
  for (const candidate of ['master', 'main', 'develop']) {
    if (branches.includes(candidate) && candidate !== excludeBranch) return candidate
  }
  return branches.find(b => b !== excludeBranch) || null
}

// --- Config API ---
app.get('/api/config', (c) => c.json(config))

app.post('/api/config/base-dirs', async (c) => {
  const { path: dirPath } = await c.req.json()
  if (!dirPath) return c.json({ error: 'path required' }, 400)
  try {
    const s = await stat(dirPath)
    if (!s.isDirectory()) return c.json({ error: '路径不是目录' }, 400)
  } catch {
    return c.json({ error: '目录不存在' }, 400)
  }
  const entries = await readdir(dirPath, { withFileTypes: true })
  let hasRepo = false
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      await stat(join(dirPath, entry.name, '.git'))
      hasRepo = true
      break
    } catch {}
  }
  if (!hasRepo) return c.json({ error: '该目录下未检测到 git 仓库' }, 400)
  if (config.baseDirs.includes(dirPath)) return c.json({ error: '目录已存在' }, 400)
  config.baseDirs.push(dirPath)
  await saveConfig()
  return c.json({ success: true })
})

app.delete('/api/config/base-dirs', async (c) => {
  const { path: dirPath } = await c.req.json()
  if (!dirPath) return c.json({ error: 'path required' }, 400)
  const idx = config.baseDirs.indexOf(dirPath)
  if (idx === -1) return c.json({ error: '目录不在列表中' }, 400)
  config.baseDirs.splice(idx, 1)
  await saveConfig()
  return c.json({ success: true })
})

app.post('/api/config/repos', async (c) => {
  const { path: repoPath } = await c.req.json()
  if (!repoPath) return c.json({ error: 'path required' }, 400)
  try {
    await stat(join(repoPath, '.git'))
  } catch {
    return c.json({ error: '路径不是有效的 git 仓库' }, 400)
  }
  if (config.repos.includes(repoPath)) return c.json({ error: '仓库已存在' }, 400)
  config.repos.push(repoPath)
  await saveConfig()
  return c.json({ success: true })
})

app.delete('/api/config/repos', async (c) => {
  const { path: repoPath } = await c.req.json()
  if (!repoPath) return c.json({ error: 'path required' }, 400)
  const idx = config.repos.indexOf(repoPath)
  if (idx === -1) return c.json({ error: '仓库不在列表中' }, 400)
  config.repos.splice(idx, 1)
  await saveConfig()
  return c.json({ success: true })
})

app.post('/api/pick-directory', async (c) => {
  try {
    const { stdout } = await execFileAsync('osascript', [
      '-e', 'set chosenFolder to choose folder with prompt "选择目录"',
      '-e', 'return POSIX path of chosenFolder'
    ])
    const path = stdout.trim().replace(/\/$/, '')
    return c.json({ success: true, path })
  } catch {
    return c.json({ success: false, error: '未选择目录' })
  }
})

await loadConfig()

serve({ fetch: app.fetch, port: 3456 }, (info) => {
  console.log(`Git Branch Manager running at http://localhost:${info.port}`)
})

export default app

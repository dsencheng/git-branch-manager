import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const app = new Hono()
const REPOS_BASE = '/Users/ext.zhengdixin1/code'

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
  const entries = await readdir(REPOS_BASE, { withFileTypes: true })
  const repos = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const fullPath = join(REPOS_BASE, entry.name)
    try {
      await stat(join(fullPath, '.git'))
      repos.push({ name: entry.name, path: fullPath })
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
    await git(repo.path, ['stash', 'push', '-m', 'auto-stash before branch switch'])
    return c.json({ success: true })
  } catch (e) {
    return c.json({ error: e.message }, 400)
  }
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

serve({ fetch: app.fetch, port: 3456 }, (info) => {
  console.log(`Git Branch Manager running at http://localhost:${info.port}`)
})

export default app

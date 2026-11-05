const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  return { ok: result.status === 0, status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() }
}

let failures = 0
function check(label, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  -> ${detail}`}`)
  if (!cond) failures++
}

function extractRepoName(rawUrl, provider) {
  if (!rawUrl || typeof rawUrl !== 'string') return ''
  let url = rawUrl.trim().replace(/[/\\]+$/, '')
  if (provider === 'git') {
    if (url.endsWith('.git')) url = url.slice(0, -4)
    const parts = url.split(/[/:/\\]/).filter(Boolean)
    const last = parts[parts.length - 1] || 'repo'
    return last.replace(/[<>:"/\\|?*]/g, '_')
  }
  const parts = url.split(/[/\\]/).filter(Boolean)
  if (parts.length > 0) {
    const last = parts[parts.length - 1].toLowerCase()
    if ((last === 'trunk' || last === 'branches' || last === 'tags') && parts.length > 1) {
      return parts[parts.length - 2].replace(/[<>:"/\\|?*]/g, '_')
    }
    return parts[parts.length - 1].replace(/[<>:"/\\|?*]/g, '_')
  }
  return 'svn-repo'
}

function joinLocalPath(parent, child) {
  if (!parent) return child
  const cleanParent = parent.trim().replace(/[/\\]+$/, '')
  const separator = cleanParent.includes('/') && !cleanParent.includes('\\') ? '/' : '\\'
  return `${cleanParent}${separator}${child.trim().replace(/^[/\\]+/, '')}`
}

function parseUrlList(text, provider, targetRoot) {
  const lines = String(text || '').split(/\r?\n/)
  const items = []
  const seen = new Set()
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const name = extractRepoName(trimmed, provider) || `repo_${index + 1}`
    let finalName = name
    let counter = 1
    while (seen.has(finalName)) {
      counter++
      finalName = `${name}_${counter}`
    }
    seen.add(finalName)
    const target = targetRoot ? joinLocalPath(targetRoot, finalName) : finalName
    items.push({
      id: `item-${index}-${trimmed}`,
      url: trimmed,
      name: finalName,
      target
    })
  })
  return items
}

// 1. Test URL extraction
check('Git https with .git', extractRepoName('https://github.com/torvalds/linux.git', 'git') === 'linux')
check('Git ssh format', extractRepoName('git@github.com:facebook/react.git', 'git') === 'react')
check('Git url without .git', extractRepoName('https://gitlab.com/group/my-service', 'git') === 'my-service')
check('SVN trunk url extracts parent', extractRepoName('https://svn.example.com/svn/project-alpha/trunk', 'svn') === 'project-alpha')
check('SVN trunk url with trailing slash', extractRepoName('https://svn.example.com/svn/project-beta/trunk/', 'svn') === 'project-beta')
check('SVN standard repo url', extractRepoName('https://svn.example.com/svn/project-gamma', 'svn') === 'project-gamma')

// 2. Test Multiline List parsing
const sampleGitUrls = `
https://github.com/org/repo1.git
# this is a comment
https://github.com/org/repo2.git

git@github.com:org/repo1.git
`
const parsed = parseUrlList(sampleGitUrls, 'git', 'D:\\workspace')
check('Parse filtered empty lines & comments', parsed.length === 3)
check('Item 1 name & target', parsed[0].name === 'repo1' && parsed[0].target === 'D:\\workspace\\repo1')
check('Item 2 name & target', parsed[1].name === 'repo2' && parsed[1].target === 'D:\\workspace\\repo2')
check('Duplicate name disambiguated', parsed[2].name === 'repo1_2' && parsed[2].target === 'D:\\workspace\\repo1_2')

// 3. Test Actual Batch Clone execution with local fixtures
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codesync-batch-test-'))
console.log(`temp test dir: ${tmp}`)

const origin1 = path.join(tmp, 'origin1')
const origin2 = path.join(tmp, 'origin2')
fs.mkdirSync(origin1, { recursive: true })
fs.mkdirSync(origin2, { recursive: true })

run('git', ['-C', origin1, 'init', '-q'])
run('git', ['-C', origin1, 'config', 'user.email', 't@t.com'])
run('git', ['-C', origin1, 'config', 'user.name', 't'])
fs.writeFileSync(path.join(origin1, 'file1.txt'), 'content1')
run('git', ['-C', origin1, 'add', '-A'])
run('git', ['-C', origin1, 'commit', '-qm', 'init1'])

run('git', ['-C', origin2, 'init', '-q'])
run('git', ['-C', origin2, 'config', 'user.email', 't@t.com'])
run('git', ['-C', origin2, 'config', 'user.name', 't'])
fs.writeFileSync(path.join(origin2, 'file2.txt'), 'content2')
run('git', ['-C', origin2, 'add', '-A'])
run('git', ['-C', origin2, 'commit', '-qm', 'init2'])

const batchTarget = path.join(tmp, 'workspace')
fs.mkdirSync(batchTarget, { recursive: true })

const origin1Url = 'file:///' + origin1.replace(/\\/g, '/')
const origin2Url = 'file:///' + origin2.replace(/\\/g, '/')
const batchInput = `${origin1Url}\n${origin2Url}`

const batchQueue = parseUrlList(batchInput, 'git', batchTarget)
check('Batch queue created 2 items', batchQueue.length === 2)

for (const item of batchQueue) {
  const cloneRes = run('git', ['clone', item.url, item.target])
  check(`Clone ${item.name}`, cloneRes.ok && fs.existsSync(item.target))
}

// Test update scenario on existing
fs.writeFileSync(path.join(origin1, 'file1_new.txt'), 'content1_new')
run('git', ['-C', origin1, 'add', '-A'])
run('git', ['-C', origin1, 'commit', '-qm', 'update1'])

const pullRes = run('git', ['-C', batchQueue[0].target, 'pull', '--ff-only'])
check('Update existing repo in batchTarget', pullRes.ok && fs.existsSync(path.join(batchQueue[0].target, 'file1_new.txt')))

// Cleanup
try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('\nALL BATCH SYNC CHECKS PASSED!')
}

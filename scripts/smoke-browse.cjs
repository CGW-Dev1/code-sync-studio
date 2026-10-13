// Standalone smoke test replicating the exact command sequences used by
// electron/main.cjs browseRepository / runTask for directory browsing and
// directory-scoped pulls. Run: node scripts/smoke-browse.cjs
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  return { ok: result.status === 0, status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() }
}

function parseGitTree(raw) {
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const tab = line.indexOf('\t')
    if (tab <= 0) return null
    const type = line.slice(0, tab).split(/\s+/)[1]
    const name = line.slice(tab + 1)
    if (!name) return null
    return { name, kind: type === 'tree' ? 'dir' : 'file' }
  }).filter(Boolean)
}

function parseSvnListEntries(xml = '') {
  const tag = (s, name) => (s.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1] || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim()
  return [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)]
    .map((match) => match[0])
    .map((entry) => {
      const kind = /kind="(dir|file)"/i.exec(entry)?.[1]
      const name = tag(entry, 'name').replace(/\/$/, '')
      return kind && name ? { name, kind } : null
    })
    .filter(Boolean)
}

function gitSparsePattern(p) {
  const escaped = String(p).split('/').map((seg) => seg.replace(/([!#*?[\]\\])/g, '\\$1')).join('/')
  return `/${escaped}/`
}

let failures = 0
function check(label, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  -> ${detail}`}`)
  if (!cond) failures++
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codesync-smoke2-'))
console.log(`workspace: ${tmp}`)

// ---------- Git fixture ----------
const gRepo = path.join(tmp, 'g-repo')
fs.mkdirSync(path.join(gRepo, 'src', 'util'), { recursive: true })
fs.mkdirSync(path.join(gRepo, 'docs'), { recursive: true })
fs.mkdirSync(path.join(gRepo, 'my dir'), { recursive: true })
fs.writeFileSync(path.join(gRepo, 'README.md'), 'readme')
fs.writeFileSync(path.join(gRepo, 'src', 'main.c'), 'main')
fs.writeFileSync(path.join(gRepo, 'src', 'util', 'helper.c'), 'helper')
fs.writeFileSync(path.join(gRepo, 'docs', 'guide.md'), 'guide')
fs.writeFileSync(path.join(gRepo, 'my dir', 'file.txt'), 'x')
run('git', ['-C', gRepo, 'init', '-q'])
run('git', ['-C', gRepo, 'config', 'user.email', 't@t.t'])
run('git', ['-C', gRepo, 'config', 'user.name', 't'])
run('git', ['-C', gRepo, 'add', '-A'])
run('git', ['-C', gRepo, 'commit', '-qm', 'init'])
run('git', ['-C', gRepo, 'branch', '-M', 'main'])
run('git', ['-C', gRepo, 'tag', 'v1.0'])
const gUrl = 'file:///' + gRepo.replace(/\\/g, '/')

// ---------- Git browse (replicates ensureGitBrowse + ls-tree) ----------
const browseDir = path.join(tmp, 'g-browse')
const cloneArgs = ['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', 'main', gUrl, browseDir]
let res = run('git', cloneArgs)
check('git browse clone (filter+sparse+--branch)', res.ok, res.stderr)

res = run('git', ['-C', browseDir, 'ls-tree', 'HEAD'])
const rootEntries = parseGitTree(res.stdout)
check('git root listing has 4 entries', rootEntries.length === 4 && rootEntries.every((e) => ['README.md', 'docs', 'my dir', 'src'].includes(e.name)), JSON.stringify(rootEntries))
check('git root kinds', rootEntries.find((e) => e.name === 'src')?.kind === 'dir' && rootEntries.find((e) => e.name === 'README.md')?.kind === 'file')

res = run('git', ['-C', browseDir, 'ls-tree', 'HEAD', '--', 'src/'])
const srcEntries = parseGitTree(res.stdout).map((e) => (e.name.startsWith('src/') ? { ...e, name: e.name.slice(4) } : e))
check('git subdir listing src -> main.c + util', srcEntries.map((e) => `${e.kind}:${e.name}`).join(',') === 'file:main.c,dir:util', JSON.stringify(srcEntries))

res = run('git', ['-C', browseDir, 'ls-tree', 'HEAD', '--', 'my dir/'])
const spacedEntries = parseGitTree(res.stdout).map((e) => (e.name.startsWith('my dir/') ? { ...e, name: e.name.slice(7) } : e))
check('git spaced dir listing -> file.txt', spacedEntries.length === 1 && spacedEntries[0].name === 'file.txt' && spacedEntries[0].kind === 'file', JSON.stringify(spacedEntries))

// ---------- Git sparse pull (replicates runTask sparse path) ----------
const gTarget = path.join(tmp, 'g-target')
res = run('git', ['clone', '--progress', '--filter=blob:none', '--sparse', '--branch', 'main', gUrl, gTarget])
check('git sparse pull clone ok', res.ok, res.stderr)
res = run('git', ['-C', gTarget, 'sparse-checkout', 'set', '--no-cone', gitSparsePattern('my dir')])
check('git sparse-checkout set --no-cone ok', res.ok, res.stderr)
const treeFiles = []
;(function walk(dir, base) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.svn') continue
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) walk(path.join(dir, entry.name), rel)
    else treeFiles.push(rel)
  }
})(gTarget, '')
check('git sparse pull contains ONLY selected dir', treeFiles.join(',') === 'my dir/file.txt', treeFiles.join(','))
check('git sparse pull status clean', run('git', ['-C', gTarget, 'status', '--porcelain']).stdout === '')

// tag clone branch test
const gTag = path.join(tmp, 'g-tag')
res = run('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', 'v1.0', gUrl, gTag])
check('git browse clone with tag ref ok', res.ok, res.stderr)

// ---------- ensureGitBrowse fallback (filter clone fails -> plain clone) ----------
{
  const name = 'main'
  const target = path.join(tmp, 'g-fallback')
  const buildClone = (args, targetDir) => {
    const full = [...args]
    if (name) full.push('--branch', name)
    full.push(gUrl, targetDir)
    return full
  }
  let plainDir = null
  try {
    // force the filter attempt to fail with a bogus option
    run('git', buildClone(['clone', '--bogus-flag', '--filter=blob:none', '--sparse'], target))
  } catch {}
  // mirror of main.cjs: filter attempt threw -> plain retry
  if (!run('git', ['-C', target, 'rev-parse', '--is-inside-work-tree']).ok) {
    try { fs.rmSync(target, { recursive: true, force: true }) } catch {}
    plainDir = path.join(tmp, 'g-fallback-plain')
    res = run('git', buildClone(['clone', '--depth', '1', '--sparse'], plainDir))
    check('git browse fallback clone lands in plainDir', res.ok && fs.existsSync(path.join(plainDir, '.git')), res.stderr)
    res = run('git', ['-C', plainDir, 'ls-tree', 'HEAD', '--', 'src/'])
    check('git browse fallback ls-tree works', res.ok && res.stdout.includes('src/main.c'), res.stdout)
  } else {
    check('git browse fallback clone lands in plainDir', false, 'filter attempt unexpectedly succeeded')
  }
}

// ---------- SVN fixture ----------
const sRepo = path.join(tmp, 's-repo')
fs.mkdirSync(sRepo)
res = run('svnadmin', ['create', sRepo])
check('svnadmin create ok', res.ok, res.stderr)
const sUrl = 'file:///' + sRepo.replace(/\\/g, '/')
const wc = path.join(tmp, 's-wc')
fs.mkdirSync(path.join(wc, 'trunk', 'src'), { recursive: true })
fs.mkdirSync(path.join(wc, 'branches'), { recursive: true })
fs.writeFileSync(path.join(wc, 'trunk', 'src', 'main.c'), 'main')
fs.writeFileSync(path.join(wc, 'trunk', 'src', 'util.c'), 'util')
fs.writeFileSync(path.join(wc, 'branches', 'dev.txt'), 'dev')
run('svn', ['import', '-q', wc, `${sUrl}/proj`, '-m', 'init'])
run('svn', ['checkout', '-q', `${sUrl}/proj`, path.join(tmp, 's-wc2')])

// ---------- SVN browse (replicates browseRepository svn) ----------
res = run('svn', ['list', '--xml', `${sUrl}/proj`])
let entries = parseSvnListEntries(res.stdout)
check('svn root listing dirs+files', entries.map((e) => `${e.kind}:${e.name}`).join(',') === 'dir:branches,dir:trunk', JSON.stringify(entries))

res = run('svn', ['list', '--xml', `${sUrl}/proj/trunk`])
entries = parseSvnListEntries(res.stdout)
check('svn trunk listing has src dir', entries.some((e) => e.kind === 'dir' && e.name === 'src'), JSON.stringify(entries))

res = run('svn', ['list', '--xml', `${sUrl}/proj/trunk/src`])
entries = parseSvnListEntries(res.stdout)
check('svn src listing files', entries.map((e) => `${e.kind}:${e.name}`).join(',') === 'file:main.c,file:util.c', JSON.stringify(entries))

// ---------- SVN subdir checkout (replicates runTask svn pull with path) ----------
const sTarget = path.join(tmp, 's-target')
res = run('svn', ['checkout', `${sUrl}/proj/trunk/src`, sTarget])
check('svn subdir checkout ok', res.ok, res.stderr)
const sFiles = fs.readdirSync(sTarget).filter((name) => name !== '.svn').sort()
check('svn subdir checkout contains only src files', sFiles.join(',') === 'main.c,util.c', sFiles.join(','))

// ---------- SVN switch (replicates runTask svn update with path) ----------
res = run('svn', ['switch', '--ignore-ancestry', `${sUrl}/proj/branches`, sTarget])
check('svn switch to another subtree ok', res.ok, res.stderr)
const swFiles = fs.readdirSync(sTarget).filter((name) => name !== '.svn').sort()
check('svn switch re-scopes working copy', swFiles.join(',') === 'dev.txt', swFiles.join(','))
res = run('svn', ['switch', '--ignore-ancestry', `${sUrl}/proj/trunk`, sTarget])
check('svn switch back to trunk root ok', res.ok, res.stderr)
const swRoot = fs.readdirSync(sTarget).filter((name) => name !== '.svn').sort()
check('svn switch expands to trunk content', swRoot.join(',') === 'src', swRoot.join(','))

// ---------- Git update with sparse re-scope (replicates runTask git update with path) ----------
{
  const wc = path.join(tmp, 'g-update')
  res = run('git', ['clone', '--filter=blob:none', '--sparse', gUrl, wc])
  check('git update fixture clone ok', res.ok, res.stderr)
  res = run('git', ['-C', wc, 'sparse-checkout', 'set', '--no-cone', gitSparsePattern('my dir')])
  check('git update fixture sparse set ok', res.ok, res.stderr)
  // add a new file inside src to make the update meaningful
  fs.writeFileSync(path.join(gRepo, 'src', 'newfile.c'), 'new')
  run('git', ['-C', gRepo, 'add', '-A'])
  run('git', ['-C', gRepo, 'commit', '-qm', 'add newfile'])
  res = run('git', ['-C', wc, 'fetch', '--prune', 'origin', 'main'])
  check('git update fetch ok', res.ok, res.stderr)
  res = run('git', ['-C', wc, 'sparse-checkout', 'set', '--no-cone', gitSparsePattern('src')])
  check('git update sparse re-scope ok', res.ok, res.stderr)
  res = run('git', ['-C', wc, 'pull', '--ff-only', 'origin', 'main'])
  check('git update pull ok', res.ok, res.stderr)
  const updated = []
  ;(function walk2(dir, base) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const rel = base ? `${base}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk2(path.join(dir, entry.name), rel)
      else updated.push(rel)
    }
  })(wc, '')
  updated.sort()
  check('git update re-scoped to src only + new file', updated.join(',') === 'src/main.c,src/newfile.c,src/util/helper.c', updated.join(','))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED')
process.exit(failures ? 1 : 0)

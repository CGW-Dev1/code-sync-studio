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

function parseSingleLine(rawLine, provider) {
  let line = String(rawLine || '').trim()
  if (!line || line.startsWith('#') || line.startsWith('//')) return null

  let url = ''
  let branch = ''

  // 1. 空格或制表符分隔
  const spaceParts = line.split(/\s+/)
  if (spaceParts.length >= 2) {
    url = spaceParts[0].trim()
    branch = spaceParts.slice(1).join(' ').trim()
  } else {
    // 2. # 分隔
    const hashIndex = line.indexOf('#')
    if (hashIndex > 0) {
      url = line.slice(0, hashIndex).trim()
      branch = line.slice(hashIndex + 1).trim()
    } else {
      // 3. @ 分隔
      let atIndex = -1
      if (line.startsWith('git@')) {
        atIndex = line.indexOf('@', 4)
      } else {
        const protoIndex = line.indexOf('://')
        if (protoIndex >= 0) {
          atIndex = line.indexOf('@', protoIndex + 3)
        } else {
          atIndex = line.lastIndexOf('@')
        }
      }

      if (atIndex > 0 && atIndex < line.length - 1) {
        url = line.slice(0, atIndex).trim()
        branch = line.slice(atIndex + 1).trim()
      } else {
        url = line
        branch = ''
      }
    }
  }

  return { url, branch }
}

// Tests
const t1 = parseSingleLine('https://gitlab.com/group/repo1.git dev', 'git')
check('space separated branch', t1.url === 'https://gitlab.com/group/repo1.git' && t1.branch === 'dev', JSON.stringify(t1))

const t2 = parseSingleLine('https://gitlab.com/group/repo2.git   release/1.0.0', 'git')
check('multiple spaces branch', t2.url === 'https://gitlab.com/group/repo2.git' && t2.branch === 'release/1.0.0', JSON.stringify(t2))

const t3 = parseSingleLine('https://gitlab.com/group/repo3.git#feature-abc', 'git')
check('hash separated branch', t3.url === 'https://gitlab.com/group/repo3.git' && t3.branch === 'feature-abc', JSON.stringify(t3))

const t4 = parseSingleLine('git@github.com:owner/repo4.git@v2.0', 'git')
check('at separated branch with git@', t4.url === 'git@github.com:owner/repo4.git' && t4.branch === 'v2.0', JSON.stringify(t4))

const t5 = parseSingleLine('https://svn.example.com/svn/projectA@1024', 'svn')
check('svn revision with @', t5.url === 'https://svn.example.com/svn/projectA' && t5.branch === '1024', JSON.stringify(t5))

const t6 = parseSingleLine('https://gitlab.com/group/repo5.git', 'git')
check('pure url without branch', t6.url === 'https://gitlab.com/group/repo5.git' && t6.branch === '', JSON.stringify(t6))

// Test actual clone of different branches
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codesync-diff-branch-'))
console.log(`test dir: ${tmp}`)

const origin = path.join(tmp, 'remote-repo')
fs.mkdirSync(origin, { recursive: true })
run('git', ['-C', origin, 'init', '-q'])
run('git', ['-C', origin, 'config', 'user.email', 't@t.com'])
run('git', ['-C', origin, 'config', 'user.name', 't'])
fs.writeFileSync(path.join(origin, 'master.txt'), 'master content')
run('git', ['-C', origin, 'add', '-A'])
run('git', ['-C', origin, 'commit', '-qm', 'init master'])
run('git', ['-C', origin, 'branch', '-M', 'master'])

// Create dev branch
run('git', ['-C', origin, 'checkout', '-b', 'dev'])
fs.writeFileSync(path.join(origin, 'dev.txt'), 'dev content')
run('git', ['-C', origin, 'add', '-A'])
run('git', ['-C', origin, 'commit', '-qm', 'commit dev'])

// Create tag v1.0 on master
run('git', ['-C', origin, 'checkout', 'master'])
run('git', ['-C', origin, 'tag', 'v1.0'])

const originUrl = 'file:///' + origin.replace(/\\/g, '/')

// Clone master (default)
const targetMaster = path.join(tmp, 'clone-master')
const res1 = run('git', ['clone', originUrl, targetMaster])
check('clone default master', res1.ok && fs.existsSync(path.join(targetMaster, 'master.txt')) && !fs.existsSync(path.join(targetMaster, 'dev.txt')))

// Clone dev branch
const targetDev = path.join(tmp, 'clone-dev')
const res2 = run('git', ['clone', '--branch', 'dev', originUrl, targetDev])
check('clone dev branch', res2.ok && fs.existsSync(path.join(targetDev, 'dev.txt')))

// Clone tag v1.0
const targetTag = path.join(tmp, 'clone-tag')
const res3 = run('git', ['clone', '--branch', 'v1.0', originUrl, targetTag])
check('clone tag v1.0', res3.ok && fs.existsSync(path.join(targetTag, 'master.txt')))

try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}

if (failures > 0) {
  console.error(`FAILED: ${failures} tests failed.`)
  process.exit(1)
} else {
  console.log('\nALL TESTS PASSED!')
}

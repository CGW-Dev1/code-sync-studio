const { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage } = require('electron')
const { spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { URL } = require('url')

let mainWindow
let activeJob = null
let credentialStore = null

function emptyCredentialStore() {
  return {
    git: { mode: 'https', username: '', token: '', sshKeyPath: '', sshPassphrase: '' },
    svn: { username: '', password: '' }
  }
}

function normalizeCredentialStore(value = {}) {
  const defaults = emptyCredentialStore()
  const git = value.git || {}
  const svn = value.svn || {}
  return {
    git: {
      mode: git.mode === 'ssh' ? 'ssh' : 'https',
      username: typeof git.username === 'string' ? git.username : defaults.git.username,
      token: typeof git.token === 'string' ? git.token : defaults.git.token,
      sshKeyPath: typeof git.sshKeyPath === 'string' ? git.sshKeyPath : defaults.git.sshKeyPath,
      sshPassphrase: typeof git.sshPassphrase === 'string' ? git.sshPassphrase : defaults.git.sshPassphrase
    },
    svn: {
      username: typeof svn.username === 'string' ? svn.username : defaults.svn.username,
      password: typeof svn.password === 'string' ? svn.password : defaults.svn.password
    }
  }
}

function credentialFilePath() {
  return path.join(app.getPath('userData'), 'credentials.json')
}

function loadCredentialStore() {
  if (credentialStore) return credentialStore
  credentialStore = emptyCredentialStore()
  try {
    if (!safeStorage.isEncryptionAvailable()) return credentialStore
    const envelope = JSON.parse(fs.readFileSync(credentialFilePath(), 'utf8'))
    if (envelope?.encrypted) {
      const plaintext = safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64'))
      credentialStore = normalizeCredentialStore(JSON.parse(plaintext))
    }
  } catch {}
  return credentialStore
}

function saveCredentialStore(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持安全凭据存储，请先启用 Windows 用户数据保护。')
  const next = normalizeCredentialStore(value)
  const directory = app.getPath('userData')
  fs.mkdirSync(directory, { recursive: true })
  const encrypted = safeStorage.encryptString(JSON.stringify(next)).toString('base64')
  fs.writeFileSync(credentialFilePath(), JSON.stringify({ version: 1, encrypted }), { encoding: 'utf8', mode: 0o600 })
  credentialStore = next
  return next
}

function credentialStatus() {
  const store = loadCredentialStore()
  return {
    storageAvailable: safeStorage.isEncryptionAvailable(),
    git: {
      mode: store.git.mode,
      username: store.git.username,
      sshKeyPath: store.git.sshKeyPath,
      tokenConfigured: Boolean(store.git.token),
      sshPassphraseConfigured: Boolean(store.git.sshPassphrase)
    },
    svn: {
      username: store.svn.username,
      passwordConfigured: Boolean(store.svn.password)
    }
  }
}

function updateCredentialStore(input = {}) {
  const current = loadCredentialStore()
  const next = normalizeCredentialStore(current)
  const git = input.git || {}
  const svn = input.svn || {}
  if (git.mode === 'ssh' || git.mode === 'https') next.git.mode = git.mode
  if (typeof git.username === 'string') next.git.username = git.username.trim()
  if (typeof git.sshKeyPath === 'string') next.git.sshKeyPath = git.sshKeyPath.trim()
  if (git.clearToken) next.git.token = ''
  else if (typeof git.token === 'string' && git.token) next.git.token = git.token
  if (git.clearSshPassphrase) next.git.sshPassphrase = ''
  else if (typeof git.sshPassphrase === 'string' && git.sshPassphrase) next.git.sshPassphrase = git.sshPassphrase
  if (typeof svn.username === 'string') next.svn.username = svn.username.trim()
  if (svn.clearPassword) next.svn.password = ''
  else if (typeof svn.password === 'string' && svn.password) next.svn.password = svn.password
  return credentialStatusFromStore(saveCredentialStore(next))
}

function credentialStatusFromStore(store) {
  return {
    storageAvailable: safeStorage.isEncryptionAvailable(),
    git: {
      mode: store.git.mode,
      username: store.git.username,
      sshKeyPath: store.git.sshKeyPath,
      tokenConfigured: Boolean(store.git.token),
      sshPassphraseConfigured: Boolean(store.git.sshPassphrase)
    },
    svn: {
      username: store.svn.username,
      passwordConfigured: Boolean(store.svn.password)
    }
  }
}

function clearCredentialProvider(provider) {
  const next = loadCredentialStore()
  if (provider === 'git') next.git = emptyCredentialStore().git
  else if (provider === 'svn') next.svn = emptyCredentialStore().svn
  else return credentialStatusFromStore(saveCredentialStore(emptyCredentialStore()))
  return credentialStatusFromStore(saveCredentialStore(next))
}

function sendTaskEvent(event) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('task:event', event)
}

function stripAnsi(value) {
  return value.replace(/[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '')
}

function normalizeSvnUrl(value) {
  const input = String(value || '').trim()
  if (!input) return ''
  try {
    const parsed = new URL(input)
    parsed.pathname = parsed.pathname.split('/').map((segment) => {
      try {
        return encodeURIComponent(decodeURIComponent(segment))
      } catch {
        return encodeURIComponent(segment)
      }
    }).join('/')
    return parsed.toString()
  } catch {
    return input
  }
}

function decodeXml(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function xmlTag(xml, name) {
  const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  return match ? decodeXml(match[1].trim()) : ''
}

function xmlAttr(xml, name) {
  const match = xml.match(new RegExp(`${name}="([^"]*)"`, 'i'))
  return match ? decodeXml(match[1]) : ''
}

function commandError(command, args, error) {
  if (error && error.code === 'ENOENT') return new Error(`未找到 ${command} 命令，请先安装对应的 Git/SVN 客户端并加入 PATH。`)
  const suffix = error && error.message ? `: ${error.message}` : ''
  return new Error(`${command} 执行失败${suffix}`)
}

function svnAuthSummary(credentials) {
  const username = typeof credentials?.username === 'string' ? credentials.username.trim() : ''
  const passwordConfigured = Boolean(credentials?.password)
  if (username && passwordConfigured) return `软件配置账号密码（账号：${username}，密码：已读取）`
  if (username || passwordConfigured) return `软件配置不完整（账号：${username || '未配置'}，密码：${passwordConfigured ? '已读取' : '未配置'}），同时尝试 SVN 本机凭证缓存`
  return '未配置软件账号密码，使用 SVN 本机凭证缓存'
}

function svnError(message, authSummary = '') {
  const value = stripAnsi(String(message || '')).trim()
  const authHint = authSummary ? `\n认证状态：${authSummary}` : ''
  if (/E175013|forbidden|authorization failed|authentication failed/i.test(value)) {
    return new Error(`SVN 访问被拒绝：请确认账号对该目录有权限，并确认连接设置中的账号密码正确。${authHint}\n${value}`)
  }
  return new Error(`${value || 'SVN 执行失败。'}${authHint}`)
}

function createAskpassHelper(values) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codesync-askpass-'))
  const payload = Buffer.from(JSON.stringify(values), 'utf8').toString('base64')
  const scriptPath = path.join(directory, 'askpass.ps1')
  const commandPath = path.join(directory, 'askpass.cmd')
  const script = [
    'param([Parameter(ValueFromRemainingArguments=$true)][string[]]$PromptParts)',
    '$prompt = ($PromptParts -join " ").ToLowerInvariant()',
    `$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))`,
    '$data = $payload | ConvertFrom-Json',
    'if ($prompt -match "passphrase") { $value = $data.passphrase } elseif ($prompt -match "username|user name") { $value = $data.username } else { $value = $data.password }',
    '[Console]::Out.Write($value)'
  ].join('\r\n')
  fs.writeFileSync(scriptPath, script, { encoding: 'utf8', mode: 0o600 })
  fs.writeFileSync(commandPath, `@echo off\r\npowershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}" %*\r\n`, { encoding: 'ascii', mode: 0o700 })
  return {
    path: commandPath,
    cleanup: () => {
      try { fs.rmSync(directory, { recursive: true, force: true }) } catch {}
    }
  }
}

function resolveGitCredentials(override) {
  const stored = loadCredentialStore().git
  return {
    mode: override?.mode === 'ssh' ? 'ssh' : override?.mode === 'https' ? 'https' : stored.mode,
    username: typeof override?.username === 'string' ? override.username.trim() : stored.username,
    token: override?.clearToken ? '' : typeof override?.token === 'string' && override.token ? override.token : stored.token,
    sshKeyPath: typeof override?.sshKeyPath === 'string' ? override.sshKeyPath.trim() : stored.sshKeyPath,
    sshPassphrase: override?.clearSshPassphrase ? '' : typeof override?.sshPassphrase === 'string' && override.sshPassphrase ? override.sshPassphrase : stored.sshPassphrase
  }
}

function gitAuthSummary(credentials) {
  if (credentials.mode === 'ssh') {
    return credentials.sshKeyPath ? `Git SSH Key（${credentials.username || '默认用户'}，私钥已读取）` : 'Git SSH Key 未配置'
  }
  if (credentials.username && credentials.token) return `Git HTTPS（账号：${credentials.username}，Token 已读取）`
  if (credentials.username || credentials.token) return `Git HTTPS 配置不完整（账号：${credentials.username || '未配置'}，Token：${credentials.token ? '已读取' : '未配置'}）`
  return '未配置 Git 账号密码，使用 Git 本机凭证'
}

function resolveSvnCredentials(override) {
  const stored = loadCredentialStore().svn
  return {
    username: typeof override?.username === 'string' ? override.username.trim() : stored.username,
    password: typeof override?.password === 'string' && override.password ? override.password : stored.password
  }
}

function createCommandSession(command, args, options = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', SVN_INTERACTIVE: '0' }
  const cleanup = []
  let preparedArgs = [...args]
  let authSummary = ''

  if (command === 'git') {
    const gitCredentials = resolveGitCredentials(options.gitCredentials)
    authSummary = gitAuthSummary(gitCredentials)
    if (gitCredentials.mode === 'https' && (gitCredentials.username || gitCredentials.token)) {
      env.CODESYNC_GIT_USERNAME = gitCredentials.username
      env.CODESYNC_GIT_TOKEN = gitCredentials.token
      const helperCommand = '!f() { printf "username=%s\\npassword=%s\\n" "$CODESYNC_GIT_USERNAME" "$CODESYNC_GIT_TOKEN"; }; f'
      preparedArgs = ['-c', 'credential.helper=', '-c', `credential.helper=${helperCommand}`, ...preparedArgs]
      const helper = createAskpassHelper({ username: gitCredentials.username, password: gitCredentials.token, passphrase: '' })
      env.GIT_ASKPASS = helper.path
      cleanup.push(helper.cleanup)
    }
    if (gitCredentials.mode === 'ssh' && gitCredentials.sshKeyPath) {
      const keyPath = gitCredentials.sshKeyPath.replace(/"/g, '\\"')
      const sshUser = gitCredentials.username.replace(/"/g, '\\"')
      env.GIT_SSH_COMMAND = `ssh -i "${keyPath}" -o IdentitiesOnly=yes${sshUser ? ` -o User="${sshUser}"` : ''}`
      if (gitCredentials.sshPassphrase) {
        const helper = createAskpassHelper({ username: '', password: '', passphrase: gitCredentials.sshPassphrase })
        env.GIT_ASKPASS = helper.path
        env.SSH_ASKPASS = helper.path
        env.SSH_ASKPASS_REQUIRE = 'force'
        env.DISPLAY = 'codesync'
        cleanup.push(helper.cleanup)
      }
    }
  }

  if (command === 'svn') {
    if (preparedArgs[0] !== '--version') {
      const svnCredentials = resolveSvnCredentials(options.svnCredentials)
      const authArgs = ['--trust-server-cert', '--non-interactive']
      if (svnCredentials.username) authArgs.push('--username', svnCredentials.username)
      if (svnCredentials.password) authArgs.push('--password', svnCredentials.password)
      preparedArgs = [
        ...preparedArgs.filter((argument) => argument !== '--non-interactive'),
        ...authArgs
      ]
      authSummary = svnAuthSummary(svnCredentials)
    }
  }

  return {
    args: preparedArgs,
    env,
    authSummary,
    cleanup: () => cleanup.splice(0).forEach((callback) => callback())
  }
}

function capture(command, args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    const session = createCommandSession(command, args, options)
    const child = spawn(command, session.args, { cwd, windowsHide: true, env: session.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => { session.cleanup(); reject(commandError(command, args, error)) })
    child.on('close', (code) => {
      session.cleanup()
      if (code === 0) return resolve({ stdout, stderr })
      const output = stripAnsi(stderr || stdout).trim()
      if (command === 'svn') return reject(svnError(output, session.authSummary))
      const authHint = session.authSummary ? `\n认证状态：${session.authSummary}` : ''
      reject(new Error(`${output || `${command} 返回错误码 ${code}`}${authHint}`))
    })
  })
}

function parseGitRefs(raw) {
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [hash, ref] = line.split(/\s+/)
    if (!hash || !ref) return null
    if (ref.startsWith('refs/heads/')) return { kind: 'branch', name: ref.slice(11), hash, ref }
    if (ref.startsWith('refs/tags/')) return { kind: 'tag', name: ref.slice(10), hash, ref }
    return null
  }).filter(Boolean)
}

async function probeGit(url) {
  const [headResult, refsResult] = await Promise.all([
    capture('git', ['ls-remote', '--symref', url, 'HEAD']),
    capture('git', ['ls-remote', '--heads', '--tags', '--refs', url])
  ])
  const headLine = headResult.stdout.split(/\r?\n/).find((line) => line.startsWith('ref: refs/heads/')) || ''
  const defaultBranch = headLine.match(/refs\/heads\/([^\s]+)/)?.[1] || ''
  const refs = parseGitRefs(refsResult.stdout).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
  return {
    provider: 'git',
    url,
    defaultBranch,
    latestRevision: refs.find((item) => item.kind === 'branch' && item.name === defaultBranch)?.hash || '',
    branches: refs.filter((item) => item.kind === 'branch'),
    tags: refs.filter((item) => item.kind === 'tag').slice(-100),
    checkedAt: new Date().toISOString()
  }
}

function parseSvnInfo(xml) {
  const entry = xml.match(/<entry\b[\s\S]*?<\/entry>/i)?.[0] || xml
  return {
    url: xmlTag(entry, 'url'),
    root: xmlTag(entry, 'root'),
    uuid: xmlTag(entry, 'uuid'),
    revision: xmlAttr(entry, 'revision') || xmlTag(entry, 'commit')
  }
}

async function probeSvn(url) {
  const normalizedUrl = normalizeSvnUrl(url)
  const info = parseSvnInfo((await capture('svn', ['info', '--xml', normalizedUrl])).stdout)
  const listResult = await capture('svn', ['list', '--xml', normalizedUrl]).catch(() => ({ stdout: '' }))
  const logResult = await capture('svn', ['log', '--xml', '-l', '100', normalizedUrl]).catch(() => ({ stdout: '' }))
  const directories = parseSvnListDirectories(listResult.stdout)
  const mainlines = await findSvnMainlines(normalizedUrl, directories)
  const revisions = [...logResult.stdout.matchAll(/<logentry\s+revision="([^"]+)"[\s\S]*?<author>([\s\S]*?)<\/author>[\s\S]*?<date>([\s\S]*?)<\/date>([\s\S]*?)<\/logentry>/gi)].map((match) => ({ revision: match[1], author: decodeXml(match[2].trim()), date: match[3].trim(), message: xmlTag(match[4], 'msg') }))
  const branchLike = directories.filter((name) => /^(trunk|branches|tags)$/i.test(name) || /^(branch|tag)[-_]/i.test(name))
  return {
    provider: 'svn',
    url: normalizedUrl,
    root: info.root,
    uuid: info.uuid,
    latestRevision: info.revision,
    directories,
    mainlines,
    branchLike,
    revisions,
    checkedAt: new Date().toISOString()
  }
}

function parseSvnListEntries(xml = '') {
  return [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)]
    .map((match) => match[0])
    .map((entry) => {
      const kind = /kind="(dir|file)"/i.exec(entry)?.[1]
      const name = xmlTag(entry, 'name').replace(/\/$/, '')
      return kind && name ? { name, kind } : null
    })
    .filter(Boolean)
}

function parseSvnListDirectories(xml = '') {
  return parseSvnListEntries(xml).filter((item) => item.kind === 'dir').map((item) => item.name)
}

function parseGitTree(raw = '') {
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const tab = line.indexOf('\t')
    if (tab <= 0) return null
    const type = line.slice(0, tab).split(/\s+/)[1]
    const name = line.slice(tab + 1)
    if (!name) return null
    return { name, kind: type === 'tree' ? 'dir' : 'file' }
  }).filter(Boolean)
}

function joinSvnUrl(base, child) {
  return `${normalizeSvnUrl(base).replace(/\/+$/, '')}/${child.split('/').map(encodeURIComponent).join('/')}`
}

async function findSvnMainlines(url, directories) {
  const directTrunk = directories.find((name) => name.toLowerCase() === 'trunk')
  if (directTrunk) return [{ path: directTrunk, url: joinSvnUrl(url, directTrunk) }]
  return []
}

async function probeRepository({ provider, url }) {
  if (!url || !url.trim()) throw new Error('请输入仓库地址。')
  const normalizedUrl = provider === 'svn' ? normalizeSvnUrl(url) : url.trim()
  return provider === 'svn' ? probeSvn(normalizedUrl) : probeGit(normalizedUrl)
}

let gitBrowseSession = null

function gitBrowseRef(version) {
  const name = typeof version?.name === 'string' ? version.name.trim() : ''
  return { name: name && name !== 'HEAD' ? name : '', kind: version?.kind === 'tag' ? 'tag' : 'branch' }
}

async function ensureGitBrowse(url, version) {
  const { name } = gitBrowseRef(version)
  if (gitBrowseSession && gitBrowseSession.url === url && gitBrowseSession.ref === name) {
    return gitBrowseSession.dir
  }
  if (gitBrowseSession?.dir) {
    try { fs.rmSync(gitBrowseSession.dir, { recursive: true, force: true }) } catch {}
    gitBrowseSession = null
  }
  const buildClone = (args, targetDir) => {
    const full = [...args]
    if (name) full.push('--branch', name)
    full.push(url, targetDir)
    return full
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codesync-browse-'))
  try {
    await capture('git', buildClone(['clone', '--depth', '1', '--filter=blob:none', '--sparse'], dir))
  } catch {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codesync-browse-'))
    try {
      await capture('git', buildClone(['clone', '--depth', '1', '--sparse'], plainDir))
    } catch (retryError) {
      try { fs.rmSync(plainDir, { recursive: true, force: true }) } catch {}
      throw retryError
    }
    gitBrowseSession = { url, ref: name, dir: plainDir }
    return plainDir
  }
  gitBrowseSession = { url, ref: name, dir }
  return dir
}

function gitSparsePattern(path) {
  const escaped = String(path).split('/').map((segment) => segment.replace(/([!#*?[\]\\])/g, '\\$1')).join('/')
  return `/${escaped}/`
}

async function browseRepository({ provider, url, path = '', revision, version }) {
  if (provider === 'svn') {
    const baseUrl = normalizeSvnUrl(url)
    const browseUrl = path ? joinSvnUrl(baseUrl, String(path)) : baseUrl
    const targetUrl = revision && revision !== 'HEAD' ? `${browseUrl}@${revision}` : browseUrl
    const result = await capture('svn', ['list', '--xml', targetUrl])
    return { provider: 'svn', url: baseUrl, path: String(path || ''), revision: revision || 'HEAD', entries: parseSvnListEntries(result.stdout) }
  }
  if (provider === 'git') {
    const dir = await ensureGitBrowse(url, version)
    const args = ['-C', dir, 'ls-tree', 'HEAD']
    let prefix = ''
    const cleanPath = String(path || '').replace(/^\/+|\/+$/g, '')
    if (cleanPath) {
      prefix = `${cleanPath}/`
      args.push('--', prefix)
    }
    const result = await capture('git', args)
    const entries = parseGitTree(result.stdout)
    if (prefix) entries.forEach((entry) => { if (entry.name.startsWith(prefix)) entry.name = entry.name.slice(prefix.length) })
    return { provider: 'git', url, path: cleanPath, entries }
  }
  throw new Error('不支持的版本控制系统。')
}

async function testRepositoryCredentials({ provider, url, credentials }) {
  if (!url || !url.trim()) throw new Error('请先在主界面填写仓库地址。')
  const gitCredentials = provider === 'git' ? resolveGitCredentials(credentials) : null
  if (provider === 'git') {
    if (gitCredentials.mode === 'https' && (!gitCredentials.username || !gitCredentials.token)) {
      throw new Error('请同时填写 Git HTTPS 用户名和密码 / Token 后再测试。')
    }
    if (gitCredentials.mode === 'ssh' && !gitCredentials.sshKeyPath) {
      throw new Error('请先选择 Git SSH 私钥文件后再测试。')
    }
    const result = await capture('git', ['ls-remote', '--symref', url.trim(), 'HEAD'], undefined, { gitCredentials })
    const headLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith('ref: refs/heads/')) || ''
    return { provider: 'git', url: url.trim(), branch: headLine.match(/refs\/heads\/([^\s]+)/)?.[1] || '' }
  }
  if (provider !== 'svn') throw new Error('当前只支持测试 Git / SVN 凭证。')
  const svnCredentials = resolveSvnCredentials(credentials)
  if (!svnCredentials.username || !svnCredentials.password) {
    throw new Error('请同时填写 SVN 用户名和密码后再测试。')
  }
  const normalizedUrl = normalizeSvnUrl(url)
  const result = await capture('svn', ['info', '--xml', normalizedUrl], undefined, { svnCredentials })
  const info = parseSvnInfo(result.stdout)
  return { provider: 'svn', url: normalizedUrl, revision: info.revision, username: svnCredentials.username }
}

async function inspectLocal({ target }) {
  if (!target || !target.trim()) throw new Error('请输入本地项目目录。')
  try {
    const result = await capture('git', ['-C', target.trim(), 'rev-parse', '--show-toplevel'])
    const branch = await capture('git', ['-C', target.trim(), 'branch', '--show-current']).catch(() => ({ stdout: '' }))
    return { provider: 'git', root: result.stdout.trim(), branch: branch.stdout.trim() }
  } catch {}
  try {
    const result = await capture('svn', ['info', '--xml', target.trim()])
    const info = parseSvnInfo(result.stdout)
    return { provider: 'svn', root: target.trim(), url: info.url, revision: info.revision }
  } catch {}
  throw new Error('目标目录不是可识别的 Git 或 SVN 工作副本。')
}

function emitLine(jobId, text, source = 'stdout') {
  const clean = stripAnsi(text).replace(/\r/g, '').trimEnd()
  if (!clean) return
  const percent = clean.match(/(?:^|\s)(\d{1,3})%/)?.[1]
  sendTaskEvent({ type: 'line', jobId, text: clean, source, percent: percent ? Number(percent) : null, time: new Date().toISOString() })
  if (percent) sendTaskEvent({ type: 'progress', jobId, value: Number(percent), label: clean })
}

function runProcess(jobId, command, args, cwd) {
  return new Promise((resolve, reject) => {
    const session = createCommandSession(command, args)
    const child = spawn(command, session.args, { cwd, windowsHide: true, env: session.env })
    if (activeJob?.jobId === jobId) activeJob.child = child
    let stderr = ''
    let stdout = ''
    let settled = false
    const finish = (callback, value) => { if (!settled) { settled = true; callback(value) } }
    child.stdout.on('data', (chunk) => { const value = chunk.toString(); stdout += value; value.split(/\r?\n|\r/).forEach((line) => emitLine(jobId, line, 'stdout')) })
    child.stderr.on('data', (chunk) => { const value = chunk.toString(); stderr += value; value.split(/\r?\n|\r/).forEach((line) => emitLine(jobId, line, 'stderr')) })
    child.on('error', (error) => { session.cleanup(); finish(reject, commandError(command, args, error)) })
    child.on('close', (code, signal) => {
      session.cleanup()
      if (signal === 'SIGTERM' || signal === 'SIGKILL') return finish(reject, new Error('任务已取消。'))
      if (code === 0) return finish(resolve, { stdout, stderr })
      const output = stripAnsi(stderr || stdout).trim()
      if (command === 'svn') return finish(reject, svnError(output, session.authSummary))
      const authHint = session.authSummary ? `\n认证状态：${session.authSummary}` : ''
      finish(reject, new Error(`${output || `${command} 返回错误码 ${code}`}${authHint}`))
    })
  })
}

async function runStep(jobId, label, command, args, cwd, progressStart, progressEnd) {
  sendTaskEvent({ type: 'step', jobId, label, value: progressStart })
  const result = await runProcess(jobId, command, args, cwd)
  sendTaskEvent({ type: 'progress', jobId, value: progressEnd, label })
  return result
}

async function runTask(payload) {
  if (activeJob) throw new Error('已有任务正在执行，请等待当前任务完成。')
  const jobId = crypto.randomUUID()
  activeJob = { jobId, child: null }
  const { provider, action, url, target, version, path: browsePath } = payload
  const svnUrl = provider === 'svn' ? normalizeSvnUrl(url) : url
  const sparsePath = typeof browsePath === 'string' ? browsePath.replace(/^\/+|\/+$/g, '') : ''
  sendTaskEvent({ type: 'start', jobId, label: action === 'pull' ? '开始拉取' : '开始更新', provider, action })
  try {
    if (provider === 'git' && action === 'pull') {
      if (sparsePath) {
        const label = `克隆 Git ${version?.name || '默认版本'}（仅 ${sparsePath}）`
        const sparseArgs = ['clone', '--progress', '--filter=blob:none', '--sparse']
        if (version?.name && version.name !== 'HEAD') sparseArgs.push('--branch', version.name)
        sparseArgs.push(url, target)
        try {
          await runStep(jobId, label, 'git', sparseArgs, undefined, 4, 72)
        } catch {
          if (fs.existsSync(target)) { try { fs.rmSync(target, { recursive: true, force: true }) } catch {} }
          const plainArgs = ['clone', '--progress', '--sparse']
          if (version?.name && version.name !== 'HEAD') plainArgs.push('--branch', version.name)
          plainArgs.push(url, target)
          await runStep(jobId, `${label}（服务器不支持部分克隆，已切换兼容模式）`, 'git', plainArgs, undefined, 4, 72)
        }
        await runStep(jobId, `设置稀疏检出 ${sparsePath}`, 'git', ['-C', target, 'sparse-checkout', 'set', '--no-cone', gitSparsePattern(sparsePath)], target, 78, 96)
      } else {
        const args = ['clone', '--progress']
        if (version?.name) args.push('--branch', version.name)
        args.push(url, target)
        await runStep(jobId, `克隆 Git ${version?.name || '默认版本'}`, 'git', args, undefined, 4, 92)
      }
    } else if (provider === 'git') {
      if (version?.kind === 'tag') {
        await runStep(jobId, `获取标签 ${version.name}`, 'git', ['-C', target, 'fetch', '--progress', 'origin', 'tag', version.name], target, 4, 70)
        if (sparsePath) await runStep(jobId, `设置稀疏检出 ${sparsePath}`, 'git', ['-C', target, 'sparse-checkout', 'set', '--no-cone', gitSparsePattern(sparsePath)], target, 72, 80)
        await runStep(jobId, `切换到标签 ${version.name}`, 'git', ['-C', target, 'checkout', '--detach', `refs/tags/${version.name}`], target, 82, 96)
      } else {
        let branch = version?.name || 'HEAD'
        if (branch === 'HEAD') {
          const currentBranch = await capture('git', ['-C', target, 'branch', '--show-current'], target).catch(() => ({ stdout: '' }))
          branch = currentBranch.stdout.trim() || 'HEAD'
        }
        const fetchArgs = ['-C', target, 'fetch', '--progress', '--prune', 'origin']
        if (branch !== 'HEAD') fetchArgs.push(branch)
        await runStep(jobId, `获取分支 ${branch}`, 'git', fetchArgs, target, 4, 55)
        if (sparsePath) await runStep(jobId, `设置稀疏检出 ${sparsePath}`, 'git', ['-C', target, 'sparse-checkout', 'set', '--no-cone', gitSparsePattern(sparsePath)], target, 57, 68)
        if (branch !== 'HEAD') await runStep(jobId, `更新分支 ${branch}`, 'git', ['-C', target, 'pull', '--progress', '--ff-only', 'origin', branch], target, 70, 96)
      }
    } else if (provider === 'svn' && action === 'pull') {
      const args = ['checkout', svnUrl]
      if (version?.revision && version.revision !== 'HEAD') args.push('--revision', version.revision)
      args.push(target)
      await runStep(jobId, `检出 SVN ${version?.label || version?.revision || 'HEAD'}`, 'svn', args, undefined, 4, 96)
    } else if (provider === 'svn' && sparsePath) {
      const args = ['switch', '--ignore-ancestry', svnUrl]
      if (version?.revision && version.revision !== 'HEAD') args.push('--revision', version.revision)
      args.push(target)
      await runStep(jobId, `切换 SVN 工作副本到 ${sparsePath} 并更新`, 'svn', args, target, 4, 96)
    } else {
      const args = ['update']
      if (version?.revision && version.revision !== 'HEAD') args.push('--revision', version.revision)
      args.push(target)
      await runStep(jobId, `更新 SVN ${version?.label || version?.revision || 'HEAD'}`, 'svn', args, target, 4, 96)
    }
    sendTaskEvent({ type: 'done', jobId, ok: true, value: 100, label: '任务完成' })
    return { jobId, ok: true }
  } catch (error) {
    sendTaskEvent({ type: 'done', jobId, ok: false, value: 100, label: error.message })
    throw error
  } finally {
    activeJob = null
  }
}

function toolStatus(command) {
  return capture(command, ['--version']).then((result) => ({ installed: true, version: stripAnsi(result.stdout || result.stderr).trim().split(/\r?\n/)[0] })).catch((error) => ({ installed: false, error: error.message }))
}

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#f5f7fa',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  })
  Menu.setApplicationMenu(null)
  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow.show() })
})

ipcMain.handle('path:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'], title: '选择本地项目目录' })
  return result.canceled ? '' : result.filePaths[0]
})
ipcMain.handle('path:choose-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], title: '选择 SSH 私钥文件' })
  return result.canceled ? '' : result.filePaths[0]
})
ipcMain.handle('repository:probe', (_, payload) => probeRepository(payload))
ipcMain.handle('repository:browse', (_, payload) => browseRepository(payload))
ipcMain.handle('credentials:test', (_, payload) => testRepositoryCredentials(payload))
ipcMain.handle('repository:inspect', (_, payload) => inspectLocal(payload))
ipcMain.handle('task:run', (_, payload) => runTask(payload))
ipcMain.handle('task:cancel', () => {
  if (!activeJob?.child) return false
  activeJob.child.kill('SIGTERM')
  return true
})
ipcMain.handle('tools:status', async () => ({ git: await toolStatus('git'), svn: await toolStatus('svn') }))
ipcMain.handle('credentials:get', () => credentialStatus())
ipcMain.handle('credentials:save', (_, payload) => updateCredentialStore(payload))
ipcMain.handle('credentials:clear', (_, provider) => clearCredentialProvider(provider))

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

app.on('will-quit', () => {
  if (gitBrowseSession?.dir) {
    try { fs.rmSync(gitBrowseSession.dir, { recursive: true, force: true }) } catch {}
  }
})

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, safeStorage, shell } = require('electron')
const { spawn, spawnSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const https = require('https')
const os = require('os')
const path = require('path')
const { URL } = require('url')

app.commandLine.appendSwitch('enable-font-antialiasing')
app.commandLine.appendSwitch('high-dpi-support', '1')

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

const gbkDecoder = new TextDecoder('gbk')
const utf8FatalDecoder = new TextDecoder('utf-8', { fatal: true })

function decodeProcessChunk(chunk) {
  if (!chunk) return ''
  if (typeof chunk === 'string') return chunk
  try {
    return utf8FatalDecoder.decode(chunk)
  } catch {
    try {
      return gbkDecoder.decode(chunk)
    } catch {
      return chunk.toString('utf8')
    }
  }
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

function isPrivateOrLocalHost(urlStr) {
  try {
    const raw = String(urlStr || '').trim()
    if (!raw) return false
    let host = ''
    if (raw.startsWith('git@')) {
      host = raw.slice(4).split(/[:/]/)[0].toLowerCase()
    } else {
      const u = new URL(raw)
      host = u.hostname.toLowerCase()
    }
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) || /^169\.254\./.test(host)) return true
    if (!host.includes('.')) return true
    if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.corp') || host.endsWith('.lan') || host.endsWith('.intra') || host.endsWith('.priv') || host.endsWith('.home')) return true
    return false
  } catch {
    return false
  }
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
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    SVN_INTERACTIVE: '0',
    LC_ALL: 'C.UTF-8',
    LANG: 'zh_CN.UTF-8'
  }
  const cleanup = []
  let preparedArgs = [...args]
  let authSummary = ''

  const targetUrl = options.targetUrl || args.find((a) => typeof a === 'string' && (/^https?:\/\//i.test(a) || /^svn(?:\+[a-z]+)?:\/\//i.test(a) || /^git@/i.test(a))) || ''

  if (targetUrl && isPrivateOrLocalHost(targetUrl)) {
    if (command === 'git') {
      preparedArgs.unshift('-c', 'http.proxy=')
    }
    delete env.HTTP_PROXY
    delete env.HTTPS_PROXY
    delete env.ALL_PROXY
    delete env.http_proxy
    delete env.https_proxy
    delete env.all_proxy
  }

  if (command === 'git') {
    if (preparedArgs[0] !== '--version') {
      preparedArgs.unshift(
        '-c', 'core.quotePath=false',
        '-c', 'i18n.commitEncoding=utf-8',
        '-c', 'i18n.logOutputEncoding=utf-8'
      )
    }
    const gitCredentials = resolveGitCredentials(options.gitCredentials)
    authSummary = gitAuthSummary(gitCredentials)
    if (gitCredentials.mode === 'https' && (gitCredentials.username || gitCredentials.token)) {
      env.CODESYNC_GIT_USERNAME = gitCredentials.username
      env.CODESYNC_GIT_TOKEN = gitCredentials.token
      if (gitCredentials.token && preparedArgs[0] !== '--version') {
        const authUser = gitCredentials.username || 'x-access-token'
        const basicAuth = Buffer.from(`${authUser}:${gitCredentials.token}`, 'utf8').toString('base64')
        preparedArgs.unshift('-c', 'credential.helper=', '-c', `http.extraHeader=Authorization: Basic ${basicAuth}`)
      }
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
    const outChunks = []
    const errChunks = []
    child.stdout.on('data', (chunk) => { outChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) })
    child.stderr.on('data', (chunk) => { errChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) })
    child.on('error', (error) => { session.cleanup(); reject(commandError(command, args, error)) })
    child.on('close', (code) => {
      session.cleanup()
      const stdout = outChunks.length ? decodeProcessChunk(Buffer.concat(outChunks)) : ''
      const stderr = errChunks.length ? decodeProcessChunk(Buffer.concat(errChunks)) : ''
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
  const cleanUrl = url.trim()

  let refsOutput = ''
  try {
    const refsResult = await capture('git', ['ls-remote', '--heads', '--tags', cleanUrl], os.tmpdir(), { targetUrl: cleanUrl })
    refsOutput = refsResult.stdout
  } catch (err1) {
    try {
      const fallbackResult = await capture('git', ['ls-remote', cleanUrl], os.tmpdir(), { targetUrl: cleanUrl })
      refsOutput = fallbackResult.stdout
    } catch {
      throw err1
    }
  }

  let defaultBranch = ''
  try {
    const headResult = await capture('git', ['ls-remote', '--symref', cleanUrl, 'HEAD'], os.tmpdir(), { targetUrl: cleanUrl })
    const headLine = headResult.stdout.split(/\r?\n/).find((line) => line.startsWith('ref: refs/heads/')) || ''
    defaultBranch = headLine.match(/refs\/heads\/([^\s]+)/)?.[1] || ''
  } catch {}

  const refs = parseGitRefs(refsOutput).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
  const branches = refs.filter((item) => item.kind === 'branch')
  const tags = refs.filter((item) => item.kind === 'tag')

  if (!defaultBranch && branches.length) {
    const found = branches.find((b) => b.name === 'master' || b.name === 'main')
    defaultBranch = found ? found.name : branches[0].name
  }

  return {
    provider: 'git',
    url: cleanUrl,
    defaultBranch: defaultBranch || 'HEAD',
    latestRevision: refs.find((item) => item.kind === 'branch' && item.name === defaultBranch)?.hash || '',
    branches,
    tags: tags.slice(-100),
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
    const remote = await capture('git', ['-C', target.trim(), 'config', '--get', 'remote.origin.url']).catch(() => ({ stdout: '' }))
    return { provider: 'git', root: result.stdout.trim(), branch: branch.stdout.trim(), url: remote.stdout.trim() }
  } catch {}
  try {
    const result = await capture('svn', ['info', '--xml', target.trim()])
    const info = parseSvnInfo(result.stdout)
    return { provider: 'svn', root: target.trim(), url: info.url, revision: info.revision }
  } catch {}
  throw new Error('目标目录不是可识别的 Git 或 SVN 工作副本。')
}

function scanPlainDirectoryFiles(rootDir, maxCount = 200) {
  const results = []
  const ignoreSet = new Set(['.git', '.svn', 'node_modules', 'dist', 'build', '.next', 'out'])
  function walk(currentDir) {
    if (results.length >= maxCount) return
    let entries = []
    try { entries = fs.readdirSync(currentDir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (results.length >= maxCount) break
      if (ignoreSet.has(entry.name)) continue
      const fullPath = path.join(currentDir, entry.name)
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        walk(fullPath)
      } else {
        results.push({ path: relPath, displayPath: relPath, status: 'U', label: '待新增', staged: false })
      }
    }
  }
  walk(rootDir)
  return results
}

async function inspectPushWorkspace({ target }) {
  if (!target || !target.trim()) throw new Error('请先选择或输入本地项目目录。')
  const cleanTarget = target.trim()
  if (!fs.existsSync(cleanTarget)) throw new Error('本地项目目录不存在，请检查路径是否正确。')
  const stat = fs.statSync(cleanTarget)
  if (!stat.isDirectory()) throw new Error('所选路径不是有效文件夹。')

  try {
    const topResult = await capture('git', ['-C', cleanTarget, 'rev-parse', '--show-toplevel'], cleanTarget)
    const root = topResult.stdout.trim() || cleanTarget
    const branchRes = await capture('git', ['-C', cleanTarget, 'branch', '--show-current'], cleanTarget).catch(() => ({ stdout: '' }))
    const symRefRes = !branchRes.stdout.trim()
      ? await capture('git', ['-C', cleanTarget, 'symbolic-ref', '--short', 'HEAD'], cleanTarget).catch(() => ({ stdout: '' }))
      : { stdout: '' }
    const branch = branchRes.stdout.trim() || symRefRes.stdout.trim() || 'main'
    const branchesRes = await capture('git', ['-C', cleanTarget, 'branch', '--format=%(refname:short)'], cleanTarget).catch(() => ({ stdout: '' }))
    const branchList = branchesRes.stdout.split(/\r?\n/).map((b) => b.trim()).filter(Boolean)
    if (!branchList.includes(branch)) branchList.unshift(branch)
    const remoteRes = await capture('git', ['-C', cleanTarget, 'config', '--get', 'remote.origin.url'], cleanTarget).catch(() => ({ stdout: '' }))
    const url = remoteRes.stdout.trim()

    let ahead = 0
    let behind = 0
    try {
      const abRes = await capture('git', ['-C', cleanTarget, 'rev-list', '--left-right', '--count', 'HEAD...@{u}'], cleanTarget)
      const parts = abRes.stdout.trim().split(/\s+/)
      ahead = Number(parts[0]) || 0
      behind = Number(parts[1]) || 0
    } catch {
      if (url && branch) {
        try {
          const aheadRes = await capture('git', ['-C', cleanTarget, 'rev-list', '--count', `origin/${branch}..HEAD`], cleanTarget)
          ahead = Number(aheadRes.stdout.trim()) || 0
        } catch {}
      }
    }

    const lastCommitRes = await capture('git', ['-C', cleanTarget, 'log', '-1', '--pretty=format:%h|||%s'], cleanTarget).catch(() => ({ stdout: '' }))
    const rawLastCommit = lastCommitRes.stdout.trim()
    let formattedLastCommit = ''
    if (rawLastCommit) {
      const [hashPart, ...subjectParts] = rawLastCommit.split('|||')
      const zhSubject = translateCommitSubjectToChinese(subjectParts.join('|||'))
      formattedLastCommit = `${hashPart} · ${zhSubject}`
    }
    const statusRes = await capture('git', ['-c', 'core.quotePath=false', '-C', cleanTarget, 'status', '--porcelain=v1', '-uall'], cleanTarget).catch(() => ({ stdout: '' }))
    const changes = statusRes.stdout
      .split(/\r?\n/)
      .filter((line) => line.length > 3)
      .map((line) => {
        const xy = line.slice(0, 2)
        const rawPath = line.slice(3).trim().replace(/^"+|"+$/g, '')
        const cleanFile = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop().trim().replace(/^"+|"+$/g, '') : rawPath
        let status = 'M'
        let label = '已修改'
        if (xy === '??') { status = 'U'; label = '未跟踪' }
        else if (xy.includes('D')) { status = 'D'; label = '已删除' }
        else if (xy.includes('A')) { status = 'A'; label = '新增' }
        else if (xy.includes('R')) { status = 'R'; label = '重命名' }
        else if (xy.includes('U')) { status = 'C'; label = '冲突' }
        return {
          path: cleanFile,
          displayPath: rawPath,
          status,
          label,
          staged: xy[0] !== ' ' && xy[0] !== '?',
          committed: false
        }
      })

    if (ahead > 0) {
      let aheadDiffOut = ''
      try {
        const res = await capture('git', ['-C', cleanTarget, 'diff', '--name-status', '@{u}..HEAD'], cleanTarget)
        aheadDiffOut = res.stdout
      } catch {
        try {
          const res = await capture('git', ['-C', cleanTarget, 'diff', '--name-status', `origin/${branch}..HEAD`], cleanTarget)
          aheadDiffOut = res.stdout
        } catch {
          try {
            const res = await capture('git', ['-C', cleanTarget, 'diff', '--name-status', `HEAD~${ahead}..HEAD`], cleanTarget)
            aheadDiffOut = res.stdout
          } catch {}
        }
      }
      const existingPaths = new Set(changes.map((c) => c.path))
      aheadDiffOut
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach((line) => {
          const parts = line.split(/\t+/)
          if (parts.length < 2) return
          const code = parts[0].charAt(0).toUpperCase()
          const filePath = parts[parts.length - 1].replace(/^"+|"+$/g, '')
          if (!filePath || existingPaths.has(filePath)) return
          existingPaths.add(filePath)
          let status = 'M'
          let label = '已修改'
          if (code === 'A') { status = 'A'; label = '新增' }
          else if (code === 'D') { status = 'D'; label = '已删除' }
          else if (code === 'R') { status = 'R'; label = '重命名' }
          changes.push({
            path: filePath,
            displayPath: filePath,
            status,
            label,
            staged: true,
            committed: true
          })
        })
    }

    return {
      provider: 'git',
      initialized: true,
      root,
      branch,
      branches: branchList,
      url,
      ahead,
      behind,
      lastCommit: formattedLastCommit,
      changes
    }
  } catch {}

  try {
    const infoRes = await capture('svn', ['info', '--xml', cleanTarget], cleanTarget)
    const info = parseSvnInfo(infoRes.stdout)
    const statusRes = await capture('svn', ['status', '--xml', cleanTarget], cleanTarget).catch(() => ({ stdout: '' }))
    const changes = []
    const entryMatches = statusRes.stdout.match(/<entry\s+path="[^"]+"[\s\S]*?<\/entry>/gi) || []
    for (const block of entryMatches) {
      const entryPath = xmlAttr(block, 'path')
      const wcMatch = block.match(/<wc-status[^>]*>/i)?.[0] || ''
      const item = xmlAttr(wcMatch, 'item').toLowerCase()
      if (!entryPath || ['normal', 'none', 'ignored', 'external'].includes(item)) continue
      const rel = path.relative(cleanTarget, entryPath).replace(/\\/g, '/')
      if (!rel || rel === '.') continue
      let status = 'M'
      let label = '已修改'
      if (item === 'unversioned') { status = 'U'; label = '未受控' }
      else if (item === 'added') { status = 'A'; label = '新增' }
      else if (item === 'deleted' || item === 'missing') { status = 'D'; label = item === 'missing' ? '缺失' : '已删除' }
      else if (item === 'conflicted') { status = 'C'; label = '冲突' }
      changes.push({ path: rel, displayPath: rel, status, label, item, staged: item !== 'unversioned' })
    }
    return {
      provider: 'svn',
      initialized: true,
      root: cleanTarget,
      branch: 'HEAD',
      branches: ['HEAD'],
      url: info.url || '',
      revision: info.revision || 'HEAD',
      ahead: 0,
      behind: 0,
      lastCommit: info.revision ? `r${info.revision}` : '',
      changes
    }
  } catch {}

  const plainFiles = scanPlainDirectoryFiles(cleanTarget)
  return {
    provider: null,
    initialized: false,
    root: cleanTarget,
    branch: 'main',
    branches: ['main', 'master'],
    url: '',
    ahead: 0,
    behind: 0,
    lastCommit: '',
    changes: plainFiles
  }
}

async function getWorkspaceDiff({ provider, target, filePath }) {
  if (!target || !fs.existsSync(target)) throw new Error('本地项目目录不存在。')
  const cleanTarget = target.trim()
  if (provider === 'svn') {
    const args = ['diff']
    if (filePath) args.push(path.join(cleanTarget, filePath))
    else args.push(cleanTarget)
    const res = await capture('svn', args, cleanTarget).catch((e) => ({ stdout: e.message || '' }))
    return { diff: stripAnsi(res.stdout || '').trim() || '暂无可显示的差异内容（可能是新增未受控文件或二进制文件）。' }
  }
  const args = ['-c', 'core.quotePath=false', '-C', cleanTarget, 'diff', 'HEAD']
  if (filePath) args.push('--', filePath)
  const res = await capture('git', args, cleanTarget).catch(() => ({ stdout: '' }))
  let diffText = stripAnsi(res.stdout || '').trim()
  if (!diffText && filePath) {
    // Try unpushed commits diff (@{u}..HEAD or HEAD~1..HEAD)
    const upRes = await capture('git', ['-c', 'core.quotePath=false', '-C', cleanTarget, 'diff', '@{u}..HEAD', '--', filePath], cleanTarget).catch(() => ({ stdout: '' }))
    diffText = stripAnsi(upRes.stdout || '').trim()
  }
  if (!diffText && filePath) {
    const showRes = await capture('git', ['-c', 'core.quotePath=false', '-C', cleanTarget, 'show', 'HEAD', '--format=', '--', filePath], cleanTarget).catch(() => ({ stdout: '' }))
    diffText = stripAnsi(showRes.stdout || '').trim()
  }
  if (!diffText && filePath) {
    const full = path.join(cleanTarget, filePath)
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      try {
        const content = fs.readFileSync(full, 'utf8').slice(0, 6000)
        diffText = `--- /dev/null\n+++ b/${filePath}\n${content.split(/\r?\n/).map((l) => `+${l}`).join('\n')}`
      } catch {}
    }
  }
  return { diff: diffText || '暂无可显示的差异内容。' }
}

async function scanLocalRepos({ rootDir }) {
  if (!rootDir || !rootDir.trim()) throw new Error('请先选择要扫描的本地根目录。')
  const cleanRoot = rootDir.trim()
  if (!fs.existsSync(cleanRoot)) throw new Error('所选目录不存在。')

  const repoDirs = []
  const seenPaths = new Set()
  const ignoreDirs = new Set(['.git', '.svn', 'node_modules', 'dist', 'build', '.next', 'out', 'release-portable', 'release-installer-codesync'])

  function addRepo(dir, provider) {
    const normalized = path.resolve(dir)
    if (seenPaths.has(normalized)) return
    seenPaths.add(normalized)
    repoDirs.push({ path: normalized, name: path.basename(normalized) || normalized, provider })
  }

  function discover(dir, depth = 0) {
    if (depth > 3 || repoDirs.length >= 60) return
    let hasGit = false
    let hasSvn = false
    try {
      hasGit = fs.existsSync(path.join(dir, '.git'))
      hasSvn = !hasGit && fs.existsSync(path.join(dir, '.svn'))
    } catch {}
    if (hasGit || hasSvn) {
      addRepo(dir, hasGit ? 'git' : 'svn')
      return
    }
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory() || ignoreDirs.has(entry.name) || entry.name.startsWith('.')) continue
      discover(path.join(dir, entry.name), depth + 1)
    }
  }

  discover(cleanRoot, 0)

  // If the user selected a subdirectory inside a Git/SVN repository, walk up to find the enclosing repo root
  if (repoDirs.length === 0) {
    let curr = path.resolve(cleanRoot)
    for (let i = 0; i < 4; i++) {
      const parent = path.dirname(curr)
      if (!parent || parent === curr) break
      curr = parent
      try {
        if (fs.existsSync(path.join(curr, '.git'))) {
          addRepo(curr, 'git')
          break
        }
        if (fs.existsSync(path.join(curr, '.svn'))) {
          addRepo(curr, 'svn')
          break
        }
      } catch {}
    }
  }

  const results = []
  const concurrency = 4
  let idx = 0
  const workers = Array.from({ length: Math.min(concurrency, repoDirs.length) }, async () => {
    while (idx < repoDirs.length) {
      const item = repoDirs[idx++]
      try {
        const info = await inspectPushWorkspace({ target: item.path })
        results.push({
          id: item.path,
          name: item.name,
          target: item.path,
          provider: info.provider || item.provider,
          branch: info.branch || (item.provider === 'svn' ? `r${info.revision || 'HEAD'}` : 'main'),
          url: info.url || '',
          changesCount: info.changes?.length || 0,
          ahead: info.ahead || 0,
          behind: info.behind || 0,
          lastCommit: info.lastCommit || ''
        })
      } catch {
        results.push({
          id: item.path,
          name: item.name,
          target: item.path,
          provider: item.provider,
          branch: 'HEAD',
          url: '',
          changesCount: 0,
          ahead: 0,
          behind: 0,
          lastCommit: ''
        })
      }
    }
  })
  await Promise.all(workers)
  return { rootDir: cleanRoot, repos: results, repositories: results }
}

function formatReleaseBytes(bytes) {
  const num = Number(bytes) || 0
  if (num < 1024) return `${num} B`
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`
  return `${(num / 1024 / 1024).toFixed(2)} MB`
}

function parseGitRemoteRepo(rawUrl = '') {
  const url = String(rawUrl || '').trim().replace(/\/+$/, '').replace(/\.git$/i, '')
  if (!url) return null
  const sshMatch = url.match(/^git@([^:]+):([^/]+)\/(.+)$/i)
  if (sshMatch) {
    const host = sshMatch[1].toLowerCase()
    return {
      host,
      platform: host.includes('gitee.com') ? 'gitee' : 'github',
      owner: sshMatch[2],
      repo: sshMatch[3]
    }
  }
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts.length >= 2) {
      const host = parsed.hostname.toLowerCase()
      return {
        host,
        platform: host.includes('gitee.com') ? 'gitee' : 'github',
        owner: parts[0],
        repo: parts[1]
      }
    }
  } catch {}
  return null
}

function scanReleaseArtifacts(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return []
  const candidateDirs = [
    path.join(rootDir, 'release-installer-codesync'),
    path.join(rootDir, 'release-portable'),
    path.join(rootDir, 'release'),
    path.join(rootDir, 'out'),
    path.join(rootDir, 'dist')
  ]
  const validExts = new Set(['.exe', '.zip', '.msi', '.dmg', '.7z', '.gz', '.deb', '.rpm', '.appimage'])
  const seenUploadNames = new Set()
  const assets = []

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const lower = entry.name.toLowerCase()
      if (lower.includes('__uninstaller') || lower === 'elevate.exe' || lower.endsWith('.blockmap')) continue
      const ext = path.extname(lower)
      if (!validExts.has(ext)) continue
      const fullPath = path.join(dir, entry.name)
      let stat
      try { stat = fs.statSync(fullPath) } catch { continue }
      if (stat.size < 1024) continue
      const uploadName = /setup/i.test(entry.name) ? entry.name.replace(/\s+/g, '.') : entry.name
      if (seenUploadNames.has(uploadName)) continue
      seenUploadNames.add(uploadName)
      assets.push({
        path: fullPath,
        name: entry.name,
        uploadName,
        size: stat.size
      })
    }
  }
  return assets
}

function translateCommitSubjectToChinese(rawSubject = '') {
  let text = String(rawSubject || '').trim()
  if (!text) return '常规功能升级与细节体验优化'

  const prefixMap = {
    feat: '新增',
    feature: '新增',
    fix: '修复',
    bugfix: '修复',
    hotfix: '修复',
    perf: '优化',
    optimize: '优化',
    refactor: '重构',
    style: '界面',
    ui: '界面',
    docs: '文档',
    doc: '文档',
    chore: '维护',
    build: '构建',
    ci: '构建',
    test: '测试',
    revert: '回滚'
  }

  let category = ''
  const conventionalMatch = text.match(/^([a-zA-Z]+)(?:\([^)]+\))?!?:\s*(.+)$/)
  if (conventionalMatch) {
    const key = conventionalMatch[1].toLowerCase()
    category = prefixMap[key] || '更新'
    text = conventionalMatch[2].trim()
  }

  // If the text already contains Chinese characters, keep it directly
  if (/[\u4e00-\u9fa5]/.test(text)) {
    return category ? `${category}：${text}` : text
  }

  const exactRules = [
    [
      /^release\s+(v?[\d.]+)\s*[-–—:]\s*add code push,\s*workspace manager,\s*batch sparse checkout\s*&\s*dark titlebar$/i,
      (_, v) => `发布 ${v} 版本，新增代码推送、本地仓库管理、批量子目录检出与深色标题栏`
    ],
    [
      /^release\s+(v?[\d.]+)\s*[-–—:]\s*cyber-tech cockpit ui overhaul and logic enhancements$/i,
      (_, v) => `发布 ${v} 版本，升级深空科技感界面与核心同步逻辑`
    ],
    [
      /^update release script for\s+(v?[\d.]+)$/i,
      (_, v) => `更新 ${v} 版本自动化发布脚本`
    ],
    [
      /^bump version to\s+(v?[\d.]+)$/i,
      (_, v) => `升级软件版本号至 ${v}`
    ],
    [
      /^optimize full-screen viewport layout,\s*font rendering and history tab$/i,
      () => '优化全屏单页视口布局、字体渲染质感与同步记录页面'
    ],
    [
      /^add release publishing utility script$/i,
      () => '新增版本打包与 Release 发布工具脚本'
    ],
    [
      /^generalize private host detection and remove specific corporate domain reference$/i,
      () => '优化内网私有域名自动识别逻辑'
    ],
    [
      /^resolve svn trunk mainline url,\s*fix gbk encoding in terminal\s*&\s*fix right panel height sync$/i,
      () => '修复 SVN 主线 trunk 识别、终端中文编码与右侧面板高度同步问题'
    ],
    [
      /^refine desktop ui layout inspired by wechat,\s*dingtalk and qq nt$/i,
      () => '优化桌面端侧边导航与双栏工作台布局体验'
    ],
    [
      /^complete ui redesign with modern light-blue card-based layout and brand new logo$/i,
      () => '重构现代化卡片式界面布局并升级全新应用图标'
    ],
    [
      /^bypass proxy for internal hosts\s*&\s*fix credential helper in windows$/i,
      () => '支持内网地址自动绕过代理并修复 Windows 凭据认证问题'
    ],
    [
      /^auto-probe git branches\s*&\s*remove default branch filter in dropdown$/i,
      () => '支持自动读取 Git 分支列表并优化分支下拉选择交互'
    ],
    [
      /^sync code via codesync studio$/i,
      () => '通过 CodeSync Studio 同步代码'
    ],
    [
      /^commit code via codesync studio$/i,
      () => '通过 CodeSync Studio 提交代码'
    ],
    [
      /^initial commit$/i,
      () => '初始化项目仓库'
    ],
    [
      /^update readme(?:\.md)?$/i,
      () => '更新 README 项目说明文档'
    ]
  ]

  for (const [pattern, replacer] of exactRules) {
    const match = text.match(pattern)
    if (match) {
      const translated = replacer(...match)
      return category ? `${category}：${translated}` : translated
    }
  }

  let translated = text
    .replace(/\brelease\s+(v?[\d.]+)\b/gi, '发布 $1 版本')
    .replace(/\bbump version to\s+(v?[\d.]+)\b/gi, '升级版本号至 $1')
    .replace(/\bupdate\b/gi, '更新')
    .replace(/\badd\b/gi, '新增')
    .replace(/\bfix\b/gi, '修复')
    .replace(/\bresolve\b/gi, '解决')
    .replace(/\boptimize\b/gi, '优化')
    .replace(/\bimprove\b/gi, '改进')
    .replace(/\brefactor\b/gi, '重构')
    .replace(/\bremove\b/gi, '移除')
    .replace(/\bsupport\b/gi, '支持')
    .replace(/\b layout\b/gi, '布局')
    .replace(/\bui\b/gi, '界面')
    .replace(/\bbug\b/gi, '问题')
    .replace(/\bscript\b/gi, '脚本')
    .replace(/\bconfig\b/gi, '配置')
    .replace(/\s+/g, ' ')
    .trim()

  if (!/[\u4e00-\u9fa5]/.test(translated)) {
    translated = `${category || '更新'}相关功能与细节优化`
  }

  return category && !translated.startsWith(category) ? `${category}：${translated}` : translated
}

function formatRecentCommitsToChinese(rawLog = '') {
  const lines = String(rawLog || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return '- 新增：常规功能升级与细节体验优化'

  return lines
    .map((line) => {
      const cleaned = line.replace(/^-\s*/, '')
      const hashMatch = cleaned.match(/^(.*)\s+\(([0-9a-f]{6,12})\)$/i)
      if (hashMatch) {
        const zh = translateCommitSubjectToChinese(hashMatch[1])
        return `- ${zh} (${hashMatch[2]})`
      }
      return `- ${translateCommitSubjectToChinese(cleaned)}`
    })
    .join('\n')
}

async function inspectReleaseWorkspace({ target }) {
  if (!target || !target.trim()) throw new Error('请先选择本地项目目录。')
  let cleanTarget = path.resolve(target.trim())
  if (!fs.existsSync(cleanTarget)) throw new Error('本地项目目录不存在。')

  // If a subdirectory inside a git repo was chosen, walk up to the repo root
  if (!fs.existsSync(path.join(cleanTarget, '.git'))) {
    let curr = cleanTarget
    for (let i = 0; i < 4; i++) {
      const parent = path.dirname(curr)
      if (!parent || parent === curr) break
      curr = parent
      if (fs.existsSync(path.join(curr, '.git'))) {
        cleanTarget = curr
        break
      }
    }
  }

  let pkgName = path.basename(cleanTarget)
  let pkgVersion = ''
  const pkgPath = path.join(cleanTarget, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      pkgName = pkg.build?.productName || pkg.productName || pkg.name || pkgName
      pkgVersion = pkg.version || ''
    } catch {}
  }

  const remoteRes = await capture('git', ['-C', cleanTarget, 'config', '--get', 'remote.origin.url'], cleanTarget).catch(() => ({ stdout: '' }))
  const branchRes = await capture('git', ['-C', cleanTarget, 'branch', '--show-current'], cleanTarget).catch(() => ({ stdout: '' }))
  const branchesRes = await capture('git', ['-C', cleanTarget, 'branch', '--format=%(refname:short)'], cleanTarget).catch(() => ({ stdout: '' }))
  const tagsRes = await capture('git', ['-C', cleanTarget, 'tag', '--sort=-creatordate'], cleanTarget).catch(() => ({ stdout: '' }))
  const logRes = await capture('git', ['-C', cleanTarget, 'log', '-n', '12', '--pretty=format:- %s (%h)'], cleanTarget).catch(() => ({ stdout: '' }))

  const url = stripAnsi(remoteRes.stdout || '').trim()
  const branch = stripAnsi(branchRes.stdout || '').trim() || 'main'
  const branches = stripAnsi(branchesRes.stdout || '').split(/\r?\n/).map((b) => b.trim()).filter(Boolean)
  if (!branches.includes(branch)) branches.unshift(branch)
  const tags = stripAnsi(tagsRes.stdout || '').split(/\r?\n/).map((t) => t.trim()).filter(Boolean)
  const recentCommits = formatRecentCommitsToChinese(stripAnsi(logRes.stdout || '').trim())
  const suggestedTag = pkgVersion ? `v${pkgVersion.replace(/^v/i, '')}` : (tags[0] || 'v1.0.0')
  const suggestedTitle = `${pkgName} ${suggestedTag}`
  const discoveredAssets = scanReleaseArtifacts(cleanTarget)
  const parsedRepo = parseGitRemoteRepo(url)

  return {
    root: cleanTarget,
    url,
    branch,
    branches,
    tags,
    pkgName,
    pkgVersion,
    suggestedTag,
    suggestedTitle,
    recentCommits,
    discoveredAssets,
    parsedRepo,
    tokenConfigured: Boolean(resolveReleaseToken(''))
  }
}

function getSystemGcmCredential(host = 'github.com') {
  try {
    const res = spawnSync('git', ['-c', 'credential.helper=', '-c', 'credential.helper=manager', 'credential', 'fill'], {
      input: `protocol=https\nhost=${host}\n\n`,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0' },
      timeout: 3500
    })
    const lines = (res.stdout || '').split(/\r?\n/)
    const username = lines.find((l) => l.startsWith('username='))?.slice(9).trim() || 'x-access-token'
    const token = lines.find((l) => l.startsWith('password='))?.slice(9).trim() || ''
    if (token) return { username, token }
  } catch {}
  return null
}

function resolveReleaseTokenCandidates(explicitToken, host = 'github.com') {
  const candidates = []
  if (typeof explicitToken === 'string' && explicitToken.trim()) candidates.push(explicitToken.trim())
  const storedToken = loadCredentialStore().git?.token
  if (typeof storedToken === 'string' && storedToken.trim()) candidates.push(storedToken.trim())
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim()) candidates.push(process.env.GITHUB_TOKEN.trim())
  const gcm = getSystemGcmCredential(host)
  if (gcm?.token) candidates.push(gcm.token)
  return [...new Set(candidates)]
}

function resolveReleaseToken(explicitToken, host = 'github.com') {
  return resolveReleaseTokenCandidates(explicitToken, host)[0] || ''
}

function httpsJsonRequest(options, postData, jobId) {
  return new Promise((resolve, reject) => {
    const payloadBuffer = postData
      ? (Buffer.isBuffer(postData) ? postData : Buffer.from(String(postData), 'utf8'))
      : null
    const headers = { ...(options.headers || {}) }
    if (payloadBuffer) {
      headers['Content-Type'] = 'application/json; charset=utf-8'
      headers['Content-Length'] = payloadBuffer.byteLength
    }
    const req = https.request({ ...options, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
      res.on('end', () => {
        const body = chunks.length ? Buffer.concat(chunks).toString('utf8') : ''
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body), raw: body })
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, data: null, raw: body })
        }
      })
    })
    if (activeJob?.jobId === jobId) {
      activeJob.abort = () => { try { req.destroy(new Error('任务已取消。')) } catch {} }
    }
    req.on('error', reject)
    if (payloadBuffer) req.write(payloadBuffer)
    req.end()
  })
}

function uploadReleaseAssetWithProgress({ jobId, uploadUrlTemplate, asset, assetIndex, totalAssets, grandTotalBytes, uploadedBeforeThisAsset, token }) {
  return new Promise((resolve, reject) => {
    const uploadName = (asset.uploadName || asset.name || path.basename(asset.path)).trim()
    const uploadUrl = uploadUrlTemplate.replace(/\{\?name,label\}/, `?name=${encodeURIComponent(uploadName)}`)
    const parsed = new URL(uploadUrl)
    const stats = fs.statSync(asset.path)
    const fileSize = stats.size

    const options = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'User-Agent': 'CodeSync-Studio-Release-Publisher',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileSize
      }
    }

    const startTime = Date.now()
    let uploaded = 0
    let lastEmitTime = 0
    let lastLoggedMilestone = -1

    sendTaskEvent({
      type: 'step',
      jobId,
      value: Math.min(97, 28 + Math.round((uploadedBeforeThisAsset / Math.max(1, grandTotalBytes)) * 68)),
      label: `开始上传附件 (${assetIndex + 1}/${totalAssets}): ${uploadName} (${formatReleaseBytes(fileSize)})`,
      releaseAssetProgress: {
        path: asset.path,
        status: 'uploading',
        percent: 0,
        uploadedBytes: 0,
        totalBytes: fileSize,
        speed: '0.0 MB/s'
      }
    })
    emitLine(jobId, `[上传 ${assetIndex + 1}/${totalAssets}] 开始传输 ${uploadName} (${formatReleaseBytes(fileSize)})...`, 'stdout')

    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          let parsedBody = null
          try { parsedBody = JSON.parse(body) } catch {}
          const overallPct = Math.min(98, 28 + Math.round(((uploadedBeforeThisAsset + fileSize) / Math.max(1, grandTotalBytes)) * 68))
          sendTaskEvent({
            type: 'step',
            jobId,
            value: overallPct,
            label: `附件上传完成 (${assetIndex + 1}/${totalAssets}): ${uploadName}`,
            releaseAssetProgress: {
              path: asset.path,
              status: 'done',
              percent: 100,
              uploadedBytes: fileSize,
              totalBytes: fileSize,
              speed: '完成',
              downloadUrl: parsedBody?.browser_download_url || ''
            }
          })
          emitLine(jobId, `[完成 ${assetIndex + 1}/${totalAssets}] ${uploadName} 上传成功 (100% · ${formatReleaseBytes(fileSize)})`, 'stdout')
          resolve(parsedBody)
        } else {
          sendTaskEvent({
            type: 'step',
            jobId,
            value: 28,
            label: `附件上传失败: ${uploadName}`,
            releaseAssetProgress: {
              path: asset.path,
              status: 'error',
              percent: 0,
              uploadedBytes: uploaded,
              totalBytes: fileSize,
              speed: '失败'
            }
          })
          reject(new Error(`上传附件 ${uploadName} 失败 (HTTP ${res.statusCode}): ${body}`))
        }
      })
    })

    const stream = fs.createReadStream(asset.path, { highWaterMark: 256 * 1024 })
    if (activeJob?.jobId === jobId) {
      activeJob.abort = () => {
        try { stream.destroy() } catch {}
        try { req.destroy(new Error('任务已取消。')) } catch {}
      }
    }

    req.on('error', (err) => {
      try { stream.destroy() } catch {}
      reject(err)
    })

    stream.on('data', (chunk) => {
      uploaded += chunk.length
      const now = Date.now()
      const filePct = Math.min(100, Math.round((uploaded / Math.max(1, fileSize)) * 100))
      const milestone = Math.floor(filePct / 20) * 20
      if (now - lastEmitTime >= 160 || uploaded === fileSize) {
        lastEmitTime = now
        const elapsedSec = Math.max(0.1, (now - startTime) / 1000)
        const speedMB = (uploaded / 1024 / 1024) / elapsedSec
        const speedText = `${speedMB.toFixed(1)} MB/s`
        const overallPct = Math.min(98, 28 + Math.round(((uploadedBeforeThisAsset + uploaded) / Math.max(1, grandTotalBytes)) * 68))
        sendTaskEvent({
          type: 'step',
          jobId,
          value: overallPct,
          label: `正在上传 (${assetIndex + 1}/${totalAssets}) ${uploadName} · ${filePct}% (${formatReleaseBytes(uploaded)} / ${formatReleaseBytes(fileSize)} · ${speedText})`,
          releaseAssetProgress: {
            path: asset.path,
            status: 'uploading',
            percent: filePct,
            uploadedBytes: uploaded,
            totalBytes: fileSize,
            speed: speedText
          }
        })
        if (milestone > lastLoggedMilestone && milestone > 0 && milestone < 100) {
          lastLoggedMilestone = milestone
          emitLine(jobId, `[上传中 ${assetIndex + 1}/${totalAssets}] ${uploadName}: ${filePct}% (${formatReleaseBytes(uploaded)} / ${formatReleaseBytes(fileSize)} · ${speedText})`, 'stdout')
        }
      }
    })

    stream.on('error', (err) => {
      try { req.destroy() } catch {}
      reject(err)
    })

    stream.pipe(req)
  })
}

async function publishReleaseTask(jobId, payload) {
  const {
    target,
    url,
    tagName: rawTag,
    releaseTitle: rawTitle,
    releaseNotes: rawNotes,
    targetCommitish: rawCommitish,
    draft = false,
    prerelease = false,
    pushTag = true,
    assets = [],
    token: explicitToken,
    saveToken = true
  } = payload

  sendTaskEvent({ type: 'step', jobId, value: 4, label: '正在校验仓库信息与发布凭据...' })

  const tagName = String(rawTag || '').trim()
  if (!tagName) throw new Error('请填写 Release 版本标签（例如 v1.4.1）。')
  const releaseTitle = String(rawTitle || '').trim() || tagName
  const releaseNotes = String(rawNotes || '').trim()
  const targetCommitish = String(rawCommitish || '').trim() || 'main'

  const parsedRepo = parseGitRemoteRepo(url)
  if (!parsedRepo) {
    throw new Error('无法从远程仓库地址解析出 GitHub / Gitee 仓库信息（格式应为 https://github.com/owner/repo.git）。')
  }

  if (typeof explicitToken === 'string' && explicitToken.trim() && saveToken !== false) {
    try {
      updateCredentialStore({ git: { token: explicitToken.trim() } })
    } catch {}
  }

  const tokenCandidates = resolveReleaseTokenCandidates(explicitToken, parsedRepo.host)
  let token = tokenCandidates[0] || ''
  if (!token) {
    throw new Error('未检测到发布所需的访问令牌（Token）。请在左侧「访问令牌」输入框填写 GitHub / Gitee Personal Access Token（需具备 Contents 读写或 repo 权限）。')
  }

  emitLine(jobId, `[准备] 目标仓库: ${parsedRepo.owner}/${parsedRepo.repo} (${parsedRepo.host})`, 'stdout')
  emitLine(jobId, `[准备] 版本标签: ${tagName} | 标题: ${releaseTitle} | 目标分支: ${targetCommitish}`, 'stdout')

  // Optional step: create & push Git tag from local repo
  if (pushTag && target && fs.existsSync(target) && fs.existsSync(path.join(target, '.git'))) {
    sendTaskEvent({ type: 'step', jobId, value: 10, label: `正在创建并推送 Git 标签 ${tagName}...` })
    emitLine(jobId, `[Git Tag] 正在本地标记 ${tagName} 并推送到远程 origin...`, 'stdout')
    await capture('git', ['-C', target, 'tag', '-f', tagName], target)
    await runProcess(
      jobId,
      'git',
      ['-C', target, 'push', 'origin', `refs/tags/${tagName}`, '--force'],
      target,
      { targetUrl: url, gitCredentials: { mode: 'https', username: 'x-access-token', token } }
    )
    emitLine(jobId, `[Git Tag] 标签 ${tagName} 已成功同步至远程仓库。`, 'stdout')
  }

  sendTaskEvent({ type: 'step', jobId, value: 20, label: `正在创建远程 Release (${tagName})...` })

  let releaseData = null
  if (parsedRepo.platform === 'gitee') {
    const createRes = await httpsJsonRequest({
      hostname: 'gitee.com',
      path: `/api/v5/repos/${encodeURIComponent(parsedRepo.owner)}/${encodeURIComponent(parsedRepo.repo)}/releases`,
      method: 'POST',
      headers: {
        'User-Agent': 'CodeSync-Studio-Release-Publisher',
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      access_token: token,
      tag_name: tagName,
      target_commitish: targetCommitish,
      name: releaseTitle,
      body: releaseNotes || `Release ${tagName}`,
      prerelease: Boolean(prerelease)
    }), jobId)

    if (createRes.status < 200 || createRes.status >= 300) {
      throw new Error(`创建 Gitee Release 失败 (HTTP ${createRes.status}): ${createRes.data?.message || createRes.raw}`)
    }
    releaseData = {
      id: createRes.data.id,
      html_url: `https://gitee.com/${parsedRepo.owner}/${parsedRepo.repo}/releases/tag/${encodeURIComponent(tagName)}`,
      upload_url: null,
      assets: []
    }
    emitLine(jobId, `[Release] Gitee Release 创建成功: ${releaseData.html_url}`, 'stdout')
  } else {
    const payloadJson = JSON.stringify({
      tag_name: tagName,
      target_commitish: targetCommitish,
      name: releaseTitle,
      body: releaseNotes,
      draft: Boolean(draft),
      prerelease: Boolean(prerelease)
    })

    let lastStatus = 0
    let lastErrorMsg = ''
    for (let cIdx = 0; cIdx < tokenCandidates.length; cIdx++) {
      const candidateToken = tokenCandidates[cIdx]
      const commonHeaders = {
        'User-Agent': 'CodeSync-Studio-Release-Publisher',
        Authorization: `Bearer ${candidateToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json'
      }

      const existingRes = await httpsJsonRequest({
        hostname: 'api.github.com',
        path: `/repos/${encodeURIComponent(parsedRepo.owner)}/${encodeURIComponent(parsedRepo.repo)}/releases/tags/${encodeURIComponent(tagName)}`,
        method: 'GET',
        headers: commonHeaders
      }, null, jobId)

      if (existingRes.status === 200 && existingRes.data?.id) {
        emitLine(jobId, `[Release] 检测到远程已存在 ${tagName} Release (ID: ${existingRes.data.id})，正在更新说明与元数据...`, 'stdout')
        const updateRes = await httpsJsonRequest({
          hostname: 'api.github.com',
          path: `/repos/${encodeURIComponent(parsedRepo.owner)}/${encodeURIComponent(parsedRepo.repo)}/releases/${existingRes.data.id}`,
          method: 'PATCH',
          headers: commonHeaders
        }, payloadJson, jobId)
        if (updateRes.status >= 200 && updateRes.status < 300) {
          releaseData = updateRes.data
          token = candidateToken
          break
        }
        lastStatus = updateRes.status
        lastErrorMsg = updateRes.data?.message || updateRes.raw
      } else {
        emitLine(jobId, `[Release] 正在向 GitHub 创建 Release ${tagName}...`, 'stdout')
        const createRes = await httpsJsonRequest({
          hostname: 'api.github.com',
          path: `/repos/${encodeURIComponent(parsedRepo.owner)}/${encodeURIComponent(parsedRepo.repo)}/releases`,
          method: 'POST',
          headers: commonHeaders
        }, payloadJson, jobId)
        if (createRes.status >= 200 && createRes.status < 300) {
          releaseData = createRes.data
          token = candidateToken
          break
        }
        lastStatus = createRes.status
        lastErrorMsg = createRes.data?.message || createRes.raw
      }

      if ((lastStatus === 401 || lastStatus === 403) && cIdx + 1 < tokenCandidates.length) {
        emitLine(jobId, `[提示] 当前 Token 权限不足 (HTTP ${lastStatus})，正在自动切换本机 Git 凭据重试...`, 'stdout')
        continue
      }
      break
    }

    if (!releaseData) {
      if (lastStatus === 403) {
        throw new Error('GitHub 权限不足 (HTTP 403)：当前配置的 Token 无权创建 Release（Fine-grained Token 需开启 Contents: Read and write，Classic Token 需勾选 repo 权限）。')
      }
      if (lastStatus === 401) {
        throw new Error('GitHub 认证失败 (HTTP 401)：请检查填写的 Personal Access Token 是否有效或已过期。')
      }
      throw new Error(`创建/更新 GitHub Release 失败 (HTTP ${lastStatus}): ${lastErrorMsg}`)
    }

    emitLine(jobId, `[Release] 远程 Release 已就绪: ${releaseData.html_url}`, 'stdout')
  }

  const validAssets = (Array.isArray(assets) ? assets : []).filter((a) => a?.path && fs.existsSync(a.path))
  if (validAssets.length > 0 && releaseData?.upload_url) {
    const grandTotalBytes = validAssets.reduce((acc, a) => {
      try { return acc + fs.statSync(a.path).size } catch { return acc }
    }, 0)
    let uploadedBeforeThisAsset = 0

    for (let i = 0; i < validAssets.length; i++) {
      const asset = validAssets[i]
      const uploadName = (asset.uploadName || asset.name || path.basename(asset.path)).trim()
      const fileSize = fs.statSync(asset.path).size

      // Delete existing asset with same name if present
      const existingAsset = (releaseData.assets || []).find((x) => x.name === uploadName)
      if (existingAsset?.id) {
        emitLine(jobId, `[清理] 远程已存在同名附件 ${uploadName}，正在替换旧文件...`, 'stdout')
        await httpsJsonRequest({
          hostname: 'api.github.com',
          path: `/repos/${encodeURIComponent(parsedRepo.owner)}/${encodeURIComponent(parsedRepo.repo)}/releases/assets/${existingAsset.id}`,
          method: 'DELETE',
          headers: {
            'User-Agent': 'CodeSync-Studio-Release-Publisher',
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json'
          }
        }, null, jobId).catch(() => {})
      }

      await uploadReleaseAssetWithProgress({
        jobId,
        uploadUrlTemplate: releaseData.upload_url,
        asset,
        assetIndex: i,
        totalAssets: validAssets.length,
        grandTotalBytes,
        uploadedBeforeThisAsset,
        token
      })

      uploadedBeforeThisAsset += fileSize
    }
  } else if (validAssets.length === 0) {
    emitLine(jobId, '[提示] 本次发布未勾选附件，仅发布版本说明与 Tag。', 'stdout')
  }

  emitLine(jobId, `🎉 Release ${tagName} 发布成功！访问地址: ${releaseData.html_url}`, 'stdout')
  sendTaskEvent({
    type: 'done',
    jobId,
    ok: true,
    value: 100,
    label: `Release ${tagName} 发布完成`,
    releaseUrl: releaseData.html_url
  })
  return { jobId, ok: true, releaseUrl: releaseData.html_url }
}

function emitLine(jobId, text, source = 'stdout') {
  const clean = stripAnsi(text).replace(/\r/g, '').trimEnd()
  if (!clean) return
  const percent = clean.match(/(?:^|\s)(\d{1,3})%/)?.[1]
  sendTaskEvent({ type: 'line', jobId, text: clean, source, percent: percent ? Number(percent) : null, time: new Date().toISOString() })
  if (percent) sendTaskEvent({ type: 'progress', jobId, value: Number(percent), label: clean })
}

function runProcess(jobId, command, args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    const session = createCommandSession(command, args, options)
    const child = spawn(command, session.args, { cwd, windowsHide: true, env: session.env })
    if (activeJob?.jobId === jobId) activeJob.child = child
    let stderr = ''
    let stdout = ''
    let settled = false
    const finish = (callback, value) => { if (!settled) { settled = true; callback(value) } }
    child.stdout.on('data', (chunk) => {
      const value = decodeProcessChunk(chunk)
      stdout += value
      value.split(/\r?\n|\r/).forEach((line) => emitLine(jobId, line, 'stdout'))
    })
    child.stderr.on('data', (chunk) => {
      const value = decodeProcessChunk(chunk)
      stderr += value
      value.split(/\r?\n|\r/).forEach((line) => emitLine(jobId, line, 'stderr'))
    })
    child.on('error', (error) => { session.cleanup(); finish(reject, commandError(command, args, error)) })
    child.on('close', (code, signal) => {
      session.cleanup()
      if (signal === 'SIGTERM' || signal === 'SIGKILL') return finish(reject, new Error('任务已取消。'))
      if (code === 0) return finish(resolve, { stdout, stderr })
      const output = stripAnsi(stderr || stdout).trim()
      if (
        command === 'git' &&
        !options._retriedWithGcm &&
        /returned error: 403|Permission to .* denied|Authentication failed|returned error: 401/i.test(output)
      ) {
        const gcm = getSystemGcmCredential()
        const currentToken = resolveGitCredentials(options.gitCredentials).token
        if (gcm?.token && gcm.token !== currentToken) {
          emitLine(jobId, '[提示] 软件配置的 Token 权限不足 (HTTP 403)，正在自动切换本机 Git 凭据管理器重试...', 'stdout')
          try {
            updateCredentialStore({ git: { mode: 'https', username: gcm.username, token: gcm.token } })
          } catch {}
          runProcess(jobId, command, args, cwd, {
            ...options,
            gitCredentials: { mode: 'https', username: gcm.username, token: gcm.token },
            _retriedWithGcm: true
          }).then(
            (res) => finish(resolve, res),
            (err) => finish(reject, err)
          )
          return
        }
      }
      if (command === 'svn') return finish(reject, svnError(output, session.authSummary))
      const authHint = session.authSummary ? `\n认证状态：${session.authSummary}` : ''
      finish(reject, new Error(`${output || `${command} 返回错误码 ${code}`}${authHint}`))
    })
  })
}

async function runStep(jobId, label, command, args, cwd, progressStart, progressEnd, options = {}) {
  sendTaskEvent({ type: 'step', jobId, label, value: progressStart })
  const result = await runProcess(jobId, command, args, cwd, options)
  sendTaskEvent({ type: 'progress', jobId, value: progressEnd, label })
  return result
}

async function runTask(payload) {
  if (activeJob) throw new Error('已有任务正在执行，请等待当前任务完成。')
  const jobId = crypto.randomUUID()
  activeJob = { jobId, child: null }
  const {
    provider,
    action,
    url,
    target,
    version,
    path: browsePath,
    branch: pushBranchInput,
    commitMessage,
    commitChanges,
    selectedFiles,
    pushForce,
    pushTags,
    pullBeforePush,
    autoInit,
    shallowClone,
    recurseSubmodules
  } = payload
  const taskOptions = { targetUrl: url }
  const svnUrl = provider === 'svn' ? normalizeSvnUrl(url) : url
  const sparsePath = typeof browsePath === 'string' ? browsePath.replace(/^\/+|\/+$/g, '') : ''
  const startLabel = action === 'pull' ? '开始拉取' : action === 'push' ? '开始推送' : action === 'release' ? '开始发布 Release' : '开始更新'
  sendTaskEvent({ type: 'start', jobId, label: startLabel, provider, action })
  try {
    if (action === 'release') {
      return await publishReleaseTask(jobId, payload)
    }
    if (provider === 'git' && action === 'push') {
      if (!target || !fs.existsSync(target)) throw new Error('本地项目目录不存在，请先选择有效的项目文件夹。')
      const isRepo = await capture('git', ['-C', target, 'rev-parse', '--is-inside-work-tree'], target).then(() => true).catch(() => false)
      if (!isRepo) {
        if (autoInit === false) throw new Error('当前目录尚未初始化为 Git 仓库。')
        await runStep(jobId, '初始化本地 Git 仓库 (git init)', 'git', ['-C', target, 'init'], target, 4, 14, taskOptions)
      }

      const targetBranch = typeof pushBranchInput === 'string' && pushBranchInput.trim() ? pushBranchInput.trim() : 'main'
      const curBranchRes = await capture('git', ['-C', target, 'branch', '--show-current'], target).catch(() => ({ stdout: '' }))
      const curSymRes = !curBranchRes.stdout.trim()
        ? await capture('git', ['-C', target, 'symbolic-ref', '--short', 'HEAD'], target).catch(() => ({ stdout: '' }))
        : { stdout: '' }
      const currentBranch = curBranchRes.stdout.trim() || curSymRes.stdout.trim()

      if (targetBranch && targetBranch !== currentBranch) {
        try {
          await runStep(jobId, `切换/创建分支 ${targetBranch}`, 'git', ['-C', target, 'checkout', '-B', targetBranch], target, 15, 24, taskOptions)
        } catch {
          await runStep(jobId, `设置主分支名 ${targetBranch}`, 'git', ['-C', target, 'branch', '-M', targetBranch], target, 15, 24, taskOptions)
        }
      }

      const remoteUrl = typeof url === 'string' ? url.trim() : ''
      const existingRemote = (await capture('git', ['-C', target, 'config', '--get', 'remote.origin.url'], target).catch(() => ({ stdout: '' }))).stdout.trim()
      if (remoteUrl) {
        if (!existingRemote) {
          await runStep(jobId, `关联远程仓库 origin -> ${remoteUrl}`, 'git', ['-C', target, 'remote', 'add', 'origin', remoteUrl], target, 25, 34, taskOptions)
        } else if (existingRemote !== remoteUrl) {
          await runStep(jobId, `更新远程仓库地址 origin -> ${remoteUrl}`, 'git', ['-C', target, 'remote', 'set-url', 'origin', remoteUrl], target, 25, 34, taskOptions)
        }
      } else if (!existingRemote) {
        throw new Error('当前仓库未配置远程 origin 地址，请先填写远程仓库地址。')
      }

      if (commitChanges !== false) {
        const workingStatus = (await capture('git', ['-C', target, 'status', '--porcelain=v1', '-uall'], target).catch(() => ({ stdout: '' }))).stdout.trim()
        if (workingStatus) {
          if (Array.isArray(selectedFiles)) {
            if (selectedFiles.length > 0) {
              await capture('git', ['-C', target, 'reset'], target).catch(() => {})
              const chunkSize = 40
              for (let i = 0; i < selectedFiles.length; i += chunkSize) {
                const chunk = selectedFiles.slice(i, i + chunkSize)
                await runStep(jobId, `暂存已选改动文件 (${Math.min(i + chunk.length, selectedFiles.length)}/${selectedFiles.length})`, 'git', ['-C', target, 'add', '-A', '--', ...chunk], target, 36, 52, taskOptions)
              }
            }
          } else {
            await runStep(jobId, '暂存工作区全部改动 (git add -A)', 'git', ['-C', target, 'add', '-A'], target, 36, 52, taskOptions)
          }
        }

        const stagedDiff = await capture('git', ['-C', target, 'diff', '--cached', '--name-only'], target).catch(() => ({ stdout: '' }))
        if (stagedDiff.stdout.trim()) {
          const userName = (await capture('git', ['-C', target, 'config', 'user.name'], target).catch(() => ({ stdout: '' }))).stdout.trim()
          const userEmail = (await capture('git', ['-C', target, 'config', 'user.email'], target).catch(() => ({ stdout: '' }))).stdout.trim()
          const commitArgs = ['-C', target]
          if (!userName) {
            const fallbackName = resolveGitCredentials().username || os.userInfo().username || 'CodeSync Studio'
            commitArgs.push('-c', `user.name=${fallbackName}`)
          }
          if (!userEmail) {
            const cleanUser = (resolveGitCredentials().username || os.userInfo().username || 'codesync').replace(/[^a-zA-Z0-9._-]/g, '') || 'codesync'
            commitArgs.push('-c', `user.email=${cleanUser}@users.noreply.github.com`)
          }
          const finalMsg = typeof commitMessage === 'string' && commitMessage.trim() ? commitMessage.trim() : '维护：通过 CodeSync Studio 同步代码'
          const msgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codesync-msg-'))
          const msgFile = path.join(msgDir, 'commit-msg.txt')
          fs.writeFileSync(msgFile, Buffer.from(finalMsg, 'utf8'))
          commitArgs.push('commit', '-F', msgFile)
          try {
            await runStep(jobId, `提交代码: ${finalMsg}`, 'git', commitArgs, target, 54, 68, taskOptions)
          } finally {
            try { fs.rmSync(msgDir, { recursive: true, force: true }) } catch {}
          }
        } else {
          emitLine(jobId, '工作区无新增暂存文件，准备直接推送本地已有提交...', 'stdout')
        }
      }

      const hasHead = await capture('git', ['-C', target, 'rev-parse', '--verify', 'HEAD'], target).then(() => true).catch(() => false)
      if (!hasHead) {
        throw new Error('当前本地仓库尚无任何提交记录，请勾选需要推送的文件并填写提交说明。')
      }

      if (pullBeforePush && !pushForce) {
        try {
          await runStep(jobId, `推送前同步远程分支 ${targetBranch} (pull --rebase)`, 'git', ['-C', target, 'pull', '--rebase', '--autostash', 'origin', targetBranch], target, 69, 75, taskOptions)
        } catch {
          const gitDir = path.join(target, '.git')
          if (fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))) {
            await capture('git', ['-C', target, 'rebase', '--abort'], target).catch(() => {})
            emitLine(jobId, '检测到与远程分支存在变基冲突，已自动回退变基状态，请尝试开启「强推」或先更新解决冲突。', 'stderr')
          } else {
            emitLine(jobId, '远程尚无同名分支或无需变基，继续执行推送...', 'stdout')
          }
        }
      }

      const pushArgs = ['-C', target, 'push', '--progress', '-u', 'origin', targetBranch]
      if (pushForce) pushArgs.splice(4, 0, '--force-with-lease')
      await runStep(jobId, `推送分支 ${targetBranch} 到远程仓库`, 'git', pushArgs, target, 70, pushTags ? 88 : 96, taskOptions)
      if (pushTags) {
        await runStep(jobId, '同步推送全部标签 (--tags)', 'git', ['-C', target, 'push', '--progress', 'origin', '--tags'], target, 89, 96, taskOptions)
      }
    } else if (provider === 'svn' && action === 'push') {
      if (!target || !fs.existsSync(target)) throw new Error('本地 SVN 工作副本目录不存在。')
      const statusRes = await capture('svn', ['status', '--xml', target], target).catch(() => ({ stdout: '' }))
      const entryMatches = statusRes.stdout.match(/<entry\s+path="[^"]+"[\s\S]*?<\/entry>/gi) || []
      const selectedSet = Array.isArray(selectedFiles) && selectedFiles.length > 0 ? new Set(selectedFiles) : null
      const toAdd = []
      const toDelete = []
      for (const block of entryMatches) {
        const entryPath = xmlAttr(block, 'path')
        const wcMatch = block.match(/<wc-status[^>]*>/i)?.[0] || ''
        const item = xmlAttr(wcMatch, 'item').toLowerCase()
        const rel = path.relative(target, entryPath).replace(/\\/g, '/')
        if (selectedSet && !selectedSet.has(rel)) continue
        if (item === 'unversioned') toAdd.push(entryPath)
        else if (item === 'missing') toDelete.push(entryPath)
      }
      if (toAdd.length > 0) {
        await runStep(jobId, `纳入版本控制 (${toAdd.length} 项新增文件)`, 'svn', ['add', '--force', ...toAdd], target, 10, 35, taskOptions)
      }
      if (toDelete.length > 0) {
        await runStep(jobId, `标记删除 (${toDelete.length} 项缺失文件)`, 'svn', ['delete', '--force', ...toDelete], target, 36, 48, taskOptions)
      }
      const finalMsg = typeof commitMessage === 'string' && commitMessage.trim() ? commitMessage.trim() : '维护：通过 CodeSync Studio 提交代码'
      const msgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codesync-svn-msg-'))
      const msgFile = path.join(msgDir, 'commit-msg.txt')
      fs.writeFileSync(msgFile, Buffer.from(finalMsg, 'utf8'))
      const commitArgs = ['commit', '-F', msgFile, '--encoding', 'UTF-8']
      if (Array.isArray(selectedFiles) && selectedFiles.length > 0) {
        commitArgs.push(...selectedFiles.map((f) => path.join(target, f)))
      } else {
        commitArgs.push(target)
      }
      try {
        await runStep(jobId, `提交 SVN 改动: ${finalMsg}`, 'svn', commitArgs, target, 50, 96, taskOptions)
      } finally {
        try { fs.rmSync(msgDir, { recursive: true, force: true }) } catch {}
      }
    } else if (provider === 'git' && action === 'pull') {
      if (sparsePath) {
        const branchName = typeof version?.name === 'string' ? version.name.trim() : ''
        const label = `克隆 Git ${branchName && branchName !== 'HEAD' ? branchName : '默认版本'}（仅 ${sparsePath}）`
        const sparseArgs = ['clone', '--progress', '--filter=blob:none', '--sparse']
        if (branchName && branchName !== 'HEAD') sparseArgs.push('--branch', branchName)
        sparseArgs.push(url, target)
        try {
          await runStep(jobId, label, 'git', sparseArgs, undefined, 4, 72, taskOptions)
        } catch {
          if (fs.existsSync(target)) { try { fs.rmSync(target, { recursive: true, force: true }) } catch {} }
          const plainArgs = ['clone', '--progress', '--sparse']
          if (branchName && branchName !== 'HEAD') plainArgs.push('--branch', branchName)
          plainArgs.push(url, target)
          await runStep(jobId, `${label}（服务器不支持部分克隆，已切换兼容模式）`, 'git', plainArgs, undefined, 4, 72, taskOptions)
        }
        await runStep(jobId, `设置稀疏检出 ${sparsePath}`, 'git', ['-C', target, 'sparse-checkout', 'set', '--no-cone', gitSparsePattern(sparsePath)], target, 78, 96, taskOptions)
      } else {
        const args = ['clone', '--progress']
        if (shallowClone) args.push('--depth', '1')
        if (recurseSubmodules) args.push('--recurse-submodules')
        const branchName = typeof version?.name === 'string' ? version.name.trim() : ''
        if (branchName && branchName !== 'HEAD') args.push('--branch', branchName)
        args.push(url, target)
        await runStep(jobId, `克隆 Git ${branchName && branchName !== 'HEAD' ? branchName : '默认版本'}${shallowClone ? ' (浅克隆)' : ''}`, 'git', args, undefined, 4, 92, taskOptions)
      }
    } else if (provider === 'git') {
      if (version?.kind === 'tag') {
        await runStep(jobId, `获取标签 ${version.name}`, 'git', ['-C', target, 'fetch', '--progress', 'origin', 'tag', version.name], target, 4, 70, taskOptions)
        if (sparsePath) await runStep(jobId, `设置稀疏检出 ${sparsePath}`, 'git', ['-C', target, 'sparse-checkout', 'set', '--no-cone', gitSparsePattern(sparsePath)], target, 72, 80, taskOptions)
        await runStep(jobId, `切换到标签 ${version.name}`, 'git', ['-C', target, 'checkout', '--detach', `refs/tags/${version.name}`], target, 82, 96, taskOptions)
      } else {
        const branchResult = await capture('git', ['-C', target, 'branch', '--show-current'], target).catch(() => ({ stdout: '' }))
        const currentBranch = branchResult.stdout.trim()
        let branch = version?.name && version.name !== 'HEAD' ? version.name.trim() : ''

        const fetchArgs = ['-C', target, 'fetch', '--progress', '--prune', 'origin']
        if (branch) fetchArgs.push(branch)
        await runStep(jobId, `获取分支 ${branch || currentBranch || '最新提交'}`, 'git', fetchArgs, target, 4, 50, taskOptions)

        if (sparsePath) await runStep(jobId, `设置稀疏检出 ${sparsePath}`, 'git', ['-C', target, 'sparse-checkout', 'set', '--no-cone', gitSparsePattern(sparsePath)], target, 52, 65, taskOptions)

        if (branch && currentBranch && branch !== currentBranch) {
          try {
            await runStep(jobId, `切换分支至 ${branch}`, 'git', ['-C', target, 'checkout', branch], target, 66, 75, taskOptions)
          } catch {
            await runStep(jobId, `检出远程分支 ${branch}`, 'git', ['-C', target, 'checkout', '-B', branch, `origin/${branch}`], target, 66, 75, taskOptions)
          }
        }

        const activeBranch = branch || currentBranch
        if (activeBranch) {
          await runStep(jobId, `更新分支 ${activeBranch}`, 'git', ['-C', target, 'pull', '--progress', '--ff-only', 'origin', activeBranch], target, 76, 96, taskOptions)
        } else {
          await runStep(jobId, '更新工作副本', 'git', ['-C', target, 'pull', '--progress', '--ff-only'], target, 76, 96, taskOptions)
        }
      }
    } else if (provider === 'svn' && action === 'pull') {
      const args = ['checkout', svnUrl]
      if (version?.revision && version.revision !== 'HEAD') args.push('--revision', version.revision)
      args.push(target)
      await runStep(jobId, `检出 SVN ${version?.label || version?.revision || 'HEAD'}`, 'svn', args, undefined, 4, 96, taskOptions)
    } else if (provider === 'svn' && sparsePath) {
      const args = ['switch', '--ignore-ancestry', svnUrl]
      if (version?.revision && version.revision !== 'HEAD') args.push('--revision', version.revision)
      args.push(target)
      await runStep(jobId, `切换 SVN 工作副本到 ${sparsePath} 并更新`, 'svn', args, target, 4, 96, taskOptions)
    } else {
      const args = ['update']
      if (version?.revision && version.revision !== 'HEAD') args.push('--revision', version.revision)
      args.push(target)
      await runStep(jobId, `更新 SVN ${version?.label || version?.revision || 'HEAD'}`, 'svn', args, target, 4, 96, taskOptions)
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
  nativeTheme.themeSource = 'dark'
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#060b16',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#060b16',
      symbolColor: '#cbd5e1',
      height: 32
    },
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
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], title: '选择文件' })
  return result.canceled ? '' : result.filePaths[0]
})
ipcMain.handle('path:choose-release-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: '选择要上传到 Release 的附件文件',
    filters: [
      { name: '发行版安装包与压缩包', extensions: ['exe', 'zip', 'msi', 'dmg', '7z', 'gz', 'tar', 'deb', 'rpm', 'AppImage'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  if (result.canceled || !result.filePaths?.length) return []
  return result.filePaths.map((p) => {
    const name = path.basename(p)
    let size = 0
    try { size = fs.statSync(p).size } catch {}
    return {
      path: p,
      name,
      uploadName: /setup/i.test(name) ? name.replace(/\s+/g, '.') : name,
      size
    }
  })
})
ipcMain.handle('url:open-external', async (_, url) => {
  if (!url || typeof url !== 'string') return false
  try {
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
})
ipcMain.handle('path:read-text', async (_, target) => {
  if (!target || typeof target !== 'string' || !fs.existsSync(target)) return ''
  return fs.readFileSync(target, 'utf8')
})
ipcMain.handle('path:open', async (_, target) => {
  if (!target || typeof target !== 'string') return false
  try {
    if (fs.existsSync(target)) {
      await shell.openPath(target)
      return true
    }
  } catch {}
  return false
})
ipcMain.handle('path:check', (_, target) => {
  if (!target || typeof target !== 'string') return { exists: false, isDirectory: false, empty: true }
  try {
    if (!fs.existsSync(target)) return { exists: false, isDirectory: false, empty: true }
    const stat = fs.statSync(target)
    if (!stat.isDirectory()) return { exists: true, isDirectory: false, empty: false }
    const entries = fs.readdirSync(target)
    return {
      exists: true,
      isDirectory: true,
      empty: entries.length === 0,
      hasGit: fs.existsSync(path.join(target, '.git')),
      hasSvn: fs.existsSync(path.join(target, '.svn'))
    }
  } catch (err) {
    return { exists: false, isDirectory: false, empty: true, error: err.message }
  }
})
ipcMain.handle('repository:probe', (_, payload) => probeRepository(payload))
ipcMain.handle('repository:browse', (_, payload) => browseRepository(payload))
ipcMain.handle('credentials:test', (_, payload) => testRepositoryCredentials(payload))
ipcMain.handle('repository:inspect', (_, payload) => inspectLocal(payload))
ipcMain.handle('repository:inspect-push', (_, payload) => inspectPushWorkspace(payload))
ipcMain.handle('repository:inspect-release', (_, payload) => inspectReleaseWorkspace(payload))
ipcMain.handle('repository:scan-local', (_, payload) => scanLocalRepos(payload))
ipcMain.handle('repository:diff', (_, payload) => getWorkspaceDiff(payload))
ipcMain.handle('task:run', (_, payload) => runTask(payload))
ipcMain.handle('task:cancel', () => {
  if (!activeJob) return false
  if (typeof activeJob.abort === 'function') {
    try { activeJob.abort() } catch {}
  }
  if (!activeJob?.child) return true
  try {
    if (process.platform === 'win32' && activeJob.child.pid) {
      spawn('taskkill', ['/pid', String(activeJob.child.pid), '/T', '/F'])
    } else {
      activeJob.child.kill('SIGTERM')
    }
  } catch {
    try { activeJob.child.kill('SIGKILL') } catch {}
  }
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

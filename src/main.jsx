import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AlertCircle,
  ArrowDownToLine,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Download,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  HardDriveDownload,
  History,
  Info,
  KeyRound,
  Layers,
  ListOrdered,
  LoaderCircle,
  LockKeyhole,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Settings2,
  Square,
  Terminal,
  Trash2,
  Upload,
  X,
  Zap
} from 'lucide-react'
import './styles.css'
import logoUrl from '../assets/codesync-sakura.svg'

const api = window.codeSync

const blankProgress = { value: 0, label: '准备就绪，等待开始任务', logs: [], status: 'idle' }

function formatTime(value) {
  if (!value) return '--'
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function shortHash(hash = '') {
  return hash ? hash.slice(0, 8) : '未知'
}

function appError(error) {
  return error?.message || String(error) || '操作失败，请查看任务日志。'
}

function isTrunkUrl(value = '') {
  return /(?:^|\/)trunk\/?$/i.test(value.trim())
}

function joinSvnUrl(base, child) {
  return `${base.replace(/\/+$/, '')}/${child.split('/').map(encodeURIComponent).join('/')}`
}

function joinBrowsePath(base, name) {
  return base ? `${base}/${name}` : name
}

function joinLocalPath(parent, child) {
  if (!parent) return child
  const cleanParent = parent.trim().replace(/[/\\]+$/, '')
  const separator = cleanParent.includes('/') && !cleanParent.includes('\\') ? '/' : '\\'
  return `${cleanParent}${separator}${child.trim().replace(/^[/\\]+/, '')}`
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

function parseSingleLine(rawLine, provider) {
  let line = String(rawLine || '').trim()
  if (!line || line.startsWith('#') || line.startsWith('//')) return null

  let url = ''
  let branch = ''

  const spaceParts = line.split(/\s+/)
  if (spaceParts.length >= 2) {
    url = spaceParts[0].trim()
    branch = spaceParts.slice(1).join(' ').trim()
  } else {
    const hashIndex = line.indexOf('#')
    if (hashIndex > 0) {
      url = line.slice(0, hashIndex).trim()
      branch = line.slice(hashIndex + 1).trim()
    } else {
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

function parseUrlList(text, provider, targetRoot) {
  const lines = String(text || '').split(/\r?\n/)
  const items = []
  const seen = new Set()
  lines.forEach((line, index) => {
    const parsed = parseSingleLine(line, provider)
    if (!parsed || !parsed.url) return
    const name = extractRepoName(parsed.url, provider) || `repo_${index + 1}`
    let finalName = name
    let counter = 1
    while (seen.has(finalName)) {
      counter++
      finalName = `${name}_${counter}`
    }
    seen.add(finalName)
    const target = targetRoot ? joinLocalPath(targetRoot, finalName) : finalName
    items.push({
      id: `item-${index}-${parsed.url}`,
      url: parsed.url,
      parsedBranch: parsed.branch,
      name: finalName,
      target
    })
  })
  return items
}

function getRepoVersionOptions(repoData, provider) {
  if (!repoData) return []
  if (provider === 'git') {
    const defaultBranchName = repoData.defaultBranch || 'HEAD'
    const list = [
      { id: 'default', kind: 'default', name: '', label: `默认主线 (${defaultBranchName})` }
    ]
    if (repoData.branches?.length) {
      repoData.branches.forEach((b) => {
        list.push({
          id: `branch:${b.name}`,
          kind: 'branch',
          name: b.name,
          label: b.name === repoData.defaultBranch ? `分支 · ${b.name} (默认主线)` : `分支 · ${b.name}`
        })
      })
    }
    if (repoData.tags?.length) {
      repoData.tags.forEach((t) => {
        list.push({ id: `tag:${t.name}`, kind: 'tag', name: t.name, label: `标签 · ${t.name}` })
      })
    }
    return list
  }

  // SVN
  const list = [
    { id: 'default', kind: 'default', name: '', revision: 'HEAD', label: `最新版本 · r${repoData.latestRevision || 'HEAD'}` }
  ]

  if (repoData.directories?.length) {
    repoData.directories.forEach((dir) => {
      list.push({
        id: `dir:${dir}`,
        kind: 'dir',
        name: dir,
        subPath: dir,
        label: `目录/标签 · ${dir}`
      })
    })
  }

  if (repoData.revisions?.length) {
    repoData.revisions.slice(0, 30).forEach((rev) => {
      const msg = rev.message ? rev.message.replace(/[\r\n]+/g, ' ').slice(0, 24) : '无说明'
      list.push({
        id: `rev:${rev.revision}`,
        kind: 'rev',
        name: `r${rev.revision}`,
        revision: rev.revision,
        label: `r${rev.revision} · ${msg} (${rev.author || '未知'})`
      })
    })
  }

  return list
}

function resolveItemVersionPayload(item, branchSelection, batchProvider, globalBranch, batchSvnMainlineOnly) {
  let val = (branchSelection !== undefined ? branchSelection : item.parsedBranch)?.trim()
  if (!val && batchProvider === 'git') {
    val = globalBranch.trim()
  }

  let finalUrl = item.url
  if (batchProvider === 'git') {
    let branchName = ''
    if (val && val !== 'default' && val !== 'HEAD') {
      if (val.startsWith('branch:') || val.startsWith('tag:')) {
        branchName = val.split(':')[1] || ''
      } else {
        branchName = val
      }
    }
    return {
      finalUrl,
      payloadVersion: {
        kind: 'branch',
        name: branchName,
        label: branchName || '默认分支'
      }
    }
  }

  // SVN
  if (!val || val === 'default' || val === 'HEAD') {
    if (batchSvnMainlineOnly && isTrunkUrl(item.url)) {
      finalUrl = item.url
    }
    return {
      finalUrl,
      payloadVersion: {
        kind: 'svn',
        revision: 'HEAD',
        sourceUrl: finalUrl,
        label: '最新版本'
      }
    }
  }

  if (val.startsWith('dir:')) {
    const subDir = val.slice(4).trim()
    finalUrl = joinSvnUrl(item.url, subDir)
    return {
      finalUrl,
      payloadVersion: {
        kind: 'svn',
        revision: 'HEAD',
        sourceUrl: finalUrl,
        label: `目录/标签 · ${subDir}`
      }
    }
  }

  if (val.startsWith('rev:')) {
    const revNum = val.slice(4).trim()
    return {
      finalUrl,
      payloadVersion: {
        kind: 'svn',
        revision: revNum,
        sourceUrl: finalUrl,
        label: `r${revNum}`
      }
    }
  }

  const isRevision = /^(?:r)?\d+$/i.test(val)
  if (isRevision) {
    const revNum = val.replace(/^r/i, '')
    return {
      finalUrl,
      payloadVersion: {
        kind: 'svn',
        revision: revNum,
        sourceUrl: finalUrl,
        label: `r${revNum}`
      }
    }
  }

  if (isTrunkUrl(item.url)) {
    finalUrl = `${item.url.replace(/\/trunk\/?$/i, '')}/${val.replace(/^\/+/, '')}`
  } else {
    finalUrl = joinSvnUrl(item.url, val)
  }
  return {
    finalUrl,
    payloadVersion: {
      kind: 'svn',
      revision: 'HEAD',
      sourceUrl: finalUrl,
      label: val
    }
  }
}

function resolveSvnMainlineUrl(repo, url) {
  if (repo?.mainlines?.[0]?.url) return repo.mainlines[0].url
  const baseUrl = (repo?.url || url || '').trim().replace(/\/+$/, '')
  if (!baseUrl) return ''
  if (isTrunkUrl(baseUrl)) return baseUrl
  const trunk = (repo?.directories || []).find((name) => name.toLowerCase() === 'trunk')
  return trunk ? joinSvnUrl(baseUrl, trunk) : ''
}

function getSvnMainlineCandidates(repo, url) {
  if (repo?.mainlines?.length) return repo.mainlines
  const directUrl = (url || '').trim().replace(/\/+$/, '')
  return isTrunkUrl(directUrl) ? [{ path: directUrl.split('/').pop(), url: directUrl }] : []
}

function credentialFormFromStatus(status) {
  return {
    git: {
      mode: status?.git?.mode === 'ssh' ? 'ssh' : 'https',
      username: status?.git?.username || '',
      token: '',
      clearToken: false,
      sshKeyPath: status?.git?.sshKeyPath || '',
      sshPassphrase: '',
      clearSshPassphrase: false
    },
    svn: {
      username: status?.svn?.username || '',
      password: '',
      clearPassword: false
    }
  }
}

function App() {
  const [mode, setMode] = useState('single') // 'single' | 'batch'
  const [provider, setProvider] = useState('git')
  const [action, setAction] = useState('pull')
  const [svnMainlineOnly, setSvnMainlineOnly] = useState(false)
  const [svnMainlinePath, setSvnMainlinePath] = useState('')
  const [url, setUrl] = useState('')
  const [target, setTarget] = useState('')
  const [repo, setRepo] = useState(null)
  const [svnScope, setSvnScope] = useState(null)
  const [svnScopeLoading, setSvnScopeLoading] = useState(false)
  const [svnScopeError, setSvnScopeError] = useState('')
  const [browseEntries, setBrowseEntries] = useState([])
  const [browsePath, setBrowsePath] = useState('')
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseError, setBrowseError] = useState('')
  const [selectedPath, setSelectedPath] = useState('')
  const browseSeq = useRef(0)
  const [versionId, setVersionId] = useState('default')
  const [probing, setProbing] = useState(false)
  const [probeError, setProbeError] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(blankProgress)
  const [toast, setToast] = useState('')
  const [toolStatus, setToolStatus] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [credentialTab, setCredentialTab] = useState('git')
  const [credentialStatus, setCredentialStatus] = useState(null)
  const [credentialForm, setCredentialForm] = useState(() => credentialFormFromStatus(null))
  const [credentialLoading, setCredentialLoading] = useState(false)
  const [credentialSaving, setCredentialSaving] = useState(false)
  const [credentialTesting, setCredentialTesting] = useState(false)
  const [credentialTestMessage, setCredentialTestMessage] = useState('')
  const [recent, setRecent] = useState(() => {
    try { return JSON.parse(localStorage.getItem('code-sync-recent') || '[]') } catch { return [] }
  })

  // 批量拉取专属状态
  const [batchProvider, setBatchProvider] = useState('git')
  const [batchGitUrls, setBatchGitUrls] = useState(() => localStorage.getItem('code-sync-batch-git-urls') || '')
  const [batchSvnUrls, setBatchSvnUrls] = useState(() => localStorage.getItem('code-sync-batch-svn-urls') || '')
  const [batchTargetRoot, setBatchTargetRoot] = useState(() => localStorage.getItem('code-sync-batch-target-root') || '')
  const [batchConflictStrategy, setBatchConflictStrategy] = useState('update') // 'update' | 'skip' | 'error'
  const [batchGitBranch, setBatchGitBranch] = useState('')
  const [batchSvnMainlineOnly, setBatchSvnMainlineOnly] = useState(true)
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchItemStatuses, setBatchItemStatuses] = useState({})
  const [batchProgress, setBatchProgress] = useState({
    value: 0,
    label: '等待批量任务启动',
    currentItemName: '',
    currentIndex: 0,
    totalCount: 0,
    successCount: 0,
    errorCount: 0,
    skippedCount: 0,
    logs: [],
    status: 'idle'
  })

  const batchRunningRef = useRef(false)
  const cancelBatchRef = useRef(false)
  const [itemBranchOverrides, setItemBranchOverrides] = useState({})

  const handleItemBranchChange = (itemId, val) => {
    setItemBranchOverrides((prev) => ({
      ...prev,
      [itemId]: val
    }))
  }

  const handleApplyGlobalBranch = () => {
    const branch = batchGitBranch.trim()
    if (!branch) return showToast('请先输入要应用的全局分支名')
    setItemBranchOverrides((prev) => {
      const next = { ...prev }
      batchItems.forEach((item) => {
        next[item.id] = branch
      })
      return next
    })
    showToast(`已将分支 "${branch}" 应用到全部项目`)
  }

  // 存储批量输入
  const handleSetBatchGitUrls = (val) => {
    setBatchGitUrls(val)
    localStorage.setItem('code-sync-batch-git-urls', val)
  }
  const handleSetBatchSvnUrls = (val) => {
    setBatchSvnUrls(val)
    localStorage.setItem('code-sync-batch-svn-urls', val)
  }
  const handleSetBatchTargetRoot = (val) => {
    setBatchTargetRoot(val)
    localStorage.setItem('code-sync-batch-target-root', val)
  }

  const activeBatchUrls = batchProvider === 'git' ? batchGitUrls : batchSvnUrls

  const batchItems = useMemo(() => {
    return parseUrlList(activeBatchUrls, batchProvider, batchTargetRoot)
  }, [activeBatchUrls, batchProvider, batchTargetRoot])

  const [batchRepoDataMap, setBatchRepoDataMap] = useState({})
  const [batchProbingMap, setBatchProbingMap] = useState({})
  const [batchProbeErrorMap, setBatchProbeErrorMap] = useState({})

  async function probeSingleBatchRepo(repoUrl) {
    if (!repoUrl || !api || batchProbingMap[repoUrl]) return
    setBatchProbingMap((prev) => ({ ...prev, [repoUrl]: true }))
    setBatchProbeErrorMap((prev) => ({ ...prev, [repoUrl]: '' }))
    try {
      const result = await api.probeRepository({ provider: batchProvider, url: repoUrl })
      setBatchRepoDataMap((prev) => ({ ...prev, [repoUrl]: result }))
    } catch (err) {
      setBatchProbeErrorMap((prev) => ({ ...prev, [repoUrl]: appError(err) }))
    } finally {
      setBatchProbingMap((prev) => ({ ...prev, [repoUrl]: false }))
    }
  }

  async function probeAllBatchRepos() {
    if (!api || !batchItems.length) return
    const unprobed = batchItems.filter((item) => !batchRepoDataMap[item.url] && !batchProbingMap[item.url])
    const toProbe = unprobed.length ? unprobed : batchItems
    showToast(`正在读取 ${toProbe.length} 个仓库的可选版本...`)
    await Promise.all(toProbe.map((item) => probeSingleBatchRepo(item.url)))
    showToast('仓库版本读取完毕')
  }

  useEffect(() => {
    setBatchRepoDataMap({})
    setBatchProbingMap({})
    setBatchProbeErrorMap({})
    setItemBranchOverrides({})
  }, [batchProvider])

  useEffect(() => {
    if (!api || !batchItems.length || batchRunning) return
    const timer = setTimeout(() => {
      const unprobed = batchItems.filter((item) => !batchRepoDataMap[item.url] && !batchProbingMap[item.url])
      if (unprobed.length) {
        unprobed.forEach((item) => probeSingleBatchRepo(item.url))
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [batchItems, batchProvider])

  const protocolWarning = useMemo(() => {
    if (!activeBatchUrls.trim()) return null
    const lines = activeBatchUrls.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (batchProvider === 'git') {
      const hasSvn = lines.some(line => /^svn(?:\+[a-z]+)?:\/\//i.test(line) || /\/trunk\/?$/i.test(line))
      if (hasSvn) {
        return '检测到输入中可能包含 SVN 协议链接或 /trunk 路径，如需拉取 SVN 仓库请切换到顶部的【SVN 批量拉取】。'
      }
    } else if (batchProvider === 'svn') {
      const hasGit = lines.some(line => /^git@/i.test(line) || /\.git$/i.test(line))
      if (hasGit) {
        return '检测到输入中可能包含 Git 协议链接（git@ 或 .git），如需拉取 Git 仓库请切换到顶部的【Git 批量拉取】。'
      }
    }
    return null
  }, [activeBatchUrls, batchProvider])

  useEffect(() => {
    if (!api) return
    api.getToolStatus().then(setToolStatus).catch(() => {})
    return api.onTaskEvent((event) => {
      if (batchRunningRef.current) {
        if (event.type === 'line') {
          setBatchProgress((current) => ({
            ...current,
            logs: [...current.logs.slice(-399), { ...event }]
          }))
        }
        return
      }

      if (event.type === 'start') {
        setRunning(true)
        setProgress({ value: 1, label: event.label, logs: [], status: 'running', provider: event.provider, action: event.action })
      }
      if (event.type === 'step') setProgress((current) => ({ ...current, value: Math.max(current.value, event.value), label: event.label }))
      if (event.type === 'line') setProgress((current) => ({ ...current, logs: [...current.logs.slice(-399), { ...event }] }))
      if (event.type === 'progress') setProgress((current) => ({ ...current, value: Math.max(current.value, event.value), label: event.label }))
      if (event.type === 'done') {
        setRunning(false)
        setProgress((current) => ({ ...current, value: event.ok ? 100 : current.value, label: event.label, status: event.ok ? 'success' : 'error' }))
        setToast(event.ok ? '任务已完成' : '任务执行失败，请查看日志')
        window.setTimeout(() => setToast(''), 2600)
      }
    })
  }, [])

  useEffect(() => {
    setRepo(null)
    setSvnScope(null)
    setSvnScopeError('')
    setSvnScopeLoading(false)
    setVersionId('default')
    setProbeError('')
    setSvnMainlineOnly(false)
    setSvnMainlinePath('')
    setBrowseEntries([])
    setBrowsePath('')
    setBrowseLoading(false)
    setBrowseError('')
    setSelectedPath('')
  }, [provider])

  const versions = useMemo(() => {
    if (!repo) return []
    if (provider === 'git') return [
      { id: 'default', kind: 'branch', name: repo.defaultBranch || 'HEAD', label: `默认分支 · ${repo.defaultBranch || 'HEAD'}` },
      ...(repo.branches || []).filter((item) => item.name !== repo.defaultBranch).map((item) => ({ id: `branch:${item.name}`, kind: 'branch', name: item.name, label: item.name, hash: item.hash })),
      ...(repo.tags || []).map((item) => ({ id: `tag:${item.name}`, kind: 'tag', name: item.name, label: item.name, hash: item.hash }))
    ]
    return [
      { id: 'default', kind: 'svn', name: '', label: `最新版本 · r${repo.latestRevision || 'HEAD'}`, revision: 'HEAD', sourceUrl: repo.url },
      ...(repo.revisions || []).map((item) => ({ id: `revision:${item.revision}`, kind: 'svn', name: `r${item.revision}`, label: `r${item.revision} · ${item.message || '无提交说明'}`, revision: item.revision, sourceUrl: repo.url }))
    ]
  }, [repo, provider])

  const selectedVersion = versions.find((item) => item.id === versionId) || versions[0] || { kind: provider === 'git' ? 'branch' : 'svn', name: provider === 'git' ? 'HEAD' : '', revision: 'HEAD', sourceUrl: url }
  const svnScopeUrl = provider === 'svn' ? (selectedVersion.sourceUrl || repo?.url || url) : ''

  useEffect(() => {
    if (!api || provider !== 'svn' || !repo || !svnScopeUrl) return
    let cancelled = false
    const rootScope = svnScopeUrl === repo.url
    setSvnScopeError('')
    setSvnMainlinePath('')
    if (rootScope) {
      setSvnScope(repo)
      setSvnScopeLoading(false)
      setSvnMainlinePath(repo.mainlines?.[0]?.url || (isTrunkUrl(repo.url) ? repo.url : ''))
      return undefined
    }
    setSvnScope(null)
    setSvnScopeLoading(true)
    api.probeRepository({ provider: 'svn', url: svnScopeUrl })
      .then((result) => {
        if (cancelled) return
        setSvnScope(result)
        setSvnMainlinePath(result.mainlines?.[0]?.url || (isTrunkUrl(result.url) ? result.url : ''))
      })
      .catch((error) => {
        if (cancelled) return
        setSvnScopeError(appError(error))
      })
      .finally(() => { if (!cancelled) setSvnScopeLoading(false) })
    return () => { cancelled = true }
  }, [provider, repo?.url, svnScopeUrl, versionId])

  useEffect(() => {
    if (!api || !repo) {
      setBrowseEntries([])
      setBrowsePath('')
      setSelectedPath('')
      setBrowseError('')
      setBrowseLoading(false)
      return undefined
    }
    const seq = ++browseSeq.current
    const version = versions.find((item) => item.id === versionId) || versions[0] || null
    setBrowseLoading(true)
    setBrowseError('')
    setBrowsePath('')
    setSelectedPath('')
    api.browseRepository({
      provider,
      url: repo.url,
      ...(provider === 'svn' ? { revision: version?.revision || 'HEAD' } : { version: version ? { name: version.name, kind: version.kind } : {} })
    })
      .then((result) => { if (seq === browseSeq.current) setBrowseEntries(result.entries || []) })
      .catch((error) => { if (seq === browseSeq.current) setBrowseError(appError(error)) })
      .finally(() => { if (seq === browseSeq.current) setBrowseLoading(false) })
    return undefined
  }, [provider, repo?.url, versionId])

  function navigateBrowse(path) {
    if (!api || !repo) return
    const seq = ++browseSeq.current
    const version = versions.find((item) => item.id === versionId) || versions[0] || null
    setBrowseLoading(true)
    setBrowseError('')
    api.browseRepository({
      provider,
      url: repo.url,
      path,
      ...(provider === 'svn' ? { revision: version?.revision || 'HEAD' } : { version: version ? { name: version.name, kind: version.kind } : {} })
    })
      .then((result) => { if (seq === browseSeq.current) { setBrowsePath(path); setBrowseEntries(result.entries || []) } })
      .catch((error) => { if (seq === browseSeq.current) setBrowseError(appError(error)) })
      .finally(() => { if (seq === browseSeq.current) setBrowseLoading(false) })
  }

  function selectBrowsePath(path) {
    setSelectedPath(path)
    if (provider === 'svn' && svnMainlineOnly) setSvnMainlineOnly(false)
  }

  const mainlineCandidates = provider === 'svn' ? getSvnMainlineCandidates(svnScope, svnScopeUrl || url) : []
  const svnMainlineUrl = provider === 'svn' ? (svnMainlinePath || resolveSvnMainlineUrl(svnScope, svnScopeUrl || url)) : ''
  const mainlineStatus = svnScopeLoading ? '正在检索' : svnMainlineUrl ? 'trunk 可用' : svnScopeError ? '检索失败' : svnScope ? '未发现 trunk' : '先选择目标目录'

  async function browseTarget() {
    if (!api) return showToast('请在桌面版中使用目录选择')
    const selected = await api.choosePath()
    if (selected) setTarget(selected)
  }

  async function browseBatchTargetRoot() {
    if (!api) return showToast('请在桌面版中使用目录选择')
    const selected = await api.choosePath()
    if (selected) {
      handleSetBatchTargetRoot(selected)
    }
  }

  async function probe() {
    if (!url.trim()) return setProbeError('请输入仓库地址后再查看版本。')
    if (!api) return setProbeError('仓库探测需要在桌面版中运行。')
    setProbing(true)
    setProbeError('')
    try {
      const result = await api.probeRepository({ provider, url })
      setRepo(result)
      setSvnScope(result)
      setSvnScopeError('')
      setVersionId('default')
      setSvnMainlinePath(result.mainlines?.[0]?.url || (isTrunkUrl(result.url) ? result.url : ''))
      showToast(provider === 'git' ? `已读取 ${(result.branches || []).length} 个分支` : `已读取 ${result.revisions?.length || 0} 条修订记录`)
    } catch (error) {
      setRepo(null)
      setProbeError(appError(error))
    } finally {
      setProbing(false)
    }
  }

  async function runTask() {
    if (running || batchRunning) return
    if (!target.trim()) return showToast('请先选择本地项目目录')
    if (action === 'pull' && !url.trim()) return showToast('拉取代码需要输入仓库地址')
    if (!api) return showToast('任务执行需要在桌面版中运行')
    if (provider === 'svn' && action === 'pull' && svnMainlineOnly && !svnMainlineUrl) {
      return showToast('没有检测到 trunk，请先查看仓库版本，或直接输入 trunk 地址')
    }
    if (action === 'update') {
      try {
        const local = await api.inspectLocal({ target })
        if (local.provider !== provider) return showToast(`目标目录识别为 ${local.provider.toUpperCase()}，与当前选择不一致`)
      } catch (error) {
        return showToast(appError(error))
      }
    }
    const payloadVersion = provider === 'svn'
      ? {
          ...selectedVersion,
          sourceUrl: action === 'update'
            ? (selectedPath ? joinSvnUrl(repo.url, selectedPath) : (selectedVersion.sourceUrl || url))
            : (svnMainlineOnly ? svnMainlineUrl : (selectedPath ? joinSvnUrl(repo.url, selectedPath) : (selectedVersion.sourceUrl || url))),
          revision: selectedVersion.revision || 'HEAD',
          ...(action === 'pull' && svnMainlineOnly
            ? { kind: 'path', name: 'trunk', label: `主线 trunk · r${selectedVersion.revision || 'HEAD'}` }
            : selectedPath
              ? { kind: 'path', name: selectedPath, label: `目录 ${selectedPath} · r${selectedVersion.revision || 'HEAD'}` }
              : {})
        }
      : { ...selectedVersion, name: selectedVersion.name && selectedVersion.name !== 'HEAD' ? selectedVersion.name : '' }
    setRunning(true)
    setProgress({ ...blankProgress, status: 'running', label: action === 'pull' ? '正在启动拉取...' : '正在启动更新...' })
    try {
      await api.runTask({ provider, action, url: provider === 'svn' ? (payloadVersion.sourceUrl || url) : url, target, version: payloadVersion, path: selectedPath })
      const entry = { id: Date.now(), provider, action, version: payloadVersion.label || payloadVersion.name || 'HEAD', target, time: new Date().toISOString(), ok: true }
      const next = [entry, ...recent.filter((item) => item.target !== target)].slice(0, 6)
      setRecent(next)
      localStorage.setItem('code-sync-recent', JSON.stringify(next))
    } catch (error) {
      setToast(appError(error))
      window.setTimeout(() => setToast(''), 4200)
    }
  }

  async function cancelTask() {
    if (api) await api.cancelTask()
  }

  async function runBatchSync(onlyRetryFailed = false) {
    if (batchRunning || running) return
    if (!batchTargetRoot.trim()) return showToast('请先选择本地保存根目录')
    if (!api) return showToast('任务执行需要在桌面版中运行')

    const targetItems = onlyRetryFailed
      ? batchItems.filter((item) => batchItemStatuses[item.id]?.status === 'error')
      : batchItems

    if (!targetItems.length) {
      return showToast(onlyRetryFailed ? '没有失败的项目需要重试' : '请先在文本框中输入仓库链接')
    }

    setBatchRunning(true)
    batchRunningRef.current = true
    cancelBatchRef.current = false

    setBatchItemStatuses((prev) => {
      const next = { ...prev }
      targetItems.forEach((item) => {
        next[item.id] = { status: 'idle', error: '' }
      })
      return next
    })

    const total = targetItems.length
    let successCount = 0
    let errorCount = 0
    let skippedCount = 0

    setBatchProgress({
      value: 1,
      label: `准备批量拉取 (共 ${total} 个仓库)...`,
      currentItemName: '',
      currentIndex: 0,
      totalCount: total,
      successCount: 0,
      errorCount: 0,
      skippedCount: 0,
      logs: [
        {
          time: new Date().toISOString(),
          text: `========== 批量任务启动: 共 ${total} 个 ${batchProvider.toUpperCase()} 仓库 ==========`,
          source: 'stdout'
        }
      ],
      status: 'running'
    })

    for (let i = 0; i < targetItems.length; i++) {
      if (cancelBatchRef.current) break
      const item = targetItems[i]
      const itemIndex = i + 1

      let pathInfo = { exists: false, isDirectory: false, empty: true, hasGit: false, hasSvn: false }
      try {
        if (api.checkPath) {
          pathInfo = await api.checkPath(item.target)
        }
      } catch {}

      let taskAction = 'pull'
      if (pathInfo.exists && !pathInfo.empty) {
        if (batchConflictStrategy === 'skip') {
          setBatchItemStatuses((prev) => ({ ...prev, [item.id]: { status: 'skipped', error: '目标目录已存在，已跳过' } }))
          skippedCount++
          setBatchProgress((prev) => ({
            ...prev,
            value: Math.round(((i + 1) / total) * 100),
            skippedCount,
            logs: [
              ...prev.logs.slice(-399),
              {
                time: new Date().toISOString(),
                text: `[${itemIndex}/${total}] [跳过] ${item.name} (${item.target}) 目录已存在`,
                source: 'stdout'
              }
            ]
          }))
          continue
        } else if (batchConflictStrategy === 'update') {
          const canUpdate = (batchProvider === 'git' && pathInfo.hasGit) || (batchProvider === 'svn' && pathInfo.hasSvn)
          if (canUpdate) {
            taskAction = 'update'
          } else {
            const errMsg = `目标目录已存在非空内容且非有效 ${batchProvider.toUpperCase()} 仓库`
            setBatchItemStatuses((prev) => ({ ...prev, [item.id]: { status: 'error', error: errMsg } }))
            errorCount++
            setBatchProgress((prev) => ({
              ...prev,
              value: Math.round(((i + 1) / total) * 100),
              errorCount,
              logs: [
                ...prev.logs.slice(-399),
                {
                  time: new Date().toISOString(),
                  text: `[${itemIndex}/${total}] [错误] ${item.name}: ${errMsg}`,
                  source: 'stderr'
                }
              ]
            }))
            continue
          }
        } else {
          const errMsg = '目标目录已存在'
          setBatchItemStatuses((prev) => ({ ...prev, [item.id]: { status: 'error', error: errMsg } }))
          errorCount++
          setBatchProgress((prev) => ({
            ...prev,
            value: Math.round(((i + 1) / total) * 100),
            errorCount,
            logs: [
              ...prev.logs.slice(-399),
              {
                time: new Date().toISOString(),
                text: `[${itemIndex}/${total}] [错误] ${item.name}: ${errMsg}`,
                source: 'stderr'
              }
            ]
          }))
          continue
        }
      }

      const branchSelection = itemBranchOverrides[item.id] !== undefined
        ? itemBranchOverrides[item.id]
        : item.parsedBranch

      const { finalUrl, payloadVersion } = resolveItemVersionPayload(
        item,
        branchSelection,
        batchProvider,
        batchGitBranch,
        batchSvnMainlineOnly
      )

      setBatchItemStatuses((prev) => ({ ...prev, [item.id]: { status: 'running', error: '' } }))
      const actionLabel = taskAction === 'pull' ? '拉取' : '更新'
      const branchDisplay = payloadVersion.label ? `[${payloadVersion.label}]` : '[默认主线]'
      const stepLabel = `[${itemIndex}/${total}] 正在${actionLabel} ${item.name} ${branchDisplay}`

      setBatchProgress((prev) => ({
        ...prev,
        label: stepLabel,
        currentItemName: item.name,
        currentIndex: itemIndex,
        logs: [
          ...prev.logs.slice(-399),
          {
            time: new Date().toISOString(),
            text: `>>> [${itemIndex}/${total}] 开始${actionLabel} ${item.name} ${branchDisplay} -> ${item.target}`,
            source: 'stdout'
          }
        ]
      }))

      try {
        await api.runTask({
          provider: batchProvider,
          action: taskAction,
          url: finalUrl,
          target: item.target,
          version: payloadVersion,
          path: ''
        })

        if (cancelBatchRef.current) break

        setBatchItemStatuses((prev) => ({ ...prev, [item.id]: { status: 'success', error: '' } }))
        successCount++

        const entry = {
          id: Date.now() + i,
          provider: batchProvider,
          action: taskAction,
          version: payloadVersion.label || 'HEAD',
          target: item.target,
          time: new Date().toISOString(),
          ok: true
        }
        setRecent((currentRecent) => {
          const next = [entry, ...currentRecent.filter((r) => r.target !== item.target)].slice(0, 6)
          localStorage.setItem('code-sync-recent', JSON.stringify(next))
          return next
        })

        setBatchProgress((prev) => ({
          ...prev,
          value: Math.round((itemIndex / total) * 100),
          successCount,
          logs: [
            ...prev.logs.slice(-399),
            {
              time: new Date().toISOString(),
              text: `<<< [${itemIndex}/${total}] ${item.name} ${actionLabel}成功`,
              source: 'stdout'
            }
          ]
        }))
      } catch (err) {
        if (cancelBatchRef.current) {
          setBatchItemStatuses((prev) => ({ ...prev, [item.id]: { status: 'idle', error: '任务已被取消' } }))
          break
        }
        const errMsg = appError(err)
        setBatchItemStatuses((prev) => ({ ...prev, [item.id]: { status: 'error', error: errMsg } }))
        errorCount++
        setBatchProgress((prev) => ({
          ...prev,
          value: Math.round((itemIndex / total) * 100),
          errorCount,
          logs: [
            ...prev.logs.slice(-399),
            {
              time: new Date().toISOString(),
              text: `<<< [${itemIndex}/${total}] ${item.name} 失败: ${errMsg}`,
              source: 'stderr'
            }
          ]
        }))
      }
    }

    setBatchRunning(false)
    batchRunningRef.current = false
    const isCancelled = cancelBatchRef.current
    const summaryStatus = isCancelled ? 'cancelled' : errorCount === 0 ? 'success' : 'error'
    const summaryLabel = isCancelled
      ? `批量任务已停止：已完成 ${successCount} 个，失败 ${errorCount} 个，跳过 ${skippedCount} 个`
      : `批量任务完成：成功 ${successCount} 个，失败 ${errorCount} 个，跳过 ${skippedCount} 个`

    setBatchProgress((prev) => ({
      ...prev,
      label: summaryLabel,
      status: summaryStatus,
      logs: [
        ...prev.logs.slice(-399),
        {
          time: new Date().toISOString(),
          text: `========== ${summaryLabel} ==========`,
          source: isCancelled ? 'stderr' : errorCount === 0 ? 'stdout' : 'stderr'
        }
      ]
    }))

    showToast(summaryLabel)
  }

  async function cancelBatchSync() {
    cancelBatchRef.current = true
    if (api) {
      try {
        await api.cancelTask()
      } catch {}
    }
    showToast('正在停止批量任务...')
  }

  function clearBatchUrls() {
    if (batchProvider === 'git') {
      handleSetBatchGitUrls('')
    } else {
      handleSetBatchSvnUrls('')
    }
    setBatchItemStatuses({})
    setItemBranchOverrides({})
    showToast('已清空当前链接列表')
  }

  function showToast(message) {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  async function openCredentialSettings() {
    if (!api) return showToast('凭据设置需要在桌面版中使用')
    setCredentialLoading(true)
    try {
      const status = await api.getCredentialStatus()
      setCredentialStatus(status)
      setCredentialForm(credentialFormFromStatus(status))
      setCredentialTab(provider === 'svn' || (mode === 'batch' && batchProvider === 'svn') ? 'svn' : 'git')
      setCredentialTestMessage('')
      setSettingsOpen(true)
    } catch (error) {
      showToast(appError(error))
    } finally {
      setCredentialLoading(false)
    }
  }

  function updateCredentialField(section, field, value) {
    setCredentialForm((current) => ({ ...current, [section]: { ...current[section], [field]: value } }))
  }

  async function browseSshKey() {
    if (!api) return showToast('SSH 私钥选择需要在桌面版中使用')
    const selected = await api.chooseFile()
    if (selected) updateCredentialField('git', 'sshKeyPath', selected)
  }

  async function saveCredentialSettings() {
    if (!api || credentialSaving) return
    setCredentialSaving(true)
    try {
      const status = await api.saveCredentials(credentialForm)
      setCredentialStatus(status)
      setCredentialForm(credentialFormFromStatus(status))
      showToast('凭据已加密保存')
    } catch (error) {
      showToast(appError(error))
    } finally {
      setCredentialSaving(false)
    }
  }

  async function testCredentialSettings() {
    if (!api || credentialTesting) return
    setCredentialTesting(true)
    setCredentialTestMessage(`正在用当前 ${credentialTab.toUpperCase()} 地址验证凭证...`)
    try {
      const testUrl = mode === 'batch'
        ? (credentialTab === 'git' ? (batchItems[0]?.url || 'https://github.com') : (batchItems[0]?.url || ''))
        : url
      const result = await api.testCredentials({ provider: credentialTab, url: testUrl, credentials: credentialForm[credentialTab] })
      const detail = credentialTab === 'git'
        ? (result.branch ? `默认分支 ${result.branch}` : '远程仓库可访问')
        : `${result.username}${result.revision ? `，仓库版本 r${result.revision}` : ''}`
      setCredentialTestMessage(`连接成功：${detail}`)
    } catch (error) {
      setCredentialTestMessage(appError(error))
    } finally {
      setCredentialTesting(false)
    }
  }

  async function clearCredentialSettings() {
    if (!api || credentialSaving) return
    setCredentialSaving(true)
    try {
      const status = await api.clearCredentials(credentialTab)
      setCredentialStatus(status)
      setCredentialForm(credentialFormFromStatus(status))
      showToast(`${credentialTab === 'git' ? 'Git' : 'SVN'} 凭据已清除`)
    } catch (error) {
      showToast(appError(error))
    } finally {
      setCredentialSaving(false)
    }
  }

  function loadRecent(entry) {
    setMode('single')
    setProvider(entry.provider)
    setAction(entry.action)
    setTarget(entry.target)
    showToast('已载入最近任务的本地目录')
  }

  const gitReady = toolStatus?.git?.installed !== false
  const svnReady = toolStatus?.svn?.installed !== false

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark"><img src={logoUrl} alt="CodeSync Studio" /></div>
          <div><strong>CodeSync</strong><span>STUDIO</span></div>
        </div>
        <div className="sidebar-section-label">工作区</div>
        <nav className="side-nav">
          <button
            className={`side-nav-item ${mode === 'single' ? 'active' : ''}`}
            onClick={() => setMode('single')}
          >
            <HardDriveDownload size={17} />
            <span>单仓同步</span>
          </button>
          <button
            className={`side-nav-item ${mode === 'batch' ? 'active' : ''}`}
            onClick={() => setMode('batch')}
          >
            <Layers size={17} />
            <span>批量拉取</span>
          </button>
          <button
            className="side-nav-item"
            onClick={() => document.getElementById('recent')?.scrollIntoView({ behavior: 'smooth' })}
          >
            <History size={17} />
            <span>最近任务</span>
            <b>{recent.length || ''}</b>
          </button>
        </nav>
        <div className="sidebar-section-label tools-label">本机工具</div>
        <div className="tool-check">
          <span className="tool-icon git-icon"><GitBranch size={15} /></span>
          <span>Git</span>
          <i className={gitReady ? 'online-dot' : 'offline-dot'} />
          <small>{toolStatus?.git?.version ? toolStatus.git.version.replace(/^git version /, 'v') : '检测中'}</small>
        </div>
        <div className="tool-check">
          <span className="tool-icon svn-icon"><Server size={15} /></span>
          <span>SVN</span>
          <i className={svnReady ? 'online-dot' : 'offline-dot'} />
          <small>{toolStatus?.svn?.version ? toolStatus.svn.version.replace(/^svn, version /, 'v').split(' ')[0] : '检测中'}</small>
        </div>
        <div className="sidebar-footer">
          <button className="side-nav-item" onClick={openCredentialSettings} disabled={credentialLoading}>
            <Settings2 size={16} />
            <span>连接设置</span>
          </button>
          <div className="safe-note">
            <CheckCircle2 size={15} />
            <span>命令在本机执行<br />凭据不会上传</span>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-title">
            <span>开发工具</span>
            <ChevronDown size={14} />
            <strong>{mode === 'single' ? '单仓代码同步' : '批量代码拉取'}</strong>
          </div>
          <div className="mode-segmented">
            <button
              type="button"
              className={`mode-tab-btn ${mode === 'single' ? 'active' : ''}`}
              onClick={() => setMode('single')}
            >
              <HardDriveDownload size={13} />
              <span>单仓模式</span>
            </button>
            <button
              type="button"
              className={`mode-tab-btn ${mode === 'batch' ? 'active' : ''}`}
              onClick={() => setMode('batch')}
            >
              <Layers size={13} />
              <span>批量拉取</span>
            </button>
          </div>
          <div className="topbar-right">
            <span className="runtime-badge"><span className="pulse" /> 本机模式</span>
            <button className="icon-button" title="帮助" onClick={() => showToast('Git/SVN 认证使用本机已配置的凭据')}>
              <CircleHelp size={18} />
            </button>
            <div className="profile">CS</div>
          </div>
        </header>

        <div className="page-content">
          <section className="page-intro">
            <div>
              <p className="kicker">
                <span className="intro-mark"><GitCommitHorizontal size={13} /></span>
                {mode === 'single' ? '仓库工作台' : '批量同步引擎'}
              </p>
              <h1>{mode === 'single' ? '同步你的代码' : '批量拉取代码库'}</h1>
              <p className="intro-copy">
                {mode === 'single'
                  ? '快速拉取新项目，或把已有工作副本更新到指定分支、标签和修订版本。'
                  : '支持多个链接一起拉取，一行一个链接。Git 和 SVN 严格分开管理，自动生成本地项目目录。'}
              </p>
            </div>
            <div className="intro-meta">
              <span>执行引擎</span>
              <strong>Git · SVN CLI</strong>
              <small>{mode === 'single' ? '实时输出已开启' : '批量队列已就绪'}</small>
            </div>
          </section>

          {mode === 'single' ? (
            <section className="sync-layout">
              <div className="sync-panel panel">
                <div className="panel-heading">
                  <div>
                    <p className="section-kicker">STEP 01</p>
                    <h2>配置同步任务</h2>
                  </div>
                  <span className="secure-label"><Check size={13} /> 本机执行</span>
                </div>
                <div className="field-group">
                  <label className="field-title">版本控制系统</label>
                  <div className="segmented-control">
                    <button className={provider === 'git' ? 'selected git-selected' : ''} onClick={() => setProvider('git')}>
                      <GitBranch size={16} /> Git
                    </button>
                    <button className={provider === 'svn' ? 'selected svn-selected' : ''} onClick={() => setProvider('svn')}>
                      <Server size={16} /> SVN
                    </button>
                  </div>
                </div>
                <div className="field-group">
                  <label className="field-title">任务类型</label>
                  <div className="action-switch">
                    <button className={action === 'pull' ? 'selected' : ''} onClick={() => setAction('pull')}>
                      <ArrowDownToLine size={16} />
                      <span><b>拉取代码</b><small>从远程仓库创建工作副本</small></span>
                    </button>
                    <button className={action === 'update' ? 'selected' : ''} onClick={() => setAction('update')}>
                      <RefreshCw size={16} />
                      <span><b>更新代码</b><small>更新已有本地工作副本</small></span>
                    </button>
                  </div>
                </div>
                <div className="field-group">
                  <div className="label-row">
                    <label className="field-title" htmlFor="repo-url">仓库地址</label>
                    <span>支持 HTTPS / SSH / SVN URL</span>
                  </div>
                  <div className="input-with-icon">
                    <Upload size={16} />
                    <input
                      id="repo-url"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') probe() }}
                      placeholder={provider === 'git' ? 'https://github.com/org/project.git' : 'https://svn.example.com/repos/project'}
                    />
                    <button className={probing ? 'loading-button' : ''} onClick={probe} title="查看仓库版本" disabled={probing}>
                      {probing ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}
                    </button>
                  </div>
                  {probeError && <div className="field-error"><AlertCircle size={14} />{probeError}</div>}
                </div>
                <div className="repo-discovery">
                  {repo ? <RepoSummary repo={repo} provider={provider} /> : (
                    <div className="discovery-empty">
                      <Search size={17} />
                      <span>输入地址后点击右侧按钮，读取远程分支、标签或修订版本</span>
                    </div>
                  )}
                </div>
                <div className="field-group">
                  <div className="label-row">
                    <label className="field-title" htmlFor="version-select">目标版本</label>
                    <span>{versions.length ? `${versions.length} 个可选版本` : '请先查看仓库版本'}</span>
                  </div>
                  <div className="select-wrap">
                    <GitCommitHorizontal size={16} />
                    <select
                      id="version-select"
                      value={versionId}
                      onChange={(event) => setVersionId(event.target.value)}
                      disabled={!versions.length}
                    >
                      {versions.length ? (
                        versions.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}{item.hash ? `  ·  ${shortHash(item.hash)}` : ''}
                          </option>
                        ))
                      ) : (
                        <option>先获取仓库信息</option>
                      )}
                    </select>
                    <ChevronDown size={15} />
                  </div>
                </div>
                {repo && (
                  <div className="field-group browse-group">
                    <div className="label-row">
                      <label className="field-title">仓库目录浏览</label>
                      <span>{selectedPath ? `已选择：${selectedPath}` : action === 'update' ? '未选择目录，将更新整个工作副本' : '未选择目录，将拉取整个仓库'}</span>
                    </div>
                    <DirectoryBrowser
                      entries={browseEntries}
                      path={browsePath}
                      loading={browseLoading}
                      error={browseError}
                      selectedPath={selectedPath}
                      onNavigate={navigateBrowse}
                      onSelect={selectBrowsePath}
                      action={action}
                    />
                  </div>
                )}
                {provider === 'svn' && action === 'pull' && (
                  <div className={`mainline-option ${svnMainlineOnly ? 'enabled' : ''}`}>
                    <label className="toggle-line">
                      <input
                        type="checkbox"
                        checked={svnMainlineOnly}
                        onChange={(event) => { setSvnMainlineOnly(event.target.checked); if (event.target.checked) setSelectedPath('') }}
                        disabled={!url.trim()}
                      />
                      <span className="fake-checkbox"><Check size={12} /></span>
                      <span className="mainline-copy">
                        <b>仅拉取主线内容</b>
                        <small>按目标版本目录检索并只检出 <code>trunk</code>，不拉取 branches / tags</small>
                      </span>
                    </label>
                    <div className="mainline-actions">
                      {mainlineCandidates.length > 1 && (
                        <select aria-label="主线目录" value={svnMainlinePath} onChange={(event) => setSvnMainlinePath(event.target.value)}>
                          {mainlineCandidates.map((item) => <option key={item.url} value={item.url}>{item.path}</option>)}
                        </select>
                      )}
                      <span className={`mainline-status ${svnMainlineUrl ? 'available' : ''}`}>{mainlineStatus}</span>
                    </div>
                  </div>
                )}
                <div className="field-group">
                  <div className="label-row">
                    <label className="field-title" htmlFor="target-path">本地项目目录</label>
                    <span>{action === 'pull' ? '选择空目录或新目录' : '选择已有工作副本'}</span>
                  </div>
                  <div className="input-with-icon">
                    <FolderOpen size={16} />
                    <input
                      id="target-path"
                      value={target}
                      onChange={(event) => setTarget(event.target.value)}
                      placeholder={action === 'pull' ? '例如：D:\\workspace\\project' : '例如：D:\\workspace\\existing-project'}
                    />
                    <button onClick={browseTarget} title="选择目录"><FolderOpen size={16} /></button>
                  </div>
                </div>
                <div className="execution-note">
                  <Info size={15} />
                  <span>认证使用本机 Git Credential Manager、SSH Key 或 SVN 客户端配置。工具不会上传仓库地址、代码或凭据。</span>
                </div>
                <div className="panel-actions">
                  <button className="primary-action" onClick={runTask} disabled={running}>
                    {running ? <LoaderCircle size={17} className="spin" /> : action === 'pull' ? <Download size={17} /> : <RefreshCw size={17} />}
                    {running ? '任务执行中' : action === 'pull' ? '开始拉取' : '开始更新'}
                  </button>
                  <button
                    className="ghost-action"
                    onClick={() => {
                      setUrl('')
                      setRepo(null)
                      setSvnScope(null)
                      setSvnScopeError('')
                      setSvnScopeLoading(false)
                      setSvnMainlineOnly(false)
                      setSvnMainlinePath('')
                      setProbeError('')
                      setVersionId('default')
                      setBrowseEntries([])
                      setBrowsePath('')
                      setBrowseLoading(false)
                      setBrowseError('')
                      setSelectedPath('')
                    }}
                    disabled={running}
                  >
                    <X size={16} />清空
                  </button>
                </div>
              </div>

              <TaskPanel
                progress={progress}
                running={running}
                cancelTask={cancelTask}
                clearLogs={() => setProgress((current) => ({ ...current, logs: [] }))}
              />
            </section>
          ) : (
            <section className="sync-layout">
              <BatchSyncPanel
                batchProvider={batchProvider}
                setBatchProvider={setBatchProvider}
                batchGitUrls={batchGitUrls}
                setBatchGitUrls={handleSetBatchGitUrls}
                batchSvnUrls={batchSvnUrls}
                setBatchSvnUrls={handleSetBatchSvnUrls}
                batchTargetRoot={batchTargetRoot}
                setBatchTargetRoot={handleSetBatchTargetRoot}
                browseBatchTargetRoot={browseBatchTargetRoot}
                batchConflictStrategy={batchConflictStrategy}
                setBatchConflictStrategy={setBatchConflictStrategy}
                batchGitBranch={batchGitBranch}
                setBatchGitBranch={setBatchGitBranch}
                batchSvnMainlineOnly={batchSvnMainlineOnly}
                setBatchSvnMainlineOnly={setBatchSvnMainlineOnly}
                batchItems={batchItems}
                batchItemStatuses={batchItemStatuses}
                itemBranchOverrides={itemBranchOverrides}
                onItemBranchChange={handleItemBranchChange}
                onApplyGlobalBranch={handleApplyGlobalBranch}
                batchRepoDataMap={batchRepoDataMap}
                batchProbingMap={batchProbingMap}
                batchProbeErrorMap={batchProbeErrorMap}
                onProbeSingle={probeSingleBatchRepo}
                onProbeAll={probeAllBatchRepos}
                batchRunning={batchRunning}
                protocolWarning={protocolWarning}
                onStart={() => runBatchSync(false)}
                onRetryFailed={() => runBatchSync(true)}
                onClearUrls={clearBatchUrls}
              />

              <BatchTaskPanel
                progress={batchProgress}
                running={batchRunning}
                cancelTask={cancelBatchSync}
                clearLogs={() => setBatchProgress((current) => ({ ...current, logs: [] }))}
              />
            </section>
          )}

          <section className="recent-section" id="recent">
            <div className="section-title-row">
              <div>
                <p className="section-kicker">ACTIVITY</p>
                <h2>最近任务</h2>
              </div>
              <button
                className="text-button"
                onClick={() => {
                  setRecent([])
                  localStorage.removeItem('code-sync-recent')
                  showToast('最近任务已清空')
                }}
              >
                清空记录
              </button>
            </div>
            <div className="recent-table">
              {recent.length ? (
                <>
                  {recent.map((entry) => (
                    <button className="recent-row" key={entry.id} onClick={() => loadRecent(entry)}>
                      <span className={`provider-badge ${entry.provider}`}>
                        <span>{entry.provider === 'git' ? 'G' : 'S'}</span>
                        {entry.provider.toUpperCase()}
                      </span>
                      <span className="recent-operation">
                        <b>{entry.action === 'pull' ? '拉取代码' : '更新代码'}</b>
                        <small>{entry.version}</small>
                      </span>
                      <span className="recent-path">{entry.target}</span>
                      <span className="recent-time"><Clock3 size={13} />{formatTime(entry.time)}</span>
                      <CheckCircle2 size={16} className="recent-success" />
                    </button>
                  ))}
                </>
              ) : (
                <div className="recent-empty">
                  <History size={18} />
                  <span>完成一次拉取或更新后，任务会显示在这里</span>
                </div>
              )}
            </div>
          </section>

          <footer className="page-footer">
            <span>CodeSync Studio 1.0.15</span>
            <span>需要帮助？确认 Git / SVN 已安装并已加入系统 PATH</span>
          </footer>
        </div>
      </main>

      {toast && <div className="toast"><CheckCircle2 size={16} />{toast}</div>}
      {settingsOpen && (
        <CredentialDialog
          tab={credentialTab}
          setTab={(value) => { setCredentialTab(value); setCredentialTestMessage('') }}
          status={credentialStatus}
          form={credentialForm}
          saving={credentialSaving}
          testing={credentialTesting}
          testMessage={credentialTestMessage}
          onChange={updateCredentialField}
          onBrowseKey={browseSshKey}
          onSave={saveCredentialSettings}
          onTest={testCredentialSettings}
          onClear={clearCredentialSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}

function BatchSyncPanel({
  batchProvider,
  setBatchProvider,
  batchGitUrls,
  setBatchGitUrls,
  batchSvnUrls,
  setBatchSvnUrls,
  batchTargetRoot,
  setBatchTargetRoot,
  browseBatchTargetRoot,
  batchConflictStrategy,
  setBatchConflictStrategy,
  batchGitBranch,
  setBatchGitBranch,
  batchSvnMainlineOnly,
  setBatchSvnMainlineOnly,
  batchItems,
  batchItemStatuses,
  itemBranchOverrides,
  onItemBranchChange,
  onApplyGlobalBranch,
  batchRepoDataMap,
  batchProbingMap,
  batchProbeErrorMap,
  onProbeSingle,
  onProbeAll,
  batchRunning,
  protocolWarning,
  onStart,
  onRetryFailed,
  onClearUrls
}) {
  const currentUrls = batchProvider === 'git' ? batchGitUrls : batchSvnUrls
  const setUrls = batchProvider === 'git' ? setBatchGitUrls : setBatchSvnUrls
  const failedCount = batchItems.filter((item) => batchItemStatuses[item.id]?.status === 'error').length

  return (
    <div className="sync-panel panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">STEP 01</p>
          <h2>配置批量拉取任务</h2>
        </div>
        <span className="secure-label"><Check size={13} /> 队列顺序执行</span>
      </div>

      <div className="field-group">
        <label className="field-title">版本控制系统 (Git 与 SVN 相互独立)</label>
        <div className="segmented-control">
          <button
            type="button"
            className={batchProvider === 'git' ? 'selected git-selected' : ''}
            onClick={() => setBatchProvider('git')}
            disabled={batchRunning}
          >
            <GitBranch size={16} /> Git 批量拉取
          </button>
          <button
            type="button"
            className={batchProvider === 'svn' ? 'selected svn-selected' : ''}
            onClick={() => setBatchProvider('svn')}
            disabled={batchRunning}
          >
            <Server size={16} /> SVN 批量拉取
          </button>
        </div>
      </div>

      <div className="field-group">
        <div className="label-row">
          <label className="field-title" htmlFor="batch-urls-input">
            {batchProvider === 'git' ? 'Git 仓库链接列表' : 'SVN 仓库链接列表'}
          </label>
          <span>一行一个链接 · 可跟空格或 @ 指定分支/版本 · 已解析 {batchItems.length} 个</span>
        </div>
        <div className="batch-textarea-wrap">
          <textarea
            id="batch-urls-input"
            className="batch-textarea"
            value={currentUrls}
            onChange={(e) => setUrls(e.target.value)}
            disabled={batchRunning}
            placeholder={
              batchProvider === 'git'
                ? `每行输入一个 Git 仓库链接，支持在链接后指定特定分支，例如：\nhttps://github.com/organization/repo-one.git\nhttps://github.com/organization/repo-two.git dev\nhttps://github.com/organization/repo-three.git release-4.0\ngit@github.com:organization/repo-four.git#feature-login`
                : `每行输入一个 SVN 仓库链接，支持在链接后指定修订号或分支，例如：\nhttps://svn.example.com/svn/project-a/trunk\nhttps://svn.example.com/svn/project-b/trunk 1024\nhttps://svn.example.com/svn/project-c@2048\nhttps://svn.example.com/svn/project-d/branches/v1.0`
            }
          />
        </div>
        {protocolWarning && (
          <div className="batch-alert warning">
            <AlertCircle size={15} />
            <span>{protocolWarning}</span>
          </div>
        )}
      </div>

      <div className="field-group">
        <div className="label-row">
          <label className="field-title" htmlFor="batch-target-root">本地保存根目录</label>
          <span>每个项目将自动在该根目录下创建独立文件夹</span>
        </div>
        <div className="input-with-icon">
          <FolderOpen size={16} />
          <input
            id="batch-target-root"
            value={batchTargetRoot}
            onChange={(e) => setBatchTargetRoot(e.target.value)}
            disabled={batchRunning}
            placeholder="例如：D:\workspace\my-projects"
          />
          <button onClick={browseBatchTargetRoot} title="选择根目录" disabled={batchRunning}>
            <FolderOpen size={16} />
          </button>
        </div>
      </div>

      <div className="batch-options-grid">
        <div className="field-group" style={{ marginTop: 0 }}>
          <label className="field-title" htmlFor="batch-conflict-select">目标目录已存在时</label>
          <div className="select-wrap" style={{ marginTop: 7 }}>
            <RefreshCw size={15} />
            <select
              id="batch-conflict-select"
              value={batchConflictStrategy}
              onChange={(e) => setBatchConflictStrategy(e.target.value)}
              disabled={batchRunning}
            >
              <option value="update">自动更新已有仓库 (推荐)</option>
              <option value="skip">跳过已存在的目录</option>
              <option value="error">标记错误并继续下一项</option>
            </select>
            <ChevronDown size={14} />
          </div>
        </div>

        {batchProvider === 'git' ? (
          <div className="field-group" style={{ marginTop: 0 }}>
            <div className="label-row">
              <label className="field-title" htmlFor="batch-git-branch">全局默认分支 (可选)</label>
              <button
                type="button"
                onClick={onApplyGlobalBranch}
                disabled={batchRunning || !batchGitBranch.trim()}
                style={{ fontSize: 9, color: '#a44e70', background: 'transparent', padding: 0 }}
                title="将此分支应用到下方所有未指定的项目"
              >
                应用到全部
              </button>
            </div>
            <div className="input-with-icon" style={{ marginTop: 7 }}>
              <GitBranch size={15} />
              <input
                id="batch-git-branch"
                value={batchGitBranch}
                onChange={(e) => setBatchGitBranch(e.target.value)}
                disabled={batchRunning}
                placeholder="未单独指定时使用的默认分支 (留空拉取主线)"
              />
            </div>
          </div>
        ) : (
          <div className="field-group" style={{ marginTop: 0 }}>
            <label className="field-title">SVN 选项</label>
            <div className={`mainline-option ${batchSvnMainlineOnly ? 'enabled' : ''}`} style={{ marginTop: 7, minHeight: 38, padding: '7px 9px' }}>
              <label className="toggle-line">
                <input
                  type="checkbox"
                  checked={batchSvnMainlineOnly}
                  onChange={(e) => setBatchSvnMainlineOnly(e.target.checked)}
                  disabled={batchRunning}
                />
                <span className="fake-checkbox"><Check size={12} /></span>
                <span className="mainline-copy">
                  <b>仅拉取主线 trunk</b>
                  <small>若未指定分支且链接包含 trunk 自动检出 trunk</small>
                </span>
              </label>
            </div>
          </div>
        )}
      </div>

      {batchItems.length > 0 && (
        <div className="batch-queue-container">
          <div className="batch-queue-header">
            <span>待拉取仓库清单 (共 <b>{batchItems.length}</b> 个)</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className="batch-fetch-all-btn"
                onClick={onProbeAll}
                disabled={batchRunning}
                title="读取所有仓库的可选分支、标签和修订版本"
              >
                <Search size={11} />
                读取全部可选版本
              </button>
              <span style={{ fontSize: 9, color: '#8d7888' }}>按顺序依次执行</span>
            </div>
          </div>
          <div className="batch-queue-col-headers">
            <span>#</span>
            <span>仓库名称</span>
            <span>代码版本 / 分支 (下拉选择)</span>
            <span>本地目标目录</span>
            <span style={{ textAlign: 'center' }}>状态</span>
          </div>
          <div className="batch-queue-list">
            {batchItems.map((item, index) => {
              const itemState = batchItemStatuses[item.id] || { status: 'idle', error: '' }
              const statusClass = itemState.status
              const statusLabel =
                statusClass === 'running' ? '拉取中' :
                statusClass === 'success' ? '成功' :
                statusClass === 'error' ? '失败' :
                statusClass === 'skipped' ? '跳过' : '等待'

              const repoData = batchRepoDataMap[item.url]
              const isProbing = Boolean(batchProbingMap[item.url])
              const probeErr = batchProbeErrorMap[item.url]
              const versionOptions = getRepoVersionOptions(repoData, batchProvider)

              const currentVal = itemBranchOverrides[item.id] !== undefined
                ? itemBranchOverrides[item.id]
                : (item.parsedBranch || 'default')

              return (
                <div key={item.id} className={`batch-queue-item ${statusClass}`}>
                  <span className="batch-item-index">#{index + 1}</span>
                  <span className="batch-item-name" title={item.name}>{item.name}</span>

                  <div className="batch-version-select-wrap">
                    {isProbing ? (
                      <div className="batch-branch-input-wrap" style={{ flex: 1, color: '#9a607a', fontSize: '9.5px' }}>
                        <LoaderCircle size={12} className="spin" />
                        <span>读取版本列表中...</span>
                      </div>
                    ) : (
                      <select
                        className="batch-version-select"
                        value={currentVal}
                        onChange={(e) => onItemBranchChange(item.id, e.target.value)}
                        disabled={batchRunning}
                        title={probeErr ? `读取失败: ${probeErr}` : currentVal && currentVal !== 'default' ? `已选版本：${currentVal}` : '下拉选择拉取的版本'}
                      >
                        <option value="default">
                          {batchProvider === 'git'
                            ? (repoData?.defaultBranch ? `默认主线 (${repoData.defaultBranch})` : '默认主线 (HEAD)')
                            : (repoData?.latestRevision ? `最新版本 (r${repoData.latestRevision})` : '最新版本 (HEAD)')}
                        </option>

                        {/* 如果在输入链接中指定了分支但未探测到，予以保留展示 */}
                        {item.parsedBranch && !versionOptions.some((o) => o.name === item.parsedBranch || o.id === item.parsedBranch) && (
                          <option value={item.parsedBranch}>链接指定 · {item.parsedBranch}</option>
                        )}

                        {/* Git 分支分组 */}
                        {versionOptions.some((o) => o.kind === 'branch') && (
                          <optgroup label="分支 (Branches)">
                            {versionOptions.filter((o) => o.kind === 'branch').map((opt) => (
                              <option key={opt.id} value={opt.name}>{opt.label}</option>
                            ))}
                          </optgroup>
                        )}

                        {/* Git 标签分组 */}
                        {versionOptions.some((o) => o.kind === 'tag') && (
                          <optgroup label="标签 (Tags)">
                            {versionOptions.filter((o) => o.kind === 'tag').map((opt) => (
                              <option key={opt.id} value={opt.name}>{opt.label}</option>
                            ))}
                          </optgroup>
                        )}

                        {/* SVN 子目录/标签分组 */}
                        {versionOptions.some((o) => o.kind === 'dir') && (
                          <optgroup label="目录 / 标签 (Directories / Tags)">
                            {versionOptions.filter((o) => o.kind === 'dir').map((opt) => (
                              <option key={opt.id} value={`dir:${opt.subPath}`}>{opt.label}</option>
                            ))}
                          </optgroup>
                        )}

                        {/* SVN 修订版本历史分组 */}
                        {versionOptions.some((o) => o.kind === 'rev') && (
                          <optgroup label="修订版本 (Revisions)">
                            {versionOptions.filter((o) => o.kind === 'rev').map((opt) => (
                              <option key={opt.id} value={`rev:${opt.revision}`}>{opt.label}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    )}

                    <button
                      type="button"
                      className="batch-probe-btn"
                      onClick={() => onProbeSingle(item.url)}
                      disabled={batchRunning || isProbing}
                      title={probeErr ? `读取失败: ${probeErr} (点击重试)` : repoData ? '重新读取该仓库分支与版本' : '读取该仓库的可选分支和版本'}
                    >
                      {isProbing ? <LoaderCircle size={12} className="spin" /> : probeErr ? <AlertCircle size={12} color="#c84c59" /> : <Search size={12} />}
                    </button>
                  </div>

                  <span className="batch-item-target" title={item.target}>{item.target}</span>
                  <span className={`batch-status-badge ${statusClass}`} title={itemState.error || ''}>
                    {statusClass === 'running' && <LoaderCircle size={10} className="spin" />}
                    {statusClass === 'success' && <Check size={10} />}
                    {statusClass === 'error' && <AlertCircle size={10} />}
                    {statusLabel}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="execution-note">
        <Info size={15} />
        <span>支持下拉选择版本：点击上方“读取全部可选版本”或单行搜索图标，即可从下拉框中选择要检出的分支、Tag 或修订版本。</span>
      </div>

      <div className="panel-actions">
        <button
          type="button"
          className="primary-action"
          onClick={onStart}
          disabled={batchRunning || !batchItems.length}
        >
          {batchRunning ? <LoaderCircle size={17} className="spin" /> : <Download size={17} />}
          {batchRunning ? '批量拉取中...' : `开始批量拉取 (${batchItems.length} 个)`}
        </button>

        {failedCount > 0 && (
          <button
            type="button"
            className="ghost-action"
            onClick={onRetryFailed}
            disabled={batchRunning}
            title="仅重试本次批量中失败的项目"
          >
            <RotateCcw size={15} />
            重试失败项 ({failedCount})
          </button>
        )}

        <button
          type="button"
          className="ghost-action"
          onClick={onClearUrls}
          disabled={batchRunning}
        >
          <X size={16} />
          清空链接
        </button>
      </div>
    </div>
  )
}

function BatchTaskPanel({ progress, running, cancelTask, clearLogs }) {
  const statusLabel =
    progress.status === 'success' ? '批量完成' :
    progress.status === 'error' ? '存在失败' :
    progress.status === 'cancelled' ? '已停止' :
    running ? '批量执行中' : '等待任务'

  const statusClass =
    progress.status === 'success' ? 'success' :
    progress.status === 'error' ? 'error' :
    progress.status === 'cancelled' ? 'idle' :
    running ? 'running' : 'idle'

  return (
    <div className="task-panel panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">STEP 02</p>
          <h2>批量任务进度</h2>
        </div>
        <span className={`status-pill ${statusClass}`}>
          <i />{statusLabel}
        </span>
      </div>

      <div className="progress-overview">
        <div className="progress-ring">
          <svg viewBox="0 0 42 42">
            <circle className="ring-track" cx="21" cy="21" r="17" />
            <circle
              className={`ring-value ${statusClass}`}
              cx="21"
              cy="21"
              r="17"
              pathLength="100"
              strokeDasharray={`${progress.value} 100`}
            />
          </svg>
          <strong>{Math.round(progress.value)}<small>%</small></strong>
        </div>
        <div className="progress-copy">
          <b>{progress.label}</b>
          <div className="batch-stats-row">
            <span className="batch-stats-item">总计: <b>{progress.totalCount || 0}</b></span>
            <span className="batch-stats-item success">成功: <b>{progress.successCount || 0}</b></span>
            <span className="batch-stats-item error">失败: <b>{progress.errorCount || 0}</b></span>
            <span className="batch-stats-item skipped">跳过: <b>{progress.skippedCount || 0}</b></span>
          </div>
        </div>
      </div>

      <div className="bar-track">
        <span style={{ width: `${Math.max(0, Math.min(100, progress.value))}%` }} />
      </div>

      <div className="log-heading">
        <span><Terminal size={14} />命令输出</span>
        <button onClick={clearLogs} disabled={!progress.logs.length}>清空</button>
      </div>

      <div className="terminal-output" aria-live="polite">
        {progress.logs.length ? (
          progress.logs.map((line, index) => (
            <div className={`log-line ${line.source}`} key={`${line.time}-${index}`}>
              <time>{new Date(line.time).toLocaleTimeString('zh-CN', { hour12: false })}</time>
              <span>{line.text}</span>
            </div>
          ))
        ) : (
          <div className="terminal-placeholder">
            <Terminal size={20} />
            <span>等待批量任务启动...</span>
            <small>每个仓库的拉取输出会在这里实时滚动</small>
          </div>
        )}
      </div>

      <div className="task-bottom">
        <span><Zap size={13} />批量拉取引擎就绪</span>
        {running ? (
          <button className="stop-button" onClick={cancelTask}>
            <Square size={13} />停止批量任务
          </button>
        ) : (
          <span className="shortcut-hint"><Play size={12} />开始后保持窗口打开</span>
        )}
      </div>
    </div>
  )
}

function CredentialDialog({ tab, setTab, status, form, saving, testing, testMessage, onChange, onBrowseKey, onSave, onTest, onClear, onClose }) {
  const git = form.git
  const svn = form.svn
  const gitStatus = status?.git
  const svnStatus = status?.svn
  const setSecret = (section, field, clearField, value) => {
    onChange(section, field, value)
    if (value) onChange(section, clearField, false)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving && !testing) onClose() }}>
      <section className="credential-dialog panel" role="dialog" aria-modal="true" aria-labelledby="credential-dialog-title">
        <div className="dialog-heading">
          <div>
            <p className="section-kicker">CONNECTION</p>
            <h2 id="credential-dialog-title">连接设置</h2>
          </div>
          <button className="icon-button dialog-close" onClick={onClose} disabled={saving || testing} title="关闭"><X size={18} /></button>
        </div>
        <p className="dialog-intro">没有本机凭证时，可在这里配置访问 Git / SVN 仓库所需的认证信息。</p>
        {status?.storageAvailable === false && (
          <div className="credential-alert">
            <AlertCircle size={15} />
            <span>当前系统未启用安全凭据存储，暂时无法保存密码。</span>
          </div>
        )}
        <div className="credential-tabs">
          <button className={tab === 'git' ? 'selected git-selected' : ''} onClick={() => setTab('git')} type="button">
            <GitBranch size={15} />Git
          </button>
          <button className={tab === 'svn' ? 'selected svn-selected' : ''} onClick={() => setTab('svn')} type="button">
            <Server size={15} />SVN
          </button>
        </div>
        {tab === 'git' ? (
          <div className="credential-form">
            <div className="credential-field">
              <label className="field-title">Git 认证方式</label>
              <div className="credential-mode">
                <button type="button" className={git.mode === 'https' ? 'selected' : ''} onClick={() => onChange('git', 'mode', 'https')}>
                  <Upload size={14} />
                  <span><b>HTTPS Token</b><small>适用于 HTTPS 仓库地址</small></span>
                </button>
                <button type="button" className={git.mode === 'ssh' ? 'selected' : ''} onClick={() => onChange('git', 'mode', 'ssh')}>
                  <KeyRound size={14} />
                  <span><b>SSH Key</b><small>适用于 git@ 或 SSH URL</small></span>
                </button>
              </div>
            </div>
            <div className="credential-field">
              <label className="field-title" htmlFor="git-username">用户名</label>
              <div className="input-with-icon">
                <GitBranch size={15} />
                <input id="git-username" value={git.username} onChange={(event) => onChange('git', 'username', event.target.value)} placeholder={git.mode === 'https' ? '例如：your-name' : '例如：git'} />
              </div>
            </div>
            {git.mode === 'https' ? (
              <div className="credential-field">
                <div className="credential-label-row">
                  <label className="field-title" htmlFor="git-token">密码 / 访问 Token</label>
                  <CredentialState active={gitStatus?.tokenConfigured} label="凭证" />
                </div>
                <div className="input-with-icon">
                  <LockKeyhole size={15} />
                  <input id="git-token" type="password" autoComplete="new-password" value={git.token} onChange={(event) => setSecret('git', 'token', 'clearToken', event.target.value)} placeholder={git.clearToken ? '保存后清除已配置凭证' : gitStatus?.tokenConfigured ? '已配置，留空保持不变' : '输入密码或 Personal Access Token'} />
                  <button type="button" className={`credential-clear ${git.clearToken ? 'pending' : ''}`} onClick={() => { onChange('git', 'token', ''); onChange('git', 'clearToken', true) }} disabled={!gitStatus?.tokenConfigured && !git.token && !git.clearToken} title="清除 Git 凭证"><Trash2 size={14} /></button>
                </div>
              </div>
            ) : (
              <>
                <div className="credential-field">
                  <div className="credential-label-row">
                    <label className="field-title" htmlFor="git-key-path">SSH 私钥文件</label>
                    <CredentialState active={Boolean(git.sshKeyPath)} label="路径" />
                  </div>
                  <div className="input-with-icon">
                    <KeyRound size={15} />
                    <input id="git-key-path" value={git.sshKeyPath} onChange={(event) => onChange('git', 'sshKeyPath', event.target.value)} placeholder="选择 id_rsa / id_ed25519 文件" />
                    <button type="button" onClick={onBrowseKey} title="选择 SSH 私钥"><FolderOpen size={15} /></button>
                  </div>
                </div>
                <div className="credential-field">
                  <div className="credential-label-row">
                    <label className="field-title" htmlFor="git-passphrase">私钥口令</label>
                    <CredentialState active={gitStatus?.sshPassphraseConfigured} label="口令" />
                  </div>
                  <div className="input-with-icon">
                    <LockKeyhole size={15} />
                    <input id="git-passphrase" type="password" autoComplete="new-password" value={git.sshPassphrase} onChange={(event) => setSecret('git', 'sshPassphrase', 'clearSshPassphrase', event.target.value)} placeholder={git.clearSshPassphrase ? '保存后清除已配置口令' : gitStatus?.sshPassphraseConfigured ? '已配置，留空保持不变' : '没有口令可留空'} />
                    <button type="button" className={`credential-clear ${git.clearSshPassphrase ? 'pending' : ''}`} onClick={() => { onChange('git', 'sshPassphrase', ''); onChange('git', 'clearSshPassphrase', true) }} disabled={!gitStatus?.sshPassphraseConfigured && !git.sshPassphrase && !git.clearSshPassphrase} title="清除私钥口令"><Trash2 size={14} /></button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="credential-form">
            <div className="credential-field">
              <label className="field-title" htmlFor="svn-username">SVN 用户名</label>
              <div className="input-with-icon">
                <Server size={15} />
                <input id="svn-username" value={svn.username} onChange={(event) => onChange('svn', 'username', event.target.value)} placeholder="输入 SVN 用户名" />
              </div>
            </div>
            <div className="credential-field">
              <div className="credential-label-row">
                <label className="field-title" htmlFor="svn-password">SVN 密码</label>
                <CredentialState active={svnStatus?.passwordConfigured} label="密码" />
              </div>
              <div className="input-with-icon">
                <LockKeyhole size={15} />
                <input id="svn-password" type="password" autoComplete="new-password" value={svn.password} onChange={(event) => setSecret('svn', 'password', 'clearPassword', event.target.value)} placeholder={svn.clearPassword ? '保存后清除已配置密码' : svnStatus?.passwordConfigured ? '已配置，留空保持不变' : '输入 SVN 密码'} />
                <button type="button" className={`credential-clear ${svn.clearPassword ? 'pending' : ''}`} onClick={() => { onChange('svn', 'password', ''); onChange('svn', 'clearPassword', true) }} disabled={!svnStatus?.passwordConfigured && !svn.password && !svn.clearPassword} title="清除 SVN 密码"><Trash2 size={14} /></button>
              </div>
            </div>
          </div>
        )}
        <div className="credential-security-note">
          <LockKeyhole size={15} />
          <span>凭证使用 Windows 用户数据保护加密保存，仅在本机命令执行期间使用，不会出现在任务日志中。</span>
        </div>
        <div className={`credential-test ${testMessage?.startsWith('连接成功') ? 'success' : testMessage ? 'error' : ''}`}>
          <div>
            <b>验证 {tab === 'git' ? 'Git' : 'SVN'} 凭证</b>
            <span>{testMessage || `使用当前仓库地址执行一次只读 ${tab === 'git' ? 'git ls-remote' : 'svn info'}，不会拉取代码。`}</span>
          </div>
          <button className="ghost-action" onClick={onTest} disabled={testing || saving}>
            {testing ? <LoaderCircle size={15} className="spin" /> : <CheckCircle2 size={15} />}
            测试连接
          </button>
        </div>
        <div className="dialog-actions">
          <button className="ghost-action" onClick={onClear} disabled={saving || testing}><Trash2 size={15} />清除当前凭证</button>
          <span className="dialog-hint">留空密码字段可保持原配置</span>
          <button className="primary-action" onClick={onSave} disabled={saving || testing || status?.storageAvailable === false}>
            {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
            保存凭证
          </button>
        </div>
      </section>
    </div>
  )
}

function CredentialState({ active, label }) {
  return <span className={`credential-state ${active ? 'configured' : ''}`}><i />{active ? `${label}已配置` : `${label}未配置`}</span>
}

function DirectoryBrowser({ entries, path, loading, error, selectedPath, onNavigate, onSelect, action }) {
  const verb = action === 'update' ? '更新' : '拉取'
  const noneLabel = action === 'update' ? '整个工作副本' : '整个仓库'
  const crumbs = useMemo(() => {
    const items = [{ name: '根目录', path: '' }]
    let acc = ''
    String(path || '').split('/').filter(Boolean).forEach((segment) => {
      acc = acc ? `${acc}/${segment}` : segment
      items.push({ name: segment, path: acc })
    })
    return items
  }, [path])
  const fullPath = (name) => joinBrowsePath(path, name)

  return (
    <div className="dir-browser">
      <div className="dir-crumbs">
        {crumbs.map((crumb, index) => (
          <Fragment key={crumb.path || 'root'}>
            <button className={`dir-crumb ${crumb.path === path ? 'current' : ''}`} onClick={() => { onNavigate(crumb.path); onSelect(crumb.path) }}>
              {crumb.name}
            </button>
            {index < crumbs.length - 1 && <ChevronRight size={11} />}
          </Fragment>
        ))}
      </div>
      <div className="dir-list">
        {loading ? (
          <div className="dir-loading"><LoaderCircle size={15} className="spin" />正在读取目录内容...</div>
        ) : error ? (
          <div className="dir-error"><AlertCircle size={14} />{error}<button onClick={() => onNavigate(path)}>重试</button></div>
        ) : entries.length ? (
          entries.map((entry) => (
            entry.kind === 'dir' ? (
              <div
                key={entry.name}
                className={`dir-row dir ${selectedPath === fullPath(entry.name) ? 'selected' : ''}`}
                onClick={() => onSelect(fullPath(entry.name))}
                onDoubleClick={() => onNavigate(fullPath(entry.name))}
                title="单击选择 · 双击进入"
              >
                <Folder size={15} />
                <span className="dir-name">{entry.name}</span>
                <span className="dir-radio">{selectedPath === fullPath(entry.name) ? <Check size={10} /> : ''}</span>
                <button className="dir-enter" title="进入该目录" onClick={(event) => { event.stopPropagation(); onNavigate(fullPath(entry.name)) }}>
                  <ChevronRight size={13} />
                </button>
              </div>
            ) : (
              <div key={entry.name} className="dir-row file" title="文件不支持作为拉取目标">
                <FileText size={14} />
                <span className="dir-name">{entry.name}</span>
              </div>
            )
          ))
        ) : (
          <div className="dir-empty"><FolderOpen size={15} />该目录下没有内容</div>
        )}
      </div>
      <div className="dir-status">
        <span>将{verb}：<b>{selectedPath ? selectedPath : noneLabel}</b></span>
        {selectedPath ? <button onClick={() => onSelect('')}>清除选择</button> : <small>点击目录行即可选择</small>}
      </div>
    </div>
  )
}

function RepoSummary({ repo, provider }) {
  return (
    <div className="repo-summary">
      <div className={`repo-provider ${provider}`}>
        <span>{provider === 'git' ? 'G' : 'S'}</span>
        <div>
          <b>{provider === 'git' ? 'Git 远程仓库' : 'SVN 远程仓库'}</b>
          <small>刚刚读取成功</small>
        </div>
      </div>
      <div className="repo-facts">
        {provider === 'git' ? (
          <>
            <span><GitBranch size={13} /><b>{repo.branches?.length || 0}</b> 分支</span>
            <span><GitCommitHorizontal size={13} /><b>{repo.tags?.length || 0}</b> 标签</span>
            <span><strong>{repo.defaultBranch || 'HEAD'}</strong> 默认分支</span>
          </>
        ) : (
          <>
            <span><GitCommitHorizontal size={13} /><b>r{repo.latestRevision || 'HEAD'}</b> 最新修订</span>
            <span><Server size={13} /><b>{repo.directories?.length || 0}</b> 个目录</span>
            <span><strong>{repo.revisions?.length || 0}</strong> 条记录</span>
          </>
        )}
      </div>
    </div>
  )
}

function TaskPanel({ progress, running, cancelTask, clearLogs }) {
  const statusLabel = progress.status === 'success' ? '已完成' : progress.status === 'error' ? '失败' : running ? '执行中' : '等待任务'
  const statusClass = progress.status === 'success' ? 'success' : progress.status === 'error' ? 'error' : running ? 'running' : 'idle'
  return (
    <div className="task-panel panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">STEP 02</p>
          <h2>实时任务进度</h2>
        </div>
        <span className={`status-pill ${statusClass}`}><i />{statusLabel}</span>
      </div>
      <div className="progress-overview">
        <div className="progress-ring">
          <svg viewBox="0 0 42 42">
            <circle className="ring-track" cx="21" cy="21" r="17" />
            <circle className={`ring-value ${statusClass}`} cx="21" cy="21" r="17" pathLength="100" strokeDasharray={`${progress.value} 100`} />
          </svg>
          <strong>{Math.round(progress.value)}<small>%</small></strong>
        </div>
        <div className="progress-copy">
          <b>{progress.label}</b>
          <span>{running ? '命令正在本机终端进程中执行' : progress.status === 'success' ? '工作副本已准备好使用' : '执行输出会实时显示在下方'}</span>
        </div>
      </div>
      <div className="bar-track"><span style={{ width: `${Math.max(0, Math.min(100, progress.value))}%` }} /></div>
      <div className="log-heading">
        <span><Terminal size={14} />命令输出</span>
        <button onClick={clearLogs} disabled={!progress.logs.length}>清空</button>
      </div>
      <div className="terminal-output" aria-live="polite">
        {progress.logs.length ? (
          progress.logs.map((line, index) => (
            <div className={`log-line ${line.source}`} key={`${line.time}-${index}`}>
              <time>{new Date(line.time).toLocaleTimeString('zh-CN', { hour12: false })}</time>
              <span>{line.text}</span>
            </div>
          ))
        ) : (
          <div className="terminal-placeholder">
            <Terminal size={20} />
            <span>等待任务启动...</span>
            <small>Git 和 SVN 的详细输出会在这里实时滚动</small>
          </div>
        )}
      </div>
      <div className="task-bottom">
        <span><Zap size={13} />命令行输出已连接</span>
        {running ? (
          <button className="stop-button" onClick={cancelTask}><Square size={13} />停止任务</button>
        ) : (
          <span className="shortcut-hint"><Play size={12} />开始后保持窗口打开</span>
        )}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)

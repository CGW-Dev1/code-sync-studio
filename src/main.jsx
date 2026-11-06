import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Columns2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Filter,
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
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Upload,
  X,
  Zap
} from 'lucide-react'
import './styles.css'
import logoUrl from '../assets/codesync-logo.svg'

const api = window.codeSync

const blankProgress = { value: 0, label: '准备就绪，等待开始任务', logs: [], status: 'idle' }

function formatTime(value) {
  if (!value) return '--'
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatDuration(seconds = 0) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
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
  if (!base) return child || ''
  const cleanBase = base.trim().replace(/\/+$/, '')
  if (!child) return cleanBase
  return `${cleanBase}/${child.split('/').map(encodeURIComponent).join('/')}`
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

function resolveItemVersionPayload(item, branchSelection, batchProvider, globalBranch, batchSvnMainlineOnly, repoData) {
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
  if (!val || val === 'default' || val === 'HEAD' || val.toLowerCase() === 'trunk') {
    if (batchSvnMainlineOnly) {
      if (isTrunkUrl(item.url)) {
        finalUrl = item.url
      } else {
        const trunkDir = (repoData?.directories || []).find((d) => d.toLowerCase() === 'trunk') || 'trunk'
        finalUrl = joinSvnUrl(item.url, trunkDir)
      }
    }
    return {
      finalUrl,
      payloadVersion: {
        kind: 'svn',
        revision: 'HEAD',
        sourceUrl: finalUrl,
        label: batchSvnMainlineOnly ? '主线 trunk' : '最新版本'
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
  const [url, setUrl] = useState(() => localStorage.getItem('code-sync-url') || '')
  const [target, setTarget] = useState(() => localStorage.getItem('code-sync-target') || '')
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
  const [singleElapsed, setSingleElapsed] = useState(0)
  const [localInspect, setLocalInspect] = useState(null)
  const [inspectingLocal, setInspectingLocal] = useState(false)
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
  const [batchConflictStrategy, setBatchConflictStrategy] = useState(() => localStorage.getItem('code-sync-batch-conflict') || 'update') // 'update' | 'skip' | 'error'
  const [batchGitBranch, setBatchGitBranch] = useState(() => localStorage.getItem('code-sync-batch-git-branch') || '')
  const [batchSvnMainlineOnly, setBatchSvnMainlineOnly] = useState(() => localStorage.getItem('code-sync-batch-svn-mainline') !== 'false')
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchElapsed, setBatchElapsed] = useState(0)
  const [batchItemStatuses, setBatchItemStatuses] = useState({})
  const [batchFilter, setBatchFilter] = useState('')
  const [batchViewMode, setBatchViewMode] = useState('split') // 'queue' | 'telemetry' | 'split'
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [historyFilter, setHistoryFilter] = useState('')
  const [historyProviderFilter, setHistoryProviderFilter] = useState('all') // 'all' | 'git' | 'svn'
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

  // 存储基础表单状态
  const handleSetUrl = (val) => {
    setUrl(val)
    localStorage.setItem('code-sync-url', val)
  }
  const handleSetTarget = (val) => {
    setTarget(val)
    localStorage.setItem('code-sync-target', val)
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
  const handleSetBatchConflictStrategy = (val) => {
    setBatchConflictStrategy(val)
    localStorage.setItem('code-sync-batch-conflict', val)
  }
  const handleSetBatchGitBranch = (val) => {
    setBatchGitBranch(val)
    localStorage.setItem('code-sync-batch-git-branch', val)
  }
  const handleSetBatchSvnMainlineOnly = (val) => {
    setBatchSvnMainlineOnly(val)
    localStorage.setItem('code-sync-batch-svn-mainline', String(val))
  }

  // 单次任务计时器
  useEffect(() => {
    let timer = null
    if (running) {
      setSingleElapsed(0)
      timer = setInterval(() => setSingleElapsed((sec) => sec + 1), 1000)
    }
    return () => { if (timer) clearInterval(timer) }
  }, [running])

  // 批量任务计时器
  useEffect(() => {
    let timer = null
    if (batchRunning) {
      setBatchElapsed(0)
      timer = setInterval(() => setBatchElapsed((sec) => sec + 1), 1000)
    }
    return () => { if (timer) clearInterval(timer) }
  }, [batchRunning])

  // 本地工作副本智能检测（更新代码模式）
  useEffect(() => {
    if (!api?.inspectLocal || action !== 'update' || !target.trim()) {
      setLocalInspect(null)
      return
    }
    let cancelled = false
    setInspectingLocal(true)
    const timer = setTimeout(() => {
      api.inspectLocal({ target: target.trim() })
        .then((info) => {
          if (cancelled) return
          setLocalInspect(info)
          if (info.provider && info.provider !== provider) {
            setProvider(info.provider)
          }
          if (info.url && !url.trim()) {
            handleSetUrl(info.url)
          }
        })
        .catch((err) => {
          if (cancelled) return
          setLocalInspect({ error: err.message || '未检测到有效工作副本' })
        })
        .finally(() => {
          if (!cancelled) setInspectingLocal(false)
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [action, target])

  const activeBatchUrls = batchProvider === 'git' ? batchGitUrls : batchSvnUrls

  const batchItems = useMemo(() => {
    return parseUrlList(activeBatchUrls, batchProvider, batchTargetRoot)
  }, [activeBatchUrls, batchProvider, batchTargetRoot])

  const filteredBatchItems = useMemo(() => {
    if (!batchFilter.trim()) return batchItems
    const q = batchFilter.toLowerCase().trim()
    return batchItems.filter((item) => item.name.toLowerCase().includes(q) || item.url.toLowerCase().includes(q) || (item.parsedBranch && item.parsedBranch.toLowerCase().includes(q)))
  }, [batchItems, batchFilter])

  const filteredRecent = useMemo(() => {
    return recent.filter((entry) => {
      if (historyProviderFilter !== 'all' && entry.provider !== historyProviderFilter) return false
      if (!historyFilter.trim()) return true
      const q = historyFilter.toLowerCase().trim()
      return (
        (entry.target && entry.target.toLowerCase().includes(q)) ||
        (entry.url && entry.url.toLowerCase().includes(q)) ||
        (entry.version && String(entry.version).toLowerCase().includes(q)) ||
        (entry.provider && entry.provider.toLowerCase().includes(q))
      )
    })
  }, [recent, historyFilter, historyProviderFilter])

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
    let idx = 0
    const concurrency = 2
    const total = toProbe.length
    const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
      while (idx < total) {
        const cur = toProbe[idx++]
        await probeSingleBatchRepo(cur.url)
      }
    })
    await Promise.all(workers)
    showToast('仓库版本读取完毕')
  }

  useEffect(() => {
    setBatchRepoDataMap({})
    setBatchProbingMap({})
    setBatchProbeErrorMap({})
    setItemBranchOverrides({})
  }, [batchProvider])

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
    if (selected) handleSetTarget(selected)
  }

  async function browseBatchTargetRoot() {
    if (!api) return showToast('请在桌面版中使用目录选择')
    const selected = await api.choosePath()
    if (selected) {
      handleSetBatchTargetRoot(selected)
    }
  }

  async function openLocalPath(folderPath) {
    if (!folderPath) return
    if (api?.openPath) {
      const ok = await api.openPath(folderPath)
      if (!ok) showToast('无法打开目录，请确认文件夹是否存在')
    } else {
      showToast('桌面端支持一键打开本地文件夹')
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
    const repoBaseUrl = repo?.url || url
    const payloadVersion = provider === 'svn'
      ? {
          ...selectedVersion,
          sourceUrl: action === 'update'
            ? (selectedPath ? joinSvnUrl(repoBaseUrl, selectedPath) : (selectedVersion.sourceUrl || url))
            : (svnMainlineOnly ? svnMainlineUrl : (selectedPath ? joinSvnUrl(repoBaseUrl, selectedPath) : (selectedVersion.sourceUrl || url))),
          revision: selectedVersion.revision || 'HEAD',
          ...(action === 'pull' && svnMainlineOnly
            ? { kind: 'path', name: 'trunk', label: `主线 trunk · r${selectedVersion.revision || 'HEAD'}` }
            : selectedPath
              ? { kind: 'path', name: selectedPath, label: `目录 ${selectedPath} · r${selectedVersion.revision || 'HEAD'}` }
              : {})
        }
      : { ...selectedVersion, name: selectedVersion.name && selectedVersion.name !== 'HEAD' ? selectedVersion.name : '' }
    setRunning(true)
    setProgress({ ...blankProgress, status: 'running', label: action === 'pull' ? '正在启动拉取任务...' : '正在启动更新任务...' })
    try {
      await api.runTask({ provider, action, url: provider === 'svn' ? (payloadVersion.sourceUrl || url) : url, target, version: payloadVersion, path: selectedPath })
      const entry = {
        id: Date.now(),
        provider,
        action,
        version: payloadVersion.label || payloadVersion.name || 'HEAD',
        target,
        url: provider === 'svn' ? (payloadVersion.sourceUrl || url) : url,
        time: new Date().toISOString(),
        ok: true
      }
      const next = [entry, ...recent.filter((item) => item.target !== target)].slice(0, 10)
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
    if (batchViewMode === 'queue') setBatchViewMode('split')

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

      const repoData = batchRepoDataMap[item.url]
      const { finalUrl, payloadVersion } = resolveItemVersionPayload(
        item,
        branchSelection,
        batchProvider,
        batchGitBranch,
        batchSvnMainlineOnly,
        repoData
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
          url: finalUrl,
          time: new Date().toISOString(),
          ok: true
        }
        setRecent((currentRecent) => {
          const next = [entry, ...currentRecent.filter((r) => r.target !== item.target)].slice(0, 10)
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

  // 运行队列中的单个项目
  async function runSingleBatchItem(targetItem) {
    if (batchRunning || running) return
    if (!batchTargetRoot.trim()) return showToast('请先选择本地保存根目录')
    if (!api) return showToast('任务执行需要在桌面版中运行')

    showToast(`正在单独执行：${targetItem.name}`)
    setBatchItemStatuses((prev) => ({ ...prev, [targetItem.id]: { status: 'running', error: '', action: 'pull' } }))

    let pathInfo = { exists: false, isDirectory: false, empty: true, hasGit: false, hasSvn: false }
    try {
      if (api.checkPath) pathInfo = await api.checkPath(targetItem.target)
    } catch {}

    let taskAction = 'pull'
    if (pathInfo.exists && !pathInfo.empty) {
      const canUpdate = (batchProvider === 'git' && pathInfo.hasGit) || (batchProvider === 'svn' && pathInfo.hasSvn)
      if (canUpdate) taskAction = 'update'
    }

    const branchSelection = itemBranchOverrides[targetItem.id] !== undefined
      ? itemBranchOverrides[targetItem.id]
      : targetItem.parsedBranch

    const repoData = batchRepoDataMap[targetItem.url]
    const { finalUrl, payloadVersion } = resolveItemVersionPayload(
      targetItem,
      branchSelection,
      batchProvider,
      batchGitBranch,
      batchSvnMainlineOnly,
      repoData
    )

    try {
      await api.runTask({
        provider: batchProvider,
        action: taskAction,
        url: finalUrl,
        target: targetItem.target,
        version: payloadVersion,
        path: ''
      })
      setBatchItemStatuses((prev) => ({ ...prev, [targetItem.id]: { status: 'success', error: '', action: taskAction } }))
      showToast(`${targetItem.name} ${taskAction === 'pull' ? '拉取' : '更新'}成功`)
    } catch (err) {
      setBatchItemStatuses((prev) => ({ ...prev, [targetItem.id]: { status: 'error', error: appError(err), action: taskAction } }))
      showToast(`${targetItem.name} 失败: ${appError(err)}`)
    }
  }

  // 从批量列表中移除单个项目
  function handleRemoveBatchItem(itemToRemove) {
    const current = batchProvider === 'git' ? batchGitUrls : batchSvnUrls
    const lines = current.split(/\r?\n/)
    const nextLines = lines.filter((l) => {
      const parsed = parseSingleLine(l, batchProvider)
      return parsed?.url !== itemToRemove.url
    })
    const updated = nextLines.join('\n')
    if (batchProvider === 'git') handleSetBatchGitUrls(updated)
    else handleSetBatchSvnUrls(updated)
    showToast(`已移除 ${itemToRemove.name}`)
  }

  // 整理去重批量列表
  function handleCleanBatchUrls() {
    const current = batchProvider === 'git' ? batchGitUrls : batchSvnUrls
    const lines = current.split(/\r?\n/)
    const seen = new Set()
    const cleaned = []
    lines.forEach((l) => {
      const trimmed = l.trim()
      if (!trimmed || trimmed.startsWith('#')) return
      if (!seen.has(trimmed)) {
        seen.add(trimmed)
        cleaned.push(trimmed)
      }
    })
    const updated = cleaned.join('\n')
    if (batchProvider === 'git') handleSetBatchGitUrls(updated)
    else handleSetBatchSvnUrls(updated)
    showToast(`已整理去重，当前保留 ${cleaned.length} 条链接`)
  }

  // 插入样例链接
  function handleInsertSamples() {
    if (batchProvider === 'git') {
      const samples = [
        'https://github.com/torvalds/linux.git',
        'https://github.com/facebook/react.git main',
        'https://github.com/vitejs/vite.git#main'
      ].join('\n')
      handleSetBatchGitUrls(samples)
    } else {
      const samples = [
        'https://svn.apache.org/repos/asf/subversion/trunk',
        'https://svn.example.com/repos/project-a/trunk 1024'
      ].join('\n')
      handleSetBatchSvnUrls(samples)
    }
    showToast('已载入测试样例链接')
  }

  // 从本地文件导入文本
  async function handleImportUrlsFromFile() {
    if (!api?.chooseFile) return showToast('请在桌面端中使用文件选择')
    const file = await api.chooseFile()
    if (!file) return
    showToast(`已选择文件：${file}`)
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
    handleSetTarget(entry.target)
    if (entry.url) handleSetUrl(entry.url)
    showToast(`已载入任务：${entry.target}`)
  }

  function removeRecent(id) {
    const next = recent.filter((r) => r.id !== id)
    setRecent(next)
    localStorage.setItem('code-sync-recent', JSON.stringify(next))
    showToast('已删除该条记录')
  }

  const gitReady = toolStatus?.git?.installed !== false
  const svnReady = toolStatus?.svn?.installed !== false

  return (
    <div className="app-shell">
      {/* 侧边智能战控导航轨 */}
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark" title="CodeSync Studio · 代码同步工作台">
            <img src={logoUrl} alt="CodeSync Studio" />
          </div>
          <span className="brand-badge">PRO v1.3</span>
        </div>

        <nav className="side-nav">
          <button
            className={`side-nav-item ${mode === 'single' ? 'active' : ''}`}
            onClick={() => setMode('single')}
            title="单仓代码同步与版本更新"
          >
            <HardDriveDownload size={19} />
            <span>单仓</span>
          </button>
          <button
            className={`side-nav-item ${mode === 'batch' ? 'active' : ''}`}
            onClick={() => setMode('batch')}
            title="多仓批量拉取引擎"
          >
            <Layers size={19} />
            <span>批量</span>
          </button>
          <button
            className={`side-nav-item ${mode === 'history' ? 'active' : ''}`}
            onClick={() => setMode('history')}
            title="历史任务与同步记录"
          >
            <History size={19} />
            <span>记录</span>
            {recent.length > 0 && <b>{recent.length}</b>}
          </button>
        </nav>

        <div className="sidebar-tools-group">
          <div className={`tool-badge-pill ${gitReady ? 'online' : 'offline'}`} title={`Git ${toolStatus?.git?.version || '检测中'}`}>
            <i />
            <span>Git</span>
          </div>
          <div className={`tool-badge-pill ${svnReady ? 'online' : 'offline'}`} title={`SVN ${toolStatus?.svn?.version || '检测中'}`}>
            <i />
            <span>SVN</span>
          </div>
        </div>

        <div className="sidebar-footer">
          <button
            className="side-nav-item"
            onClick={openCredentialSettings}
            disabled={credentialLoading}
            title="凭据与网络连接设置"
          >
            <Settings2 size={19} />
            <span>设置</span>
          </button>
          <div className="profile" title="CodeSync Studio Console">CS</div>
        </div>
      </aside>

      {/* 主工作台画卷 */}
      <main className="main-area">
        {/* 顶部指挥栏 */}
        <header className="topbar">
          <div className="topbar-title">
            <div className="cockpit-id">
              <i />
              SYS // WORKSPACE
            </div>
            <ChevronRight size={14} color="#64748b" />
            <strong>
              {mode === 'single'
                ? '单仓代码同步与版本更新'
                : mode === 'batch'
                ? '多仓批量队列拉取引擎'
                : '任务执行与同步记录'}
            </strong>
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
              <span>批量引擎</span>
            </button>
            <button
              type="button"
              className={`mode-tab-btn ${mode === 'history' ? 'active' : ''}`}
              onClick={() => setMode('history')}
            >
              <History size={13} />
              <span>同步记录</span>
            </button>
          </div>
          <div className="topbar-right">
            <span className="runtime-badge"><span className="pulse" /> 本机进程执行</span>
            <span className="dpapi-badge" title="凭据受 Windows DPAPI 加密保护"><LockKeyhole size={11} /> 安全存储</span>
            <button className="icon-button" title="使用说明与帮助" onClick={() => showToast('Git 与 SVN 调用系统 PATH 本机引擎，安全轻量无需上传数据')}>
              <CircleHelp size={16} />
            </button>
          </div>
        </header>

        <div className="page-content">
          <section className="page-intro">
            <div className="intro-title-group">
              <span className="intro-kicker">
                <GitCommitHorizontal size={13} />
                {mode === 'single'
                  ? 'SYS.SINGLE // 单仓工作台'
                  : mode === 'batch'
                  ? 'SYS.BATCH // 多仓调度引擎'
                  : 'SYS.HISTORY // 任务执行记录'}
              </span>
              <span className="intro-heading">
                {mode === 'single'
                  ? '单仓代码拉取与版本更新'
                  : mode === 'batch'
                  ? '多仓批量队列调度'
                  : '历史同步任务归档'}
              </span>
              <span className="intro-divider">/</span>
              <span className="intro-subtext">
                {mode === 'single'
                  ? '支持一键克隆、切换分支/标签更新与按需子目录检出'
                  : mode === 'batch'
                  ? '多仓库并发队列调度，支持智能自动更新与独立分支选择'
                  : '集中检索所有已执行任务，支持一键重载配置或定位本地目录'}
              </span>
            </div>
            <div className="intro-meta-badge">
              <span className="pulse" />
              <strong>{mode === 'history' ? `${recent.length} 条记录` : 'CLI 引擎就绪'}</strong>
              <small>
                {mode === 'single'
                  ? 'GIT / SVN 直连'
                  : mode === 'batch'
                  ? `已解析 ${batchItems.length} 个项目`
                  : '本地持久化存储'}
              </small>
            </div>
          </section>

          {mode === 'single' ? (
            <section className="sync-layout">
              <div className="sync-panel panel">
                <div className="panel-heading">
                  <div>
                    <p className="section-kicker">// STEP 01 CONFIGURATION</p>
                    <h2>配置同步任务</h2>
                  </div>
                  <span className="secure-label"><Check size={12} /> 本机直连</span>
                </div>
                <div className="sync-panel-content">
                <div className="field-group">
                  <label className="field-title">版本控制引擎</label>
                  <div className="segmented-control">
                    <button className={provider === 'git' ? 'selected git-selected' : ''} onClick={() => setProvider('git')}>
                      <GitBranch size={16} /> Git 仓库
                    </button>
                    <button className={provider === 'svn' ? 'selected svn-selected' : ''} onClick={() => setProvider('svn')}>
                      <Server size={16} /> SVN 仓库
                    </button>
                  </div>
                </div>
                <div className="field-group">
                  <label className="field-title">任务类型</label>
                  <div className="action-switch">
                    <button className={action === 'pull' ? 'selected' : ''} onClick={() => setAction('pull')}>
                      <ArrowDownToLine size={16} />
                      <span><b>拉取新代码 (Clone)</b><small>从远程克隆到全新本地目录</small></span>
                    </button>
                    <button className={action === 'update' ? 'selected' : ''} onClick={() => setAction('update')}>
                      <RefreshCw size={16} />
                      <span><b>更新代码 (Pull / Update)</b><small>更新已有本地工作副本代码</small></span>
                    </button>
                  </div>
                </div>
                <div className="field-group">
                  <div className="label-row">
                    <label className="field-title" htmlFor="repo-url">远程仓库地址</label>
                    <span>{action === 'update' ? '更新已有目录可选填' : '支持 HTTPS / SSH / SVN'}</span>
                  </div>
                  <div className="input-with-icon">
                    <Upload size={15} />
                    <input
                      id="repo-url"
                      value={url}
                      onChange={(event) => handleSetUrl(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') probe() }}
                      placeholder={provider === 'git' ? '例如：https://github.com/organization/repo.git' : '例如：https://svn.example.com/svn/project/trunk'}
                    />
                    <button className={probing ? 'loading-button' : ''} onClick={probe} title="查看远程分支与版本" disabled={probing || !url.trim()}>
                      {probing ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}
                    </button>
                  </div>
                  {probeError && <div className="field-error"><AlertCircle size={14} />{probeError}</div>}
                </div>
                <div className="repo-discovery">
                  {repo ? <RepoSummary repo={repo} provider={provider} /> : (
                    <div className="discovery-empty">
                      <Search size={13} />
                      <span>输入仓库地址后点击右侧放大镜可预检分支与版本，或留空直接拉取默认分支 (HEAD)</span>
                    </div>
                  )}
                </div>
                {versions.length > 0 && (
                <div className="field-group">
                  <div className="label-row">
                    <label className="field-title" htmlFor="version-select">目标分支 / 修订版本</label>
                    <span>{versions.length} 个可选版本</span>
                  </div>
                  <div className="select-wrap">
                    <GitCommitHorizontal size={15} />
                    <select
                      id="version-select"
                      value={versionId}
                      onChange={(event) => setVersionId(event.target.value)}
                    >
                      {versions.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}{item.hash ? `  ·  ${shortHash(item.hash)}` : ''}
                          </option>
                      ))}
                    </select>
                    <ChevronDown size={14} />
                  </div>
                </div>
                )}
                {(repo || (provider === 'svn' && action === 'pull')) && (
                  <div className="advanced-options-wrapper">
                    <button
                      type="button"
                      className="advanced-toggle-btn"
                      onClick={() => setShowAdvanced(!showAdvanced)}
                    >
                      <SlidersHorizontal size={13} />
                      <span>高级选项 {selectedPath ? `(已选子目录: ${selectedPath})` : svnMainlineOnly ? '(仅主线 trunk)' : '(子目录检出 / 主线策略)'}</span>
                      <ChevronDown size={13} style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }} />
                    </button>
                    {showAdvanced && (
                      <div className="advanced-options-content">
                        {repo && (
                          <div className="field-group browse-group" style={{ marginTop: 8 }}>
                            <div className="label-row">
                              <label className="field-title">子目录按需检出 (Sparse Checkout)</label>
                              <span>{selectedPath ? `已选子目录: ${selectedPath}` : '未选择，默认同步整个仓库'}</span>
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
                          <div className={`mainline-option ${svnMainlineOnly ? 'enabled' : ''}`} style={{ marginTop: 8 }}>
                            <label className="toggle-line">
                              <input
                                type="checkbox"
                                checked={svnMainlineOnly}
                                onChange={(event) => { setSvnMainlineOnly(event.target.checked); if (event.target.checked) setSelectedPath('') }}
                                disabled={!url.trim()}
                              />
                              <span className="fake-checkbox"><Check size={12} /></span>
                              <span className="mainline-copy">
                                <b>仅拉取主线 trunk</b>
                                <small>自动定位并仅检出 <code>trunk</code>，节省磁盘空间</small>
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
                      </div>
                    )}
                  </div>
                )}
                <div className="field-group">
                  <div className="label-row">
                    <label className="field-title" htmlFor="target-path">本地工作目录</label>
                    <span>{action === 'pull' ? '选择空目录或输入新路径' : '选择已有代码工作副本目录'}</span>
                  </div>
                  <div className="input-with-icon">
                    <FolderOpen size={15} />
                    <input
                      id="target-path"
                      value={target}
                      onChange={(event) => handleSetTarget(event.target.value)}
                      placeholder={action === 'pull' ? '例如：D:\\workspace\\project-name' : '例如：D:\\workspace\\existing-project'}
                    />
                    <button onClick={browseTarget} title="浏览选择文件夹"><FolderOpen size={15} /></button>
                  </div>

                  {/* 本地目录检测反馈卡片 */}
                  {action === 'update' && target.trim() && (
                    <div className="local-inspect-card">
                      <div className="local-inspect-title">
                        <span>{inspectingLocal ? '正在分析本地仓库...' : localInspect?.provider ? `已识别有效 ${localInspect.provider.toUpperCase()} 工作副本` : '工作目录状态'}</span>
                        {localInspect?.root && <button type="button" onClick={() => openLocalPath(localInspect.root)} style={{ color: 'var(--cyan-primary)', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' }}><ExternalLink size={11} />打开目录</button>}
                      </div>
                      {localInspect?.error ? (
                        <div style={{ color: 'var(--crimson-text)', fontSize: '11px' }}>{localInspect.error}</div>
                      ) : localInspect?.provider ? (
                        <div className="local-inspect-details">
                          {localInspect.branch && <span>当前分支: <b>{localInspect.branch}</b></span>}
                          {localInspect.revision && <span>当前版本: <b>r{localInspect.revision}</b></span>}
                          {localInspect.url && <span title={localInspect.url}>远端: <b>{localInspect.url}</b></span>}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
                <div className="execution-note">
                  <Info size={14} />
                  <span>认证调用本机 Git Credential Manager 或系统 SSH 秘钥与 SVN 配置，全流程本地执行，不向任何第三方云端传输。</span>
                </div>
                </div>
                <div className="panel-actions">
                  <button className="primary-action" onClick={runTask} disabled={running}>
                    {running ? <LoaderCircle size={16} className="spin" /> : action === 'pull' ? <Download size={16} /> : <RefreshCw size={16} />}
                    {running ? '任务正在执行...' : action === 'pull' ? '开始拉取代码' : '开始更新代码'}
                  </button>
                  <button
                    className="ghost-action"
                    onClick={() => {
                      handleSetUrl('')
                      setRepo(null)
                      setSvnScope(null)
                      setSvnScopeError('')
                      setSvnMainlineOnly(false)
                      setSvnMainlinePath('')
                      setProbeError('')
                      setVersionId('default')
                      setBrowseEntries([])
                      setBrowsePath('')
                      setSelectedPath('')
                    }}
                    disabled={running}
                  >
                    <X size={15} />重置
                  </button>
                </div>
              </div>

              <TaskPanel
                progress={progress}
                running={running}
                elapsedSeconds={singleElapsed}
                targetPath={target}
                onOpenPath={() => openLocalPath(target)}
                cancelTask={cancelTask}
                clearLogs={() => setProgress((current) => ({ ...current, logs: [] }))}
              />
            </section>
          ) : mode === 'batch' ? (
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
                setBatchConflictStrategy={handleSetBatchConflictStrategy}
                batchGitBranch={batchGitBranch}
                setBatchGitBranch={handleSetBatchGitBranch}
                batchSvnMainlineOnly={batchSvnMainlineOnly}
                setBatchSvnMainlineOnly={handleSetBatchSvnMainlineOnly}
                batchItems={batchItems}
                batchItemStatuses={batchItemStatuses}
                onApplyGlobalBranch={handleApplyGlobalBranch}
                batchRunning={batchRunning}
                protocolWarning={protocolWarning}
                onStart={() => runBatchSync(false)}
                onRetryFailed={() => runBatchSync(true)}
                onCleanUrls={handleCleanBatchUrls}
                onInsertSamples={handleInsertSamples}
                onClearUrls={clearBatchUrls}
              />

              <BatchTaskPanel
                progress={batchProgress}
                running={batchRunning}
                elapsedSeconds={batchElapsed}
                cancelTask={cancelBatchSync}
                clearLogs={() => setBatchProgress((current) => ({ ...current, logs: [] }))}
                batchItems={batchItems}
                filteredBatchItems={filteredBatchItems}
                batchFilter={batchFilter}
                setBatchFilter={setBatchFilter}
                batchItemStatuses={batchItemStatuses}
                itemBranchOverrides={itemBranchOverrides}
                onItemBranchChange={handleItemBranchChange}
                batchRepoDataMap={batchRepoDataMap}
                batchProbingMap={batchProbingMap}
                batchProbeErrorMap={batchProbeErrorMap}
                onProbeSingle={probeSingleBatchRepo}
                onProbeAll={probeAllBatchRepos}
                batchProvider={batchProvider}
                onRunSingleItem={runSingleBatchItem}
                onRemoveItem={handleRemoveBatchItem}
                onOpenFolder={openLocalPath}
                batchViewMode={batchViewMode}
                setBatchViewMode={setBatchViewMode}
              />
            </section>
          ) : (
            <section className="history-layout">
              <div className="history-panel panel">
                <div className="history-toolbar">
                  <div className="history-search-wrap">
                    <Search size={14} color="#64748b" />
                    <input
                      className="history-search-input"
                      placeholder="过滤历史任务 (仓库地址 / 目标目录 / 分支 / 关键字)..."
                      value={historyFilter}
                      onChange={(e) => setHistoryFilter(e.target.value)}
                    />
                    {historyFilter && (
                      <button type="button" className="clear-filter-btn" onClick={() => setHistoryFilter('')} title="清除过滤">
                        <X size={12} />
                      </button>
                    )}
                  </div>

                  <div className="history-filter-pills">
                    <button
                      type="button"
                      className={`history-filter-pill ${historyProviderFilter === 'all' ? 'active' : ''}`}
                      onClick={() => setHistoryProviderFilter('all')}
                    >
                      全部 ({recent.length})
                    </button>
                    <button
                      type="button"
                      className={`history-filter-pill ${historyProviderFilter === 'git' ? 'active' : ''}`}
                      onClick={() => setHistoryProviderFilter('git')}
                    >
                      <GitBranch size={12} /> Git ({recent.filter((r) => r.provider === 'git').length})
                    </button>
                    <button
                      type="button"
                      className={`history-filter-pill ${historyProviderFilter === 'svn' ? 'active' : ''}`}
                      onClick={() => setHistoryProviderFilter('svn')}
                    >
                      <Server size={12} /> SVN ({recent.filter((r) => r.provider === 'svn').length})
                    </button>
                  </div>

                  <button
                    type="button"
                    className="history-clear-btn"
                    onClick={() => {
                      if (!recent.length) return
                      setRecent([])
                      localStorage.removeItem('code-sync-recent')
                      showToast('已清空全部历史任务记录')
                    }}
                    disabled={!recent.length}
                    title="清空当前所有历史任务归档"
                  >
                    <Trash2 size={13} />
                    <span>清空记录</span>
                  </button>
                </div>

                <div className="history-table-container">
                  <div className="history-table-header">
                    <span>#</span>
                    <span>引擎</span>
                    <span>操作</span>
                    <span>远程仓库地址</span>
                    <span>分支 / 修订版</span>
                    <span>本地工作目录</span>
                    <span>执行时间</span>
                    <span style={{ textAlign: 'center' }}>操作</span>
                  </div>

                  <div className="history-table-body">
                    {filteredRecent.length ? (
                      filteredRecent.map((entry, index) => (
                        <div className="history-table-row" key={entry.id}>
                          <span className="history-col-index">#{index + 1}</span>
                          <span>
                            <span className={`provider-badge ${entry.provider}`}>
                              <span>{entry.provider === 'git' ? 'G' : 'S'}</span>
                              {entry.provider.toUpperCase()}
                            </span>
                          </span>
                          <span>
                            <span className={`action-pill ${entry.action}`}>
                              {entry.action === 'pull' ? '克隆' : '更新'}
                            </span>
                          </span>
                          <span className="history-col-url" title={entry.url || '未记录地址'}>
                            {entry.url || '-'}
                          </span>
                          <span>
                            <span className="history-version-badge" title={entry.version}>
                              <GitCommitHorizontal size={11} />
                              {entry.version || 'HEAD'}
                            </span>
                          </span>
                          <span
                            className="history-col-path"
                            title={`点击在系统资源管理器中打开: ${entry.target}`}
                            onClick={() => openLocalPath(entry.target)}
                          >
                            {entry.target}
                          </span>
                          <span className="history-col-time">
                            <Clock3 size={11} />
                            {formatTime(entry.time)}
                          </span>
                          <div className="history-col-actions">
                            <button
                              type="button"
                              className="history-action-btn"
                              onClick={() => loadRecent(entry)}
                              title="重载此配置并返回单仓工作台"
                            >
                              <RotateCcw size={13} />
                            </button>
                            <button
                              type="button"
                              className="history-action-btn"
                              onClick={() => openLocalPath(entry.target)}
                              title="在文件管理器中打开"
                            >
                              <FolderOpen size={13} />
                            </button>
                            <button
                              type="button"
                              className="history-action-btn danger"
                              onClick={() => removeRecent(entry.id)}
                              title="删除此记录"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="history-empty">
                        <History size={36} />
                        <h3>{recent.length ? '未找到符合条件的任务记录' : '暂无历史同步记录'}</h3>
                        <p>
                          {recent.length
                            ? '请尝试更换搜索关键字或清除过滤器。'
                            : '在单仓模式或多仓批量模式成功执行拉取/更新任务后，任务参数与执行结果将自动归档在此。'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          <footer className="page-footer">
            <span>CODESYNC STUDIO // DESKTOP EDITION 1.3.1</span>
            <span>核心状态：GIT CLI READY · SVN CLI READY · LOCAL ENCRYPTION ACTIVE</span>
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
  onApplyGlobalBranch,
  batchRunning,
  protocolWarning,
  onStart,
  onRetryFailed,
  onCleanUrls,
  onInsertSamples,
  onClearUrls
}) {
  const currentUrls = batchProvider === 'git' ? batchGitUrls : batchSvnUrls
  const setUrls = batchProvider === 'git' ? setBatchGitUrls : setBatchSvnUrls
  const failedCount = batchItems.filter((item) => batchItemStatuses[item.id]?.status === 'error').length

  return (
    <div className="sync-panel panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">// STEP 01 CONFIGURATION</p>
          <h2>配置批量任务队列</h2>
        </div>
        <span className="secure-label"><Check size={12} /> 独立隔离调度</span>
      </div>

      <div className="sync-panel-content">
        <div className="field-group">
          <label className="field-title">版本控制引擎 (Git 与 SVN 独立隔离)</label>
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
              {batchProvider === 'git' ? 'Git 仓库地址列表' : 'SVN 仓库地址列表'}
            </label>
            <span>一行一个仓库 · 已解析 {batchItems.length} 项</span>
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
                  ? "每行输入一个 Git 仓库链接，可在链接后指定分支，例如：\nhttps://github.com/organization/repo-one.git\nhttps://github.com/organization/repo-two.git dev\nhttps://github.com/organization/repo-three.git#release-4.0"
                  : "每行输入一个 SVN 仓库链接，可在链接后指定分支或修订号，例如：\nhttps://svn.example.com/svn/project-a/trunk\nhttps://svn.example.com/svn/project-b/trunk 1024\nhttps://svn.example.com/svn/project-c@2048"
              }
            />
          </div>
          <div className="batch-textarea-toolbar">
            <div className="batch-textarea-actions">
              <button type="button" className="batch-text-btn" onClick={onInsertSamples} disabled={batchRunning} title="插入测试样例链接"><Sparkles size={11} />样例链接</button>
              <button type="button" className="batch-text-btn" onClick={onCleanUrls} disabled={batchRunning || !currentUrls.trim()} title="去除空行与重复链接"><RefreshCw size={11} />整理去重</button>
            </div>
            <button type="button" className="batch-text-btn" onClick={onClearUrls} disabled={batchRunning || !currentUrls.trim()} style={{ color: 'var(--crimson-text)' }} title="清空全部输入"><Trash2 size={11} />清空</button>
          </div>
          {protocolWarning && (
            <div className="batch-alert warning">
              <AlertCircle size={14} />
              <span>{protocolWarning}</span>
            </div>
          )}
        </div>

        <div className="field-group">
          <div className="label-row">
            <label className="field-title" htmlFor="batch-target-root">本地保存根目录</label>
            <span>每个项目将自动在该根目录下创建独立子目录</span>
          </div>
          <div className="input-with-icon">
            <FolderOpen size={15} />
            <input
              id="batch-target-root"
              value={batchTargetRoot}
              onChange={(e) => setBatchTargetRoot(e.target.value)}
              disabled={batchRunning}
              placeholder="例如：D:\\workspace\\my-projects"
            />
            <button onClick={browseBatchTargetRoot} title="浏览选择根目录" disabled={batchRunning}>
              <FolderOpen size={15} />
            </button>
          </div>
        </div>

        <div className="batch-options-grid">
          <div className="field-group" style={{ marginTop: 0 }}>
            <label className="field-title" htmlFor="batch-conflict-select">目标目录已存在策略</label>
            <div className="select-wrap" style={{ marginTop: 7 }}>
              <RefreshCw size={14} />
              <select
                id="batch-conflict-select"
                value={batchConflictStrategy}
                onChange={(e) => setBatchConflictStrategy(e.target.value)}
                disabled={batchRunning}
              >
                <option value="update">自动更新已有仓库 (智能增量同步)</option>
                <option value="skip">跳过已存在的目录 (不覆盖)</option>
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
                  style={{ fontSize: 11, color: 'var(--cyan-primary)', background: 'transparent', padding: 0 }}
                  title="将此分支应用到右侧所有未指定分支的项目"
                >
                  应用到全部
                </button>
              </div>
              <div className="input-with-icon" style={{ marginTop: 7 }}>
                <GitBranch size={14} />
                <input
                  id="batch-git-branch"
                  value={batchGitBranch}
                  onChange={(e) => setBatchGitBranch(e.target.value)}
                  disabled={batchRunning}
                  placeholder="统一默认拉取分支 (留空拉取主线)"
                />
              </div>
            </div>
          ) : (
            <div className="field-group" style={{ marginTop: 0 }}>
              <label className="field-title">SVN 主线策略</label>
              <div className={`mainline-option ${batchSvnMainlineOnly ? 'enabled' : ''}`} style={{ marginTop: 7, minHeight: 42, padding: '8px 12px' }}>
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
                    <small>若未指定分支且链接包含 trunk 自动仅检出 trunk</small>
                  </span>
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="execution-note">
          <Info size={14} />
          <span>在右侧可直接查看解析清单，支持独立下拉选择分支、批量预检及单独执行。</span>
        </div>
      </div>

      <div className="panel-actions">
        <button
          type="button"
          className="primary-action"
          onClick={onStart}
          disabled={batchRunning || !batchItems.length}
        >
          {batchRunning ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}
          {batchRunning ? '批量任务执行中...' : `开始批量拉取 (${batchItems.length} 个项目)`}
        </button>

        {failedCount > 0 && (
          <button
            type="button"
            className="ghost-action"
            onClick={onRetryFailed}
            disabled={batchRunning}
            title="仅重试本次批量失败的项目"
          >
            <RotateCcw size={14} />
            重试失败项 ({failedCount})
          </button>
        )}
      </div>
    </div>
  )
}

function BatchTaskPanel({
  progress,
  running,
  elapsedSeconds,
  cancelTask,
  clearLogs,
  batchItems,
  filteredBatchItems,
  batchFilter,
  setBatchFilter,
  batchItemStatuses,
  itemBranchOverrides,
  onItemBranchChange,
  batchRepoDataMap,
  batchProbingMap,
  batchProbeErrorMap,
  onProbeSingle,
  onProbeAll,
  batchProvider,
  onRunSingleItem,
  onRemoveItem,
  onOpenFolder,
  batchViewMode,
  setBatchViewMode
}) {
  const terminalRef = useRef(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [onlyErrors, setOnlyErrors] = useState(false)

  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [progress.logs, autoScroll])

  const copyAllLogs = () => {
    const text = progress.logs.map((l) => `[${l.time}] ${l.text}`).join('\n')
    navigator.clipboard.writeText(text)
  }

  const filteredLogs = useMemo(() => {
    if (!onlyErrors) return progress.logs
    return progress.logs.filter((l) => l.source === 'stderr')
  }, [progress.logs, onlyErrors])

  const statusLabel =
    progress.status === 'success' ? '批量完成' :
    progress.status === 'error' ? '部分失败' :
    progress.status === 'cancelled' ? '已中止' :
    running ? '批量拉取中' : '等待启动'

  const statusClass =
    progress.status === 'success' ? 'success' :
    progress.status === 'error' ? 'error' :
    progress.status === 'cancelled' ? 'idle' :
    running ? 'running' : 'idle'

  const renderQueue = (isSplit = false) => (
    <div className={`batch-queue-container ${isSplit ? 'split-mode' : 'full-mode'}`}>
      <div className="batch-queue-header">
        <span>待拉取仓库清单 (共 <b>{batchItems.length}</b> 个)</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="input-with-icon" style={{ height: 26, padding: '0 8px', fontSize: 11 }}>
            <Filter size={11} />
            <input
              placeholder="过滤项目名/分支..."
              value={batchFilter}
              onChange={(e) => setBatchFilter(e.target.value)}
              style={{ fontSize: 11 }}
            />
          </div>
          <button
            type="button"
            className="batch-fetch-all-btn"
            onClick={onProbeAll}
            disabled={running}
            title="读取所有仓库的可选分支、标签和修订版本"
          >
            <Search size={11} />
            批量读取版本
          </button>
        </div>
      </div>
      <div className="batch-queue-col-headers">
        <span>#</span>
        <span>项目名称</span>
        <span>版本/分支下拉选择</span>
        <span>目标目录</span>
        <span style={{ textAlign: 'center' }}>执行状态</span>
        <span style={{ textAlign: 'center' }}>操作</span>
      </div>
      <div className="batch-queue-list">
        {(filteredBatchItems || batchItems).length ? (
          (filteredBatchItems || batchItems).map((item, index) => {
            const itemState = batchItemStatuses[item.id] || { status: 'idle', error: '', action: 'pull' }
            const itemStatusClass = itemState.status
            const itemStatusLabel =
              itemStatusClass === 'running' ? (itemState.action === 'update' ? '更新中' : '拉取中') :
              itemStatusClass === 'success' ? (itemState.action === 'update' ? '已更新' : '已拉取') :
              itemStatusClass === 'error' ? '失败' :
              itemStatusClass === 'skipped' ? '跳过' : '等待'

            const repoData = batchRepoDataMap[item.url]
            const isProbing = Boolean(batchProbingMap[item.url])
            const probeErr = batchProbeErrorMap[item.url]
            const versionOptions = getRepoVersionOptions(repoData, batchProvider)

            const currentVal = itemBranchOverrides[item.id] !== undefined
              ? itemBranchOverrides[item.id]
              : (item.parsedBranch || 'default')

            return (
              <div key={item.id} className={`batch-queue-item ${itemStatusClass}`}>
                <span className="batch-item-index">#{index + 1}</span>
                <span className="batch-item-name" title={item.name}>{item.name}</span>

                <div className="batch-version-select-wrap">
                  {isProbing ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--cyan-primary)', fontSize: 11 }}>
                      <LoaderCircle size={11} className="spin" />
                      <span>读取中..</span>
                    </div>
                  ) : (
                    <select
                      className="batch-version-select"
                      value={currentVal}
                      onChange={(e) => onItemBranchChange(item.id, e.target.value)}
                      disabled={running}
                      title={probeErr ? `读取失败: ${probeErr}` : currentVal && currentVal !== 'default' ? `已选版本：${currentVal}` : '下拉选择拉取的版本'}
                    >
                      <option value="default">
                        {batchProvider === 'git'
                          ? (repoData?.defaultBranch ? `默认主线 (${repoData.defaultBranch})` : '默认主线 (HEAD)')
                          : (repoData?.latestRevision ? `最新版本 (r${repoData.latestRevision})` : '最新版本 (HEAD)')}
                      </option>

                      {item.parsedBranch && !versionOptions.some((o) => o.name === item.parsedBranch || o.id === item.parsedBranch) && (
                        <option value={item.parsedBranch}>链接指定 · {item.parsedBranch}</option>
                      )}

                      {versionOptions.some((o) => o.kind === 'branch') && (
                        <optgroup label="分支 (Branches)">
                          {versionOptions.filter((o) => o.kind === 'branch').map((opt) => (
                            <option key={opt.id} value={opt.name}>{opt.label}</option>
                          ))}
                        </optgroup>
                      )}

                      {versionOptions.some((o) => o.kind === 'tag') && (
                        <optgroup label="标签 (Tags)">
                          {versionOptions.filter((o) => o.kind === 'tag').map((opt) => (
                            <option key={opt.id} value={opt.name}>{opt.label}</option>
                          ))}
                        </optgroup>
                      )}

                      {versionOptions.some((o) => o.kind === 'dir') && (
                        <optgroup label="目录 / 标签 (Directories)">
                          {versionOptions.filter((o) => o.kind === 'dir').map((opt) => (
                            <option key={opt.id} value={`dir:${opt.subPath}`}>{opt.label}</option>
                          ))}
                        </optgroup>
                      )}

                      {versionOptions.some((o) => o.kind === 'rev') && (
                        <optgroup label="历史修订版本 (Revisions)">
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
                    disabled={running || isProbing}
                    title={probeErr ? `读取失败: ${probeErr}` : repoData ? '重新读取版本' : '读取该仓库分支与版本'}
                  >
                    {isProbing ? <LoaderCircle size={11} className="spin" /> : <Search size={11} />}
                  </button>
                </div>

                <span className="batch-item-target" title={item.target}>{item.target}</span>
                <span className={`batch-status-badge ${itemStatusClass}`} title={itemState.error || ''}>
                  {itemStatusClass === 'running' && <LoaderCircle size={9} className="spin" />}
                  {itemStatusClass === 'success' && <Check size={9} />}
                  {itemStatusClass === 'error' && <AlertCircle size={9} />}
                  {itemStatusLabel}
                </span>

                <div className="batch-item-actions">
                  {itemStatusClass === 'success' && (
                    <button type="button" className="batch-icon-action" onClick={() => onOpenFolder(item.target)} title="打开本地文件夹">
                      <FolderOpen size={12} />
                    </button>
                  )}
                  <button type="button" className="batch-icon-action" onClick={() => onRunSingleItem(item)} disabled={running} title="单独拉取/更新该项">
                    <Play size={11} />
                  </button>
                  <button type="button" className="batch-icon-action danger" onClick={() => onRemoveItem(item)} disabled={running} title="从列表中移除">
                    <X size={12} />
                  </button>
                </div>
              </div>
            )
          })
        ) : (
          <div className="batch-queue-empty">
            <Layers size={22} />
            <span>暂未解析到仓库地址</span>
            <small>在左侧文本框中输入或粘贴仓库链接后，列表将自动生成</small>
          </div>
        )}
      </div>
    </div>
  )

  const renderTerminal = (isSplit = false) => (
    <div className={`batch-terminal-container ${isSplit ? 'split-mode' : 'full-mode'}`}>
      <div className="log-heading">
        <span><Terminal size={13} />批量命令实时流</span>
        <div className="log-tools">
          <button type="button" onClick={() => setOnlyErrors(!onlyErrors)} style={{ color: onlyErrors ? 'var(--crimson-text)' : undefined }}>
            <Filter size={11} style={{ display: 'inline', marginRight: 3 }} />{onlyErrors ? '全部输出' : '仅看错误'}
          </button>
          <button type="button" onClick={() => setAutoScroll(!autoScroll)}>
            {autoScroll ? '锁定滚动' : '跟随滚动'}
          </button>
          <button type="button" onClick={copyAllLogs} disabled={!progress.logs.length}>复制日志</button>
          <button type="button" onClick={clearLogs} disabled={!progress.logs.length}>清空</button>
        </div>
      </div>

      <div className="terminal-window">
        <div className="terminal-header-dots">
          <span className="terminal-dot red" />
          <span className="terminal-dot yellow" />
          <span className="terminal-dot green" />
          <span style={{ fontSize: '11px', color: '#64748b', marginLeft: '6px', fontFamily: 'var(--font-mono)' }}>console@codesync ~ batch-queue</span>
        </div>
        <div className="terminal-output" ref={terminalRef}>
          {filteredLogs.length ? (
            filteredLogs.map((line, index) => (
              <div className={`log-line ${line.source}`} key={`${line.time}-${index}`}>
                <time>{new Date(line.time).toLocaleTimeString('zh-CN', { hour12: false })}</time>
                <span>{line.text}</span>
              </div>
            ))
          ) : (
            <div className="terminal-placeholder">
              <Terminal size={22} />
              <span>等待批量任务启动...</span>
              <small>各仓库的拉取输出流会在此有序滚动呈现</small>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="task-panel panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">// STEP 02 QUEUE & TELEMETRY</p>
          <h2>批量队列与实时遥测</h2>
        </div>
        <div className="batch-view-segmented">
          <button
            type="button"
            className={`batch-view-btn ${batchViewMode === 'queue' ? 'active' : ''}`}
            onClick={() => setBatchViewMode('queue')}
            title="全屏查看待拉取仓库清单"
          >
            <Layers size={12} />
            <span>清单 ({batchItems.length})</span>
          </button>
          <button
            type="button"
            className={`batch-view-btn ${batchViewMode === 'telemetry' ? 'active' : ''}`}
            onClick={() => setBatchViewMode('telemetry')}
            title="全屏查看命令行实时日志"
          >
            <Terminal size={12} />
            <span>终端遥测</span>
          </button>
          <button
            type="button"
            className={`batch-view-btn ${batchViewMode === 'split' ? 'active' : ''}`}
            onClick={() => setBatchViewMode('split')}
            title="分屏对照查看清单与终端"
          >
            <Columns2 size={12} />
            <span>分屏对照</span>
          </button>
        </div>
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
            <span className="batch-stats-item">总计: <b>{progress.totalCount || batchItems.length}</b></span>
            <span className="batch-stats-item success">成功: <b>{progress.successCount || 0}</b></span>
            <span className="batch-stats-item error">失败: <b>{progress.errorCount || 0}</b></span>
            <span className="batch-stats-item skipped">跳过: <b>{progress.skippedCount || 0}</b></span>
          </div>
        </div>
      </div>

      <div className="bar-track">
        <span style={{ width: `${Math.max(0, Math.min(100, progress.value))}%` }} />
      </div>

      <div className="batch-views-body">
        {batchViewMode === 'queue' && renderQueue(false)}
        {batchViewMode === 'telemetry' && renderTerminal(false)}
        {batchViewMode === 'split' && (
          <div className="batch-split-layout">
            {renderQueue(true)}
            {renderTerminal(true)}
          </div>
        )}
      </div>

      <div className="task-bottom">
        <span><Zap size={13} />{running ? `批量任务运行中 · 已耗时 ${formatDuration(elapsedSeconds)}` : '批量引擎待命'}</span>
        {running ? (
          <button className="stop-button" onClick={cancelTask}><Square size={13} />停止批量任务</button>
        ) : (
          <span style={{ fontSize: 11, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Play size={11} />执行期间请保持应用窗口开启
          </span>
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
  const [filterText, setFilterText] = useState('')
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

  const visibleEntries = useMemo(() => {
    if (!filterText.trim()) return entries
    const q = filterText.toLowerCase().trim()
    return entries.filter((e) => e.name.toLowerCase().includes(q))
  }, [entries, filterText])

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
      {entries.length > 5 && (
        <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
          <input
            style={{ width: '100%', background: 'transparent', border: 0, color: 'var(--text-heading)', fontSize: '11px', outline: 'none' }}
            placeholder="搜索当前目录下文件/文件夹..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </div>
      )}
      <div className="dir-list">
        {loading ? (
          <div className="dir-loading"><LoaderCircle size={14} className="spin" />正在读取远程目录结构...</div>
        ) : error ? (
          <div className="dir-error"><AlertCircle size={14} />{error}<button onClick={() => onNavigate(path)}>重试</button></div>
        ) : visibleEntries.length ? (
          visibleEntries.map((entry) => (
            entry.kind === 'dir' ? (
              <div
                key={entry.name}
                className={`dir-row dir ${selectedPath === fullPath(entry.name) ? 'selected' : ''}`}
                onClick={() => onSelect(fullPath(entry.name))}
                onDoubleClick={() => onNavigate(fullPath(entry.name))}
                title="单击选择该目录 · 双击深入子目录"
              >
                <Folder size={14} />
                <span className="dir-name">{entry.name}</span>
                <span className="dir-radio">{selectedPath === fullPath(entry.name) ? <Check size={10} /> : ''}</span>
                <button className="dir-enter" title="进入该目录" onClick={(event) => { event.stopPropagation(); onNavigate(fullPath(entry.name)) }}>
                  <ChevronRight size={12} />
                </button>
              </div>
            ) : (
              <div key={entry.name} className="dir-row file" title="文件项，请选择父级文件夹">
                <FileText size={13} />
                <span className="dir-name">{entry.name}</span>
              </div>
            )
          ))
        ) : (
          <div className="dir-empty"><FolderOpen size={14} />该目录下无内容</div>
        )}
      </div>
      <div className="dir-status">
        <span>将{verb}：<b>{selectedPath ? selectedPath : noneLabel}</b></span>
        {selectedPath ? <button onClick={() => onSelect('')}>清除已选目录</button> : <small>点击目录即可作为检出目标</small>}
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
          <small>元数据读取成功</small>
        </div>
      </div>
      <div className="repo-facts">
        {provider === 'git' ? (
          <>
            <span><GitBranch size={12} /><b>{repo.branches?.length || 0}</b> 分支</span>
            <span><GitCommitHorizontal size={12} /><b>{repo.tags?.length || 0}</b> 标签</span>
            <span><strong>{repo.defaultBranch || 'HEAD'}</strong> 主线</span>
          </>
        ) : (
          <>
            <span><GitCommitHorizontal size={12} /><b>r{repo.latestRevision || 'HEAD'}</b> 最新修订</span>
            <span><Server size={12} /><b>{repo.directories?.length || 0}</b> 个目录</span>
            <span><strong>{repo.revisions?.length || 0}</strong> 条提交记录</span>
          </>
        )}
      </div>
    </div>
  )
}

function TaskPanel({ progress, running, elapsedSeconds, targetPath, onOpenPath, cancelTask, clearLogs }) {
  const terminalRef = useRef(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [onlyErrors, setOnlyErrors] = useState(false)

  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [progress.logs, autoScroll])

  const copyAllLogs = () => {
    const text = progress.logs.map((l) => `[${l.time}] ${l.text}`).join('\n')
    navigator.clipboard.writeText(text)
  }

  const filteredLogs = useMemo(() => {
    if (!onlyErrors) return progress.logs
    return progress.logs.filter((l) => l.source === 'stderr')
  }, [progress.logs, onlyErrors])

  const statusLabel =
    progress.status === 'success' ? '任务完成' :
    progress.status === 'error' ? '任务失败' :
    running ? '正在执行' : '等待任务'

  const statusClass =
    progress.status === 'success' ? 'success' :
    progress.status === 'error' ? 'error' :
    running ? 'running' : 'idle'

  return (
    <div className="task-panel panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">// STEP 02 TELEMETRY & CONSOLE</p>
          <h2>实时任务遥测</h2>
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
          <span>{running ? `正在通过系统进程执行 · 已耗时 ${formatDuration(elapsedSeconds)}` : progress.status === 'success' ? '工作副本已就绪，可随时使用' : '命令行输出实时滚动显示在下方'}</span>
        </div>
      </div>
      <div className="bar-track"><span style={{ width: `${Math.max(0, Math.min(100, progress.value))}%` }} /></div>
      <div className="log-heading">
        <span><Terminal size={13} />命令终端输出</span>
        <div className="log-tools">
          <button type="button" onClick={() => setOnlyErrors(!onlyErrors)} style={{ color: onlyErrors ? 'var(--crimson-text)' : undefined }}>
            <Filter size={11} style={{ display: 'inline', marginRight: 3 }} />{onlyErrors ? '全部输出' : '仅看错误'}
          </button>
          <button type="button" onClick={() => setAutoScroll(!autoScroll)}>
            {autoScroll ? '锁定滚动' : '跟随滚动'}
          </button>
          <button type="button" onClick={copyAllLogs} disabled={!progress.logs.length}>复制日志</button>
          <button type="button" onClick={clearLogs} disabled={!progress.logs.length}>清空</button>
        </div>
      </div>
      <div className="terminal-window">
        <div className="terminal-header-dots">
          <span className="terminal-dot red" />
          <span className="terminal-dot yellow" />
          <span className="terminal-dot green" />
          <span style={{ fontSize: '10.5px', color: '#64748b', marginLeft: '6px', fontFamily: 'var(--font-mono)' }}>console@codesync ~ telemetry</span>
        </div>
        <div className="terminal-output" ref={terminalRef}>
          {filteredLogs.length ? (
            filteredLogs.map((line, index) => (
              <div className={`log-line ${line.source}`} key={`${line.time}-${index}`}>
                <time>{new Date(line.time).toLocaleTimeString('zh-CN', { hour12: false })}</time>
                <span>{line.text}</span>
              </div>
            ))
          ) : (
            <div className="terminal-placeholder">
              <Terminal size={22} />
              <span>等待任务启动...</span>
              <small>Git 和 SVN 的详细命令行输出会在此实时滚动呈现</small>
            </div>
          )}
        </div>
      </div>
      <div className="task-bottom">
        <span><Zap size={13} />CLI 通道已连接</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {progress.status === 'success' && targetPath && (
            <button className="ghost-action" onClick={onOpenPath} style={{ height: 32, padding: '0 12px', fontSize: 12 }}>
              <FolderOpen size={13} />打开工作目录
            </button>
          )}
          {running ? (
            <button className="stop-button" onClick={cancelTask}><Square size={13} />停止任务</button>
          ) : (
            <span style={{ fontSize: 11, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Play size={11} />执行期间请保持应用窗口开启
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)

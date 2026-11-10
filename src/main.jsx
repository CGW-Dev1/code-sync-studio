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
  Package,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  Save,
  Search,
  Server,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Tag,
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

function formatFileSize(bytes = 0) {
  const num = Number(bytes) || 0
  if (num < 1024) return `${num} B`
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`
  return `${(num / 1024 / 1024).toFixed(2)} MB`
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
  let subdir = ''

  const spaceParts = line.split(/\s+/)
  if (spaceParts.length >= 3) {
    url = spaceParts[0].trim()
    branch = spaceParts[1].trim()
    subdir = spaceParts.slice(2).join(' ').trim().replace(/^--path=/i, '').replace(/^\/+|\/+$/g, '')
  } else if (spaceParts.length === 2) {
    url = spaceParts[0].trim()
    const second = spaceParts[1].trim()
    if (second.startsWith('--path=') || second.startsWith('/')) {
      subdir = second.replace(/^--path=/i, '').replace(/^\/+|\/+$/g, '')
    } else {
      branch = second
    }
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

  return { url, branch, subdir }
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
      parsedSubdir: parsed.subdir || '',
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

function resolveItemVersionPayload(item, branchSelection, batchProvider, globalBranch, batchSvnMainlineOnly, repoData, selectedSubdir = '') {
  const cleanSubdir = String(selectedSubdir || '').trim().replace(/^\/+|\/+$/g, '')
  let val = (branchSelection !== undefined ? branchSelection : item.parsedBranch)?.trim()
  if (!val && batchProvider === 'git') {
    val = globalBranch.trim()
  }

  let finalUrl = item.url
  if (batchProvider === 'git') {
    let branchName = ''
    let kind = 'branch'
    if (val && val !== 'default' && val !== 'HEAD') {
      if (val.startsWith('tag:')) {
        kind = 'tag'
        branchName = val.slice(4) || ''
      } else if (val.startsWith('branch:')) {
        branchName = val.slice(7) || ''
      } else if ((repoData?.tags || []).some((t) => t.name === val) && !(repoData?.branches || []).some((b) => b.name === val)) {
        kind = 'tag'
        branchName = val
      } else {
        branchName = val
      }
    } else if (repoData?.defaultBranch && repoData.defaultBranch !== 'HEAD') {
      branchName = repoData.defaultBranch
    }
    const baseLabel = branchName || '默认分支'
    return {
      finalUrl,
      sparsePath: cleanSubdir,
      payloadVersion: {
        kind,
        name: branchName,
        label: cleanSubdir ? `${baseLabel} · 仅 ${cleanSubdir}` : baseLabel
      }
    }
  }

  // SVN
  let result
  if (!val || val === 'default' || val === 'HEAD' || val.toLowerCase() === 'trunk') {
    if (batchSvnMainlineOnly) {
      if (isTrunkUrl(item.url)) {
        finalUrl = item.url
      } else {
        const trunkDir = (repoData?.directories || []).find((d) => d.toLowerCase() === 'trunk') || 'trunk'
        finalUrl = joinSvnUrl(item.url, trunkDir)
      }
    }
    result = {
      finalUrl,
      payloadVersion: {
        kind: 'svn',
        revision: 'HEAD',
        sourceUrl: finalUrl,
        label: batchSvnMainlineOnly ? '主线 trunk' : '最新版本'
      }
    }
  } else if (val.startsWith('dir:')) {
    const subDir = val.slice(4).trim()
    finalUrl = joinSvnUrl(item.url, subDir)
    result = {
      finalUrl,
      payloadVersion: {
        kind: 'svn',
        revision: 'HEAD',
        sourceUrl: finalUrl,
        label: `目录/标签 · ${subDir}`
      }
    }
  } else if (val.startsWith('rev:')) {
    const revNum = val.slice(4).trim()
    result = {
      finalUrl,
      payloadVersion: {
        kind: 'svn',
        revision: revNum,
        sourceUrl: finalUrl,
        label: `r${revNum}`
      }
    }
  } else if (/^(?:r)?\d+$/i.test(val)) {
    const revNum = val.replace(/^r/i, '')
    result = {
      finalUrl,
      payloadVersion: {
        kind: 'svn',
        revision: revNum,
        sourceUrl: finalUrl,
        label: `r${revNum}`
      }
    }
  } else {
    if (isTrunkUrl(item.url)) {
      finalUrl = `${item.url.replace(/\/trunk\/?$/i, '')}/${val.replace(/^\/+/, '')}`
    } else {
      finalUrl = joinSvnUrl(item.url, val)
    }
    result = {
      finalUrl,
      payloadVersion: {
        kind: 'svn',
        revision: 'HEAD',
        sourceUrl: finalUrl,
        label: val
      }
    }
  }

  if (cleanSubdir) {
    const subUrl = joinSvnUrl(result.finalUrl, cleanSubdir)
    return {
      finalUrl: subUrl,
      sparsePath: cleanSubdir,
      payloadVersion: {
        ...result.payloadVersion,
        kind: 'path',
        name: cleanSubdir,
        sourceUrl: subUrl,
        label: `${result.payloadVersion.label} · 仅 ${cleanSubdir}`
      }
    }
  }

  return {
    ...result,
    sparsePath: ''
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
  const [itemSubdirOverrides, setItemSubdirOverrides] = useState({})
  const [batchShowAdvanced, setBatchShowAdvanced] = useState(false)
  const [batchBrowseItemId, setBatchBrowseItemId] = useState('')
  const [batchBrowseEntries, setBatchBrowseEntries] = useState([])
  const [batchBrowsePath, setBatchBrowsePath] = useState('')
  const [batchBrowseLoading, setBatchBrowseLoading] = useState(false)
  const [batchBrowseError, setBatchBrowseError] = useState('')
  const batchBrowseSeq = useRef(0)

  // 代码推送专属状态
  const [pushProvider, setPushProvider] = useState('git')
  const [pushTarget, setPushTarget] = useState(() => localStorage.getItem('code-sync-push-target') || '')
  const [pushRemoteUrl, setPushRemoteUrl] = useState(() => localStorage.getItem('code-sync-push-remote') || '')
  const [pushBranch, setPushBranch] = useState('main')
  const [pushCommitMsg, setPushCommitMsg] = useState('')
  const [pushCommitChanges, setPushCommitChanges] = useState(true)
  const [pushPullBeforePush, setPushPullBeforePush] = useState(true)
  const [pushForce, setPushForce] = useState(false)
  const [pushTags, setPushTags] = useState(false)
  const [pushWorkspace, setPushWorkspace] = useState(null)
  const [pushInspecting, setPushInspecting] = useState(false)
  const [pushInspectError, setPushInspectError] = useState('')
  const [pushSelectedFiles, setPushSelectedFiles] = useState([])
  const [pushFilter, setPushFilter] = useState('')
  const [pushViewMode, setPushViewMode] = useState('split') // 'changes' | 'telemetry' | 'split'
  const [pushRunning, setPushRunning] = useState(false)
  const [pushElapsed, setPushElapsed] = useState(0)
  const [pushProgress, setPushProgress] = useState({
    value: 0,
    label: '等待推送任务启动',
    logs: [],
    status: 'idle'
  })
  const pushRunningRef = useRef(false)

  // 单仓克隆附加选项
  const [shallowClone, setShallowClone] = useState(false)
  const [recurseSubmodules, setRecurseSubmodules] = useState(false)

  // 本地仓库工作区盘点状态 (mode === 'workspace')
  const [workspaceRoot, setWorkspaceRoot] = useState(() => localStorage.getItem('code-sync-workspace-root') || localStorage.getItem('code-sync-batch-target-root') || '')
  const [workspaceRepos, setWorkspaceRepos] = useState([])
  const [workspaceScanning, setWorkspaceScanning] = useState(false)
  const [workspaceFilter, setWorkspaceFilter] = useState('')
  const [workspaceTypeFilter, setWorkspaceTypeFilter] = useState('all') // 'all' | 'dirty' | 'ahead' | 'git' | 'svn'
  const [workspaceUpdatingMap, setWorkspaceUpdatingMap] = useState({})
  const [workspaceBatchUpdating, setWorkspaceBatchUpdating] = useState(false)
  const workspaceRunningRef = useRef(false)

  // 版本发布状态 (mode === 'release')
  const [releaseTarget, setReleaseTarget] = useState(() => localStorage.getItem('code-sync-release-target') || localStorage.getItem('code-sync-push-target') || '')
  const [releaseRemoteUrl, setReleaseRemoteUrl] = useState(() => localStorage.getItem('code-sync-release-remote') || '')
  const [releaseTag, setReleaseTag] = useState('v1.4.6')
  const [releaseTitle, setReleaseTitle] = useState('CodeSync Studio v1.4.6')
  const [releaseBranch, setReleaseBranch] = useState('main')
  const [releaseNotes, setReleaseNotes] = useState('')
  const [releaseToken, setReleaseToken] = useState('')
  const [releasePushTag, setReleasePushTag] = useState(true)
  const [releasePrerelease, setReleasePrerelease] = useState(false)
  const [releaseDraft, setReleaseDraft] = useState(false)
  const [releaseWorkspace, setReleaseWorkspace] = useState(null)
  const [releaseInspecting, setReleaseInspecting] = useState(false)
  const [releaseAssets, setReleaseAssets] = useState([])
  const [releaseAssetProgressMap, setReleaseAssetProgressMap] = useState({})
  const [releaseViewMode, setReleaseViewMode] = useState('split') // 'assets' | 'telemetry' | 'split'
  const [releaseRunning, setReleaseRunning] = useState(false)
  const [releaseElapsed, setReleaseElapsed] = useState(0)
  const [releasePublishedUrl, setReleasePublishedUrl] = useState('')
  const [releaseProgress, setReleaseProgress] = useState({
    value: 0,
    label: '等待 Release 发布任务启动',
    logs: [],
    status: 'idle'
  })
  const releaseRunningRef = useRef(false)

  const handleSetReleaseTarget = (val) => {
    setReleaseTarget(val)
    localStorage.setItem('code-sync-release-target', val)
  }

  const handleSetReleaseRemoteUrl = (val) => {
    setReleaseRemoteUrl(val)
    localStorage.setItem('code-sync-release-remote', val)
  }

  const handleSetWorkspaceRoot = (val) => {
    setWorkspaceRoot(val)
    localStorage.setItem('code-sync-workspace-root', val)
  }

  const handleSetPushTarget = (val) => {
    setPushTarget(val)
    localStorage.setItem('code-sync-push-target', val)
  }

  const handleSetPushRemoteUrl = (val) => {
    setPushRemoteUrl(val)
    localStorage.setItem('code-sync-push-remote', val)
  }

  const handleItemBranchChange = (itemId, val) => {
    setItemBranchOverrides((prev) => ({
      ...prev,
      [itemId]: val
    }))
  }

  const handleItemSubdirChange = (itemId, val) => {
    setItemSubdirOverrides((prev) => ({
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

  const handleApplySubdirToAll = (subdirVal) => {
    const clean = String(subdirVal || '').trim().replace(/^\/+|\/+$/g, '')
    setItemSubdirOverrides(() => {
      const next = {}
      batchItems.forEach((item) => {
        next[item.id] = clean
      })
      return next
    })
    showToast(clean ? `已将子目录 "${clean}" 应用到全部 ${batchItems.length} 个项目` : '已清除全部项目的子目录检出限制')
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

  // 代码推送任务计时器
  useEffect(() => {
    let timer = null
    if (pushRunning) {
      setPushElapsed(0)
      timer = setInterval(() => setPushElapsed((sec) => sec + 1), 1000)
    }
    return () => { if (timer) clearInterval(timer) }
  }, [pushRunning])

  // 版本发布任务计时器
  useEffect(() => {
    let timer = null
    if (releaseRunning) {
      setReleaseElapsed(0)
      timer = setInterval(() => setReleaseElapsed((sec) => sec + 1), 1000)
    }
    return () => { if (timer) clearInterval(timer) }
  }, [releaseRunning])

  // 版本发布工作区自动检测
  async function inspectReleaseWorkspaceNow(targetDir = releaseTarget, silent = false) {
    if (!api?.inspectReleaseWorkspace || !targetDir || !targetDir.trim()) {
      setReleaseWorkspace(null)
      return
    }
    setReleaseInspecting(true)
    try {
      const info = await api.inspectReleaseWorkspace({ target: targetDir.trim() })
      setReleaseWorkspace(info)
      if (info.url) handleSetReleaseRemoteUrl(info.url)
      if (info.branch) setReleaseBranch(info.branch)
      if (info.suggestedTag) setReleaseTag(info.suggestedTag)
      if (info.suggestedTitle) setReleaseTitle(info.suggestedTitle)
      if (Array.isArray(info.discoveredAssets) && info.discoveredAssets.length > 0) {
        setReleaseAssets(info.discoveredAssets)
        if (!silent || releaseProgress.status !== 'success') {
          setReleaseAssetProgressMap({})
        }
      }
      if (info.recentCommits && (!releaseNotes.trim() || /^-\s*(feat|chore|fix|docs|refactor|perf|style):/m.test(releaseNotes))) {
        setReleaseNotes(`## ${info.suggestedTitle || info.suggestedTag}\n\n### ✨ 更新内容\n${info.recentCommits}\n`)
      }
      if (!silent) {
        showToast(`已载入发布配置：发现 ${info.discoveredAssets?.length || 0} 个构建产物附件`)
      }
    } catch (err) {
      if (!silent) showToast(appError(err))
    } finally {
      setReleaseInspecting(false)
    }
  }

  useEffect(() => {
    if (!api?.inspectReleaseWorkspace || !releaseTarget.trim()) return
    const timer = setTimeout(() => {
      inspectReleaseWorkspaceNow(releaseTarget, true)
    }, 350)
    return () => clearTimeout(timer)
  }, [releaseTarget])

  // 代码推送工作区自动检测
  async function inspectPushWorkspaceNow(targetDir = pushTarget, silent = false) {
    if (!api?.inspectPushWorkspace || !targetDir || !targetDir.trim()) {
      setPushWorkspace(null)
      setPushInspectError('')
      setPushSelectedFiles([])
      return
    }
    setPushInspecting(true)
    setPushInspectError('')
    try {
      const info = await api.inspectPushWorkspace({ target: targetDir.trim() })
      setPushWorkspace(info)
      if (info.provider && info.provider !== pushProvider) {
        setPushProvider(info.provider)
      }
      if (info.url) {
        handleSetPushRemoteUrl(info.url)
      }
      if (info.branch) {
        setPushBranch(info.branch)
      }
      setPushSelectedFiles((info.changes || []).map((c) => c.path))
      if (!silent) {
        showToast(info.initialized
          ? `已加载 ${info.provider.toUpperCase()} 工作区 (${info.changes?.length || 0} 项文件变更)`
          : `未初始化目录，已扫描 ${info.changes?.length || 0} 个待推送文件`)
      }
    } catch (err) {
      setPushWorkspace(null)
      setPushInspectError(appError(err))
      setPushSelectedFiles([])
    } finally {
      setPushInspecting(false)
    }
  }

  useEffect(() => {
    if (!api?.inspectPushWorkspace || !pushTarget.trim()) {
      setPushWorkspace(null)
      setPushInspectError('')
      setPushSelectedFiles([])
      return
    }
    const timer = setTimeout(() => {
      inspectPushWorkspaceNow(pushTarget, true)
    }, 350)
    return () => clearTimeout(timer)
  }, [pushTarget])

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
    setItemSubdirOverrides({})
    setBatchBrowseItemId('')
    setBatchBrowseEntries([])
    setBatchBrowsePath('')
    setBatchBrowseError('')
  }, [batchProvider])

  const activeBatchBrowseItem = useMemo(() => {
    if (!batchItems.length) return null
    return batchItems.find((item) => item.id === batchBrowseItemId) || batchItems[0]
  }, [batchItems, batchBrowseItemId])

  const activeBatchSelectedSubdir = useMemo(() => {
    if (!activeBatchBrowseItem) return ''
    return itemSubdirOverrides[activeBatchBrowseItem.id] !== undefined
      ? itemSubdirOverrides[activeBatchBrowseItem.id]
      : (activeBatchBrowseItem.parsedSubdir || '')
  }, [activeBatchBrowseItem, itemSubdirOverrides])

  async function navigateBatchBrowse(path = '', targetItemOverride = null) {
    const item = targetItemOverride || activeBatchBrowseItem
    if (!api || !item || !item.url) return
    const seq = ++batchBrowseSeq.current
    setBatchBrowseLoading(true)
    setBatchBrowseError('')
    const branchVal = itemBranchOverrides[item.id] !== undefined ? itemBranchOverrides[item.id] : item.parsedBranch
    const branchName = branchVal && branchVal !== 'default' ? branchVal.replace(/^(branch|tag):/, '') : 'HEAD'
    try {
      const result = await api.browseRepository({
        provider: batchProvider,
        url: item.url,
        path,
        ...(batchProvider === 'svn' ? { revision: 'HEAD' } : { version: { name: branchName, kind: 'branch' } })
      })
      if (seq === batchBrowseSeq.current) {
        setBatchBrowsePath(path)
        setBatchBrowseEntries(result.entries || [])
      }
    } catch (err) {
      if (seq === batchBrowseSeq.current) {
        setBatchBrowseError(appError(err))
      }
    } finally {
      if (seq === batchBrowseSeq.current) {
        setBatchBrowseLoading(false)
      }
    }
  }

  function selectBatchBrowsePath(path) {
    if (!activeBatchBrowseItem) return
    handleItemSubdirChange(activeBatchBrowseItem.id, path)
    if (batchProvider === 'svn' && path && batchSvnMainlineOnly) {
      handleSetBatchSvnMainlineOnly(false)
    }
  }

  function handleOpenBatchItemSubdir(item) {
    if (!item) return
    setBatchShowAdvanced(true)
    setBatchBrowseItemId(item.id)
    setBatchBrowsePath('')
    navigateBatchBrowse('', item)
  }

  useEffect(() => {
    if (batchShowAdvanced && activeBatchBrowseItem && !batchBrowseEntries.length && !batchBrowseLoading && !batchBrowseError) {
      navigateBatchBrowse('', activeBatchBrowseItem)
    }
  }, [batchShowAdvanced, activeBatchBrowseItem?.id])

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
      if (workspaceRunningRef.current) {
        return
      }

      if (batchRunningRef.current) {
        if (event.type === 'line') {
          setBatchProgress((current) => ({
            ...current,
            logs: [...current.logs.slice(-399), { ...event }]
          }))
        }
        return
      }

      if (event.action === 'push' || pushRunningRef.current) {
        if (event.type === 'start') {
          setPushRunning(true)
          setPushProgress({ value: 2, label: event.label, logs: [], status: 'running', provider: event.provider, action: event.action })
        }
        if (event.type === 'step') {
          setPushProgress((current) => ({ ...current, value: Math.max(current.value, event.value), label: event.label }))
        }
        if (event.type === 'line') {
          setPushProgress((current) => ({ ...current, logs: [...current.logs.slice(-399), { ...event }] }))
        }
        if (event.type === 'progress') {
          setPushProgress((current) => ({ ...current, value: Math.max(current.value, event.value), label: event.label }))
        }
        if (event.type === 'done') {
          setPushRunning(false)
          pushRunningRef.current = false
          setPushProgress((current) => ({
            ...current,
            value: event.ok ? 100 : current.value,
            label: event.label,
            status: event.ok ? 'success' : 'error'
          }))
        }
        return
      }

      if (event.action === 'release' || releaseRunningRef.current) {
        if (event.type === 'start') {
          setReleaseRunning(true)
          setReleaseProgress({ value: 2, label: event.label, logs: [], status: 'running' })
        }
        if (event.type === 'step') {
          setReleaseProgress((current) => ({ ...current, value: Math.max(current.value, event.value || 0), label: event.label }))
          if (event.releaseAssetProgress?.path) {
            setReleaseAssetProgressMap((prev) => ({
              ...prev,
              [event.releaseAssetProgress.path]: event.releaseAssetProgress
            }))
          }
        }
        if (event.type === 'line') {
          setReleaseProgress((current) => ({ ...current, logs: [...current.logs.slice(-399), { ...event }] }))
        }
        if (event.type === 'progress') {
          setReleaseProgress((current) => ({ ...current, value: Math.max(current.value, event.value || 0), label: event.label }))
        }
        if (event.type === 'done') {
          setReleaseRunning(false)
          releaseRunningRef.current = false
          if (event.releaseUrl) setReleasePublishedUrl(event.releaseUrl)
          setReleaseProgress((current) => ({
            ...current,
            value: event.ok ? 100 : current.value,
            label: event.label,
            status: event.ok ? 'success' : 'error'
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

  async function probe(overrideUrl) {
    const targetUrl = (typeof overrideUrl === 'string' ? overrideUrl : url).trim()
    if (!targetUrl) return setProbeError('请输入仓库地址后再查看版本。')
    if (!api) return setProbeError('仓库探测需要在桌面版中运行。')
    setProbing(true)
    setProbeError('')
    try {
      const result = await api.probeRepository({ provider, url: targetUrl })
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

  async function pasteUrlFromClipboard() {
    try {
      const text = await navigator.clipboard.readText()
      const clean = (text || '').trim().split(/\r?\n/)[0]?.trim() || ''
      if (!clean) return showToast('剪贴板为空')
      handleSetUrl(clean)
      if (
        /^svn(?:\+[a-z]+)?:\/\//i.test(clean) ||
        /\/(?:trunk|branches|tags)(?:\/|$)/i.test(clean) ||
        /\/(?:trunk|branches|tags)\/?$/i.test(clean)
      ) {
        setProvider('svn')
      } else if (/^git@/i.test(clean) || /\.git$/i.test(clean)) {
        setProvider('git')
      }
      showToast('已粘贴仓库地址')
    } catch {
      showToast('无法读取剪贴板，请直接 Ctrl+V 粘贴')
    }
  }

  async function runTask() {
    if (running || batchRunning || pushRunning || releaseRunning) return
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
      await api.runTask({
        provider,
        action,
        url: provider === 'svn' ? (payloadVersion.sourceUrl || url) : url,
        target,
        version: payloadVersion,
        path: selectedPath,
        shallowClone: provider === 'git' && action === 'pull' ? shallowClone : false,
        recurseSubmodules: provider === 'git' && action === 'pull' ? recurseSubmodules : false
      })
      setProgress((current) => ({ ...current, value: 100, status: 'success', label: '任务完成' }))
      recordRecentEntry({
        id: Date.now(),
        provider,
        action,
        version: payloadVersion.label || payloadVersion.name || 'HEAD',
        target,
        url: provider === 'svn' ? (payloadVersion.sourceUrl || url) : url,
        time: new Date().toISOString(),
        ok: true
      })
    } catch (error) {
      setProgress((current) => ({ ...current, status: 'error', label: appError(error) }))
      setToast(appError(error))
      window.setTimeout(() => setToast(''), 4200)
    } finally {
      setRunning(false)
    }
  }

  function recordRecentEntry(entry) {
    setRecent((currentRecent) => {
      const next = [
        entry,
        ...currentRecent.filter(
          (r) => !(r.target === entry.target && r.action === entry.action && (entry.action !== 'release' || r.version === entry.version))
        )
      ].slice(0, 50)
      localStorage.setItem('code-sync-recent', JSON.stringify(next))
      return next
    })
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

      const selectedSubdir = itemSubdirOverrides[item.id] !== undefined
        ? itemSubdirOverrides[item.id]
        : (item.parsedSubdir || '')

      const repoData = batchRepoDataMap[item.url]
      const { finalUrl, sparsePath, payloadVersion } = resolveItemVersionPayload(
        item,
        branchSelection,
        batchProvider,
        batchGitBranch,
        batchSvnMainlineOnly,
        repoData,
        selectedSubdir
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
          path: sparsePath || ''
        })

        if (cancelBatchRef.current) break

        setBatchItemStatuses((prev) => ({ ...prev, [item.id]: { status: 'success', error: '' } }))
        successCount++

        recordRecentEntry({
          id: Date.now() + i,
          provider: batchProvider,
          action: taskAction,
          version: payloadVersion.label || 'HEAD',
          target: item.target,
          url: finalUrl,
          time: new Date().toISOString(),
          ok: true
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
    if (batchRunning || running || pushRunning || releaseRunning) return
    if (!batchTargetRoot.trim()) return showToast('请先选择本地保存根目录')
    if (!api) return showToast('任务执行需要在桌面版中运行')

    showToast(`正在单独执行：${targetItem.name}`)
    setBatchItemStatuses((prev) => ({ ...prev, [targetItem.id]: { status: 'running', error: '', action: 'pull' } }))
    batchRunningRef.current = true

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

    const selectedSubdir = itemSubdirOverrides[targetItem.id] !== undefined
      ? itemSubdirOverrides[targetItem.id]
      : (targetItem.parsedSubdir || '')

    const repoData = batchRepoDataMap[targetItem.url]
    const { finalUrl, sparsePath, payloadVersion } = resolveItemVersionPayload(
      targetItem,
      branchSelection,
      batchProvider,
      batchGitBranch,
      batchSvnMainlineOnly,
      repoData,
      selectedSubdir
    )

    try {
      await api.runTask({
        provider: batchProvider,
        action: taskAction,
        url: finalUrl,
        target: targetItem.target,
        version: payloadVersion,
        path: sparsePath || ''
      })
      recordRecentEntry({
        id: Date.now(),
        provider: batchProvider,
        action: taskAction,
        version: payloadVersion.label || payloadVersion.name || 'HEAD',
        target: targetItem.target,
        url: finalUrl,
        time: new Date().toISOString(),
        ok: true
      })
      setBatchItemStatuses((prev) => ({ ...prev, [targetItem.id]: { status: 'success', error: '', action: taskAction } }))
      showToast(`${targetItem.name} ${taskAction === 'pull' ? '拉取' : '更新'}成功`)
    } catch (err) {
      setBatchItemStatuses((prev) => ({ ...prev, [targetItem.id]: { status: 'error', error: appError(err), action: taskAction } }))
      showToast(`${targetItem.name} 失败: ${appError(err)}`)
    } finally {
      batchRunningRef.current = false
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
    if (api.readTextFile) {
      const content = await api.readTextFile(file)
      if (!content || !content.trim()) return showToast('所选文件内容为空或无法读取')
      const current = batchProvider === 'git' ? batchGitUrls : batchSvnUrls
      const merged = current.trim() ? `${current.trim()}\n${content.trim()}` : content.trim()
      if (batchProvider === 'git') handleSetBatchGitUrls(merged)
      else handleSetBatchSvnUrls(merged)
      showToast('已从文件导入仓库列表')
    } else {
      showToast(`已选择文件：${file}`)
    }
  }

  function handleCopyBatchUrls() {
    const current = (batchProvider === 'git' ? batchGitUrls : batchSvnUrls).trim()
    if (!current) return showToast('当前列表为空')
    navigator.clipboard.writeText(current)
    showToast(`已复制 ${batchItems.length} 个仓库链接`)
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
    setItemSubdirOverrides({})
    setBatchBrowseItemId('')
    setBatchBrowseEntries([])
    setBatchBrowsePath('')
    showToast('已清空当前链接列表')
  }

  async function browsePushTarget() {
    if (!api) return showToast('请在桌面版中使用目录选择')
    const selected = await api.choosePath()
    if (selected) {
      handleSetPushTarget(selected)
    }
  }

  async function handleViewFileDiff(fileItem) {
    if (!api?.getWorkspaceDiff || !pushTarget.trim() || !fileItem?.path) return
    try {
      const res = await api.getWorkspaceDiff({
        provider: pushProvider,
        target: pushTarget.trim(),
        filePath: fileItem.path
      })
      const diffLines = String(res?.diff || '无差异内容').split(/\r?\n/).slice(0, 180)
      const now = new Date().toISOString()
      setPushProgress((prev) => ({
        ...prev,
        logs: [
          ...prev.logs.slice(-220),
          { time: now, text: `========== Diff 预览: ${fileItem.displayPath} (${fileItem.label}) ==========`, source: 'stdout' },
          ...diffLines.map((line) => ({
            time: now,
            text: line,
            source: line.startsWith('-') && !line.startsWith('---')
              ? 'stderr'
              : line.startsWith('+') && !line.startsWith('+++')
              ? 'diff-add'
              : line.startsWith('@@')
              ? 'diff-hunk'
              : 'stdout'
          }))
        ]
      }))
      if (pushViewMode === 'changes') {
        setPushViewMode('split')
      }
    } catch (err) {
      showToast(appError(err))
    }
  }

  // 本地仓库工作区盘点方法
  async function scanWorkspaceNow(dir = workspaceRoot, silent = false) {
    const cleanDir = (dir || '').trim()
    if (!cleanDir) {
      if (!silent) showToast('请先选择要扫描的本地工作区根目录')
      return
    }
    if (!api?.scanLocalRepos) return
    setWorkspaceScanning(true)
    try {
      const res = await api.scanLocalRepos({ rootDir: cleanDir, checkRemote: false })
      const list = res?.repos || res?.repositories || []
      setWorkspaceRepos(list)
      setWorkspaceScanning(false)
      if (list.length > 0) {
        const remoteRes = await api.scanLocalRepos({
          rootDir: cleanDir,
          checkRemote: true,
          targets: list.map((r) => ({ target: r.target, provider: r.provider }))
        })
        const remoteList = remoteRes?.repos || remoteRes?.repositories || []
        if (remoteList.length > 0) {
          setWorkspaceRepos(remoteList)
          if (!silent) {
            const needUpdate = remoteList.filter((r) => r.remoteSync === 'behind' || r.remoteSync === 'diverged' || r.behind > 0).length
            showToast(
              needUpdate > 0
                ? `扫描完成：共 ${remoteList.length} 个仓库，发现 ${needUpdate} 个有远程新版本待更新`
                : `扫描完成：共 ${remoteList.length} 个仓库，本地与远程最新版本均一致`
            )
          }
          return
        }
      }
      if (!silent) {
        showToast(`扫描完成：共发现 ${list.length} 个本地仓库`)
      }
    } catch (err) {
      if (!silent) showToast(appError(err))
    } finally {
      setWorkspaceScanning(false)
    }
  }

  useEffect(() => {
    if (mode !== 'workspace' || !workspaceRoot.trim()) return
    const timer = window.setTimeout(() => {
      scanWorkspaceNow(workspaceRoot, true)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [mode, workspaceRoot])

  async function browseWorkspaceRoot() {
    if (!api) return showToast('请在桌面版中使用目录选择')
    const selected = await api.choosePath()
    if (selected) {
      handleSetWorkspaceRoot(selected)
      scanWorkspaceNow(selected, false)
    }
  }

  async function updateSingleWorkspaceRepo(repoItem) {
    if (!api || !repoItem || workspaceUpdatingMap[repoItem.target]?.status === 'running') return
    setWorkspaceUpdatingMap((prev) => ({ ...prev, [repoItem.target]: { status: 'running', message: '更新中' } }))
    workspaceRunningRef.current = true
    try {
      await api.runTask({
        provider: repoItem.provider,
        action: 'update',
        url: repoItem.url || '',
        target: repoItem.target,
        version: repoItem.provider === 'git'
          ? { kind: 'branch', name: repoItem.branch === 'HEAD' ? '' : (repoItem.branch || ''), label: repoItem.branch || 'HEAD' }
          : { kind: 'svn', revision: 'HEAD', sourceUrl: repoItem.url || '' }
      })
      recordRecentEntry({
        id: Date.now(),
        provider: repoItem.provider || 'git',
        action: 'update',
        version: repoItem.branch || 'HEAD',
        target: repoItem.target,
        url: repoItem.url || '',
        time: new Date().toISOString(),
        ok: true
      })
      setWorkspaceUpdatingMap((prev) => ({ ...prev, [repoItem.target]: { status: 'success', message: '已更新' } }))
      showToast(`${repoItem.name} 已更新至最新`)
      await scanWorkspaceNow(workspaceRoot, true)
    } catch (err) {
      setWorkspaceUpdatingMap((prev) => ({ ...prev, [repoItem.target]: { status: 'error', message: appError(err) } }))
      showToast(`${repoItem.name} 更新失败: ${appError(err)}`)
    } finally {
      workspaceRunningRef.current = false
    }
  }

  async function updateAllWorkspaceRepos(reposToUpdate = workspaceRepos) {
    if (!api || !reposToUpdate.length || workspaceBatchUpdating) return
    setWorkspaceBatchUpdating(true)
    workspaceRunningRef.current = true
    showToast(`开始批量更新 ${reposToUpdate.length} 个本地仓库...`)
    let okCount = 0
    let failCount = 0
    for (let i = 0; i < reposToUpdate.length; i++) {
      const repoItem = reposToUpdate[i]
      setWorkspaceUpdatingMap((prev) => ({ ...prev, [repoItem.target]: { status: 'running', message: '更新中' } }))
      try {
        await api.runTask({
          provider: repoItem.provider,
          action: 'update',
          url: repoItem.url || '',
          target: repoItem.target,
          version: repoItem.provider === 'git'
            ? { kind: 'branch', name: repoItem.branch === 'HEAD' ? '' : (repoItem.branch || ''), label: repoItem.branch || 'HEAD' }
            : { kind: 'svn', revision: 'HEAD', sourceUrl: repoItem.url || '' }
        })
        okCount++
        recordRecentEntry({
          id: Date.now() + i,
          provider: repoItem.provider || 'git',
          action: 'update',
          version: repoItem.branch || 'HEAD',
          target: repoItem.target,
          url: repoItem.url || '',
          time: new Date().toISOString(),
          ok: true
        })
        setWorkspaceUpdatingMap((prev) => ({ ...prev, [repoItem.target]: { status: 'success', message: '已更新' } }))
      } catch (err) {
        failCount++
        setWorkspaceUpdatingMap((prev) => ({ ...prev, [repoItem.target]: { status: 'error', message: appError(err) } }))
      }
    }
    workspaceRunningRef.current = false
    setWorkspaceBatchUpdating(false)
    await scanWorkspaceNow(workspaceRoot, true)
    showToast(`本地仓库全部更新完毕：成功 ${okCount} 个${failCount ? `，失败 ${failCount} 个` : ''}`)
  }

  function jumpToPushRepo(repoItem) {
    if (!repoItem) return
    setPushProvider(repoItem.provider || 'git')
    handleSetPushTarget(repoItem.target)
    if (repoItem.url) handleSetPushRemoteUrl(repoItem.url)
    if (repoItem.branch && repoItem.provider === 'git') setPushBranch(repoItem.branch)
    setMode('push')
    showToast(`已载入到代码推送：${repoItem.name}`)
  }

  function jumpToSingleRepo(repoItem) {
    if (!repoItem) return
    setProvider(repoItem.provider || 'git')
    setAction('update')
    handleSetTarget(repoItem.target)
    if (repoItem.url) handleSetUrl(repoItem.url)
    setMode('single')
    showToast(`已载入到单仓更新：${repoItem.name}`)
  }

  function jumpToReleaseRepo(repoItem) {
    if (!repoItem) return
    handleSetReleaseTarget(repoItem.target)
    if (repoItem.url) handleSetReleaseRemoteUrl(repoItem.url)
    if (repoItem.branch) setReleaseBranch(repoItem.branch)
    setMode('release')
    inspectReleaseWorkspaceNow(repoItem.target, false)
  }

  async function browseReleaseTarget() {
    if (!api) return showToast('请在桌面版中使用目录选择')
    const selected = await api.choosePath()
    if (selected) {
      handleSetReleaseTarget(selected)
      inspectReleaseWorkspaceNow(selected, false)
    }
  }

  async function addReleaseFiles() {
    if (!api?.chooseReleaseFiles) return showToast('请在桌面版中选择附件')
    const files = await api.chooseReleaseFiles()
    if (Array.isArray(files) && files.length > 0) {
      setReleaseAssets((prev) => {
        const seen = new Set(prev.map((a) => a.path))
        const added = files.filter((f) => !seen.has(f.path))
        return [...prev, ...added]
      })
      showToast(`已添加 ${files.length} 个发行版附件`)
    }
  }

  function removeReleaseAsset(filePath) {
    setReleaseAssets((prev) => prev.filter((a) => a.path !== filePath))
  }

  function updateReleaseAssetUploadName(filePath, newName) {
    setReleaseAssets((prev) =>
      prev.map((a) => (a.path === filePath ? { ...a, uploadName: newName } : a))
    )
  }

  function generateReleaseChangelog() {
    const title = releaseTitle.trim() || releaseTag.trim() || 'v1.4.6'
    const commits = releaseWorkspace?.recentCommits || '- 新增：常规功能升级与细节体验优化'
    const assetSection = releaseAssets.length > 0
      ? `\n### 📦 发行版附件\n${releaseAssets.map((a) => `- \`${a.uploadName || a.name}\` (${formatFileSize(a.size)})`).join('\n')}\n`
      : ''
    setReleaseNotes(`## ${title}\n\n### ✨ 更新内容\n${commits}\n${assetSection}`)
    showToast('已生成中文版本更新说明')
  }

  async function runReleaseTask() {
    if (running || batchRunning || pushRunning || releaseRunning) return
    if (!releaseRemoteUrl.trim()) return showToast('请先填写远程 GitHub / Gitee 仓库地址')
    if (!releaseTag.trim()) return showToast('请先填写 Release 版本标签（如 v1.4.6）')
    if (!api) return showToast('任务执行需要在桌面版中运行')

    setReleaseRunning(true)
    releaseRunningRef.current = true
    setReleasePublishedUrl('')
    if (releaseViewMode === 'assets') setReleaseViewMode('split')
    const initMap = {}
    releaseAssets.forEach((a) => {
      initMap[a.path] = { path: a.path, status: 'pending', percent: 0, uploadedBytes: 0, totalBytes: a.size, speed: '等待中' }
    })
    setReleaseAssetProgressMap(initMap)
    setReleaseProgress({
      value: 2,
      label: `正在启动 Release ${releaseTag.trim()} 发布任务...`,
      logs: [],
      status: 'running'
    })

    try {
      const res = await api.runTask({
        provider: 'git',
        action: 'release',
        target: releaseTarget.trim(),
        url: releaseRemoteUrl.trim(),
        tagName: releaseTag.trim(),
        releaseTitle: releaseTitle.trim() || releaseTag.trim(),
        releaseNotes: releaseNotes.trim(),
        targetCommitish: releaseBranch.trim() || 'main',
        draft: releaseDraft,
        prerelease: releasePrerelease,
        pushTag: releasePushTag,
        assets: releaseAssets,
        token: releaseToken.trim(),
        saveToken: true
      })

      if (res?.releaseUrl) {
        setReleasePublishedUrl(res.releaseUrl)
      }

      setReleaseProgress((current) => ({
        ...current,
        value: 100,
        label: `Release ${releaseTag.trim()} 发布完成`,
        status: 'success'
      }))
      setReleaseAssetProgressMap((prev) => {
        const next = { ...prev }
        releaseAssets.forEach((a) => {
          next[a.path] = {
            ...(next[a.path] || {}),
            path: a.path,
            status: 'done',
            percent: 100,
            uploadedBytes: a.size,
            totalBytes: a.size,
            speed: '完成'
          }
        })
        return next
      })

      recordRecentEntry({
        id: Date.now(),
        provider: 'git',
        action: 'release',
        version: `Release ${releaseTag.trim()}`,
        target: releaseTarget.trim() || releaseRemoteUrl.trim(),
        url: releaseRemoteUrl.trim(),
        time: new Date().toISOString(),
        ok: true
      })

      showToast(`🎉 Release ${releaseTag.trim()} 已成功发布！`)
    } catch (error) {
      setReleaseProgress((current) => ({
        ...current,
        status: 'error',
        label: appError(error)
      }))
      showToast(appError(error))
    } finally {
      setReleaseRunning(false)
      releaseRunningRef.current = false
    }
  }

  async function cancelReleaseTask() {
    if (api) {
      try { await api.cancelTask() } catch {}
    }
    showToast('正在停止 Release 发布与上传任务...')
  }

  async function runPushTask() {
    if (running || batchRunning || pushRunning) return
    if (!pushTarget.trim()) return showToast('请先选择本地项目目录')
    if (pushProvider === 'git' && !pushRemoteUrl.trim() && !pushWorkspace?.url) {
      return showToast('请先填写远程 Git 仓库地址')
    }
    if (!api) return showToast('任务执行需要在桌面版中运行')

    const allChanges = pushWorkspace?.changes || []
    if (pushCommitChanges && allChanges.length > 0 && pushSelectedFiles.length === 0 && (pushWorkspace?.ahead || 0) === 0) {
      return showToast('请至少勾选一个需要提交推送的改动文件')
    }

    setPushRunning(true)
    pushRunningRef.current = true
    if (pushViewMode === 'changes') setPushViewMode('split')
    setPushProgress({
      value: 2,
      label: `正在启动 ${pushProvider.toUpperCase()} 代码推送任务...`,
      logs: [],
      status: 'running'
    })

    const finalRemoteUrl = pushRemoteUrl.trim() || pushWorkspace?.url || ''
    const finalBranch = pushProvider === 'git' ? (pushBranch.trim() || 'main') : 'HEAD'
    const finalCommitMsg = pushCommitMsg.trim() || 'chore: sync code via CodeSync Studio'

    try {
      await api.runTask({
        provider: pushProvider,
        action: 'push',
        url: finalRemoteUrl,
        target: pushTarget.trim(),
        branch: finalBranch,
        commitMessage: finalCommitMsg,
        commitChanges: pushCommitChanges,
        pullBeforePush: pushProvider === 'git' ? pushPullBeforePush : false,
        selectedFiles: allChanges.length > 0 && pushSelectedFiles.length < allChanges.length
          ? pushSelectedFiles
          : allChanges.length > 0
          ? pushSelectedFiles
          : null,
        pushForce,
        pushTags,
        autoInit: true
      })

      recordRecentEntry({
        id: Date.now(),
        provider: pushProvider,
        action: 'push',
        version: pushProvider === 'git' ? `推送 -> ${finalBranch}` : 'SVN Commit',
        target: pushTarget.trim(),
        url: finalRemoteUrl,
        time: new Date().toISOString(),
        ok: true
      })

      setPushProgress((current) => ({
        ...current,
        value: 100,
        label: '代码推送完成',
        status: 'success'
      }))

      setPushCommitMsg('')
      await inspectPushWorkspaceNow(pushTarget.trim(), true)
      showToast('代码已成功推送到远程仓库')
    } catch (error) {
      setPushProgress((current) => ({
        ...current,
        status: 'error',
        label: appError(error)
      }))
      showToast(appError(error))
    } finally {
      setPushRunning(false)
      pushRunningRef.current = false
    }
  }

  async function cancelPushTask() {
    if (api) {
      try { await api.cancelTask() } catch {}
    }
    showToast('正在停止推送任务...')
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
      const isSvnActive =
        (mode === 'single' && provider === 'svn') ||
        (mode === 'batch' && batchProvider === 'svn') ||
        (mode === 'push' && pushProvider === 'svn')
      setCredentialTab(isSvnActive ? 'svn' : 'git')
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
      let testUrl = url
      if (mode === 'batch') {
        testUrl = batchItems[0]?.url || ''
      } else if (mode === 'push') {
        testUrl = pushRemoteUrl || pushWorkspace?.url || ''
      } else if (mode === 'release') {
        testUrl = releaseRemoteUrl || releaseWorkspace?.url || ''
      } else if (mode === 'workspace') {
        testUrl = workspaceRepos.find((r) => r.provider === credentialTab && r.url)?.url || ''
      }
      if (!testUrl && credentialTab === 'git') {
        testUrl = pushRemoteUrl || releaseRemoteUrl || url || 'https://github.com'
      }
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
    if (entry.action === 'release') {
      setMode('release')
      if (entry.target && !/^https?:\/\//i.test(entry.target)) handleSetReleaseTarget(entry.target)
      if (entry.url) handleSetReleaseRemoteUrl(entry.url)
      if (entry.version) {
        const cleanTag = entry.version.replace(/^Release\s+/i, '').trim()
        if (cleanTag) setReleaseTag(cleanTag)
      }
      showToast(`已载入版本发布：${entry.version || ''}`)
      return
    }
    if (entry.action === 'push') {
      setMode('push')
      setPushProvider(entry.provider || 'git')
      handleSetPushTarget(entry.target || '')
      if (entry.url) handleSetPushRemoteUrl(entry.url)
      showToast(`已载入推送工作区：${entry.target}`)
      return
    }
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
      <div className="window-titlebar">
        <div className="window-titlebar-left">
          <img src={logoUrl} alt="" />
          <span>CodeSync Studio</span>
        </div>
      </div>
      <div className="app-body">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark" title="CodeSync Studio">
            <img src={logoUrl} alt="CodeSync Studio" />
          </div>
          <span className="brand-badge">v1.4.6</span>
        </div>

        <nav className="side-nav">
          <button
            className={`side-nav-item ${mode === 'single' ? 'active' : ''}`}
            onClick={() => setMode('single')}
            title="单仓代码拉取与更新"
          >
            <HardDriveDownload size={18} />
            <span>单仓</span>
          </button>
          <button
            className={`side-nav-item ${mode === 'batch' ? 'active' : ''}`}
            onClick={() => setMode('batch')}
            title="多仓批量队列拉取"
          >
            <Layers size={18} />
            <span>批量</span>
          </button>
          <button
            className={`side-nav-item ${mode === 'push' ? 'active' : ''}`}
            onClick={() => setMode('push')}
            title="本地代码提交与推送"
          >
            <Upload size={18} />
            <span>推送</span>
          </button>
          <button
            className={`side-nav-item ${mode === 'release' ? 'active' : ''}`}
            onClick={() => setMode('release')}
            title="创建并发布 GitHub / Gitee Release 发行版"
          >
            <Rocket size={18} />
            <span>发布</span>
          </button>
          <button
            className={`side-nav-item ${mode === 'workspace' ? 'active' : ''}`}
            onClick={() => setMode('workspace')}
            title="本地多仓工作区盘点与批量更新"
          >
            <FolderOpen size={18} />
            <span>仓库</span>
            {workspaceRepos.length > 0 && <b>{workspaceRepos.length}</b>}
          </button>
          <button
            className={`side-nav-item ${mode === 'history' ? 'active' : ''}`}
            onClick={() => setMode('history')}
            title="历史同步记录"
          >
            <History size={18} />
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
            title="凭据与连接设置"
          >
            <Settings2 size={18} />
            <span>设置</span>
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-title">
            <div className="cockpit-id">
              <i />
              CODESYNC
            </div>
            <ChevronRight size={13} color="#64748b" />
            <strong>
              {mode === 'single'
                ? '单仓同步'
                : mode === 'batch'
                ? '批量拉取'
                : mode === 'push'
                ? '代码推送'
                : mode === 'release'
                ? '版本发布'
                : mode === 'workspace'
                ? '本地仓库'
                : '同步记录'}
            </strong>
          </div>
          <div className="mode-segmented">
            <button
              type="button"
              className={`mode-tab-btn ${mode === 'single' ? 'active' : ''}`}
              onClick={() => setMode('single')}
            >
              <HardDriveDownload size={13} />
              <span>单仓同步</span>
            </button>
            <button
              type="button"
              className={`mode-tab-btn ${mode === 'batch' ? 'active' : ''}`}
              onClick={() => setMode('batch')}
            >
              <Layers size={13} />
              <span>批量拉取</span>
            </button>
            <button
              type="button"
              className={`mode-tab-btn ${mode === 'push' ? 'active' : ''}`}
              onClick={() => setMode('push')}
            >
              <Upload size={13} />
              <span>代码推送</span>
            </button>
            <button
              type="button"
              className={`mode-tab-btn ${mode === 'release' ? 'active' : ''}`}
              onClick={() => setMode('release')}
            >
              <Rocket size={13} />
              <span>版本发布</span>
            </button>
            <button
              type="button"
              className={`mode-tab-btn ${mode === 'workspace' ? 'active' : ''}`}
              onClick={() => setMode('workspace')}
            >
              <FolderOpen size={13} />
              <span>本地仓库</span>
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
            <span className="runtime-badge"><span className="pulse" /> CLI 就绪</span>
            <button className="dpapi-badge" type="button" onClick={openCredentialSettings} title="点击配置 Git / SVN 凭据 (Windows DPAPI 加密)">
              <LockKeyhole size={11} /> 凭据配置
            </button>
          </div>
        </header>

        <div className="page-content">
          {mode === 'single' ? (
            <section className="sync-layout">
              <div className="sync-panel panel">
                <div className="panel-heading">
                  <h2>单仓配置</h2>
                  <span className="secure-label"><Check size={12} /> {provider.toUpperCase()} 引擎</span>
                </div>
                <div className="sync-panel-content">
                  <div className="batch-options-grid">
                    <div className="field-group" style={{ marginTop: 0 }}>
                      <label className="field-title">版本控制引擎</label>
                      <div className="segmented-control">
                        <button type="button" className={provider === 'git' ? 'selected git-selected' : ''} onClick={() => setProvider('git')}>
                          <GitBranch size={15} /> Git
                        </button>
                        <button type="button" className={provider === 'svn' ? 'selected svn-selected' : ''} onClick={() => setProvider('svn')}>
                          <Server size={15} /> SVN
                        </button>
                      </div>
                    </div>
                    <div className="field-group" style={{ marginTop: 0 }}>
                      <label className="field-title">操作模式</label>
                      <div className="segmented-control">
                        <button type="button" className={action === 'pull' ? 'selected' : ''} onClick={() => setAction('pull')}>
                          <ArrowDownToLine size={15} /> 克隆拉取
                        </button>
                        <button type="button" className={action === 'update' ? 'selected' : ''} onClick={() => setAction('update')}>
                          <RefreshCw size={15} /> 更新代码
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="field-group">
                    <div className="label-row">
                      <label className="field-title" htmlFor="repo-url">远程仓库地址</label>
                      {action === 'update' && <span>可选填</span>}
                    </div>
                    <div className="input-with-icon">
                      <Upload size={15} />
                      <input
                        id="repo-url"
                        value={url}
                        onChange={(event) => {
                          const val = event.target.value
                          handleSetUrl(val)
                          if (
                            /^svn(?:\+[a-z]+)?:\/\//i.test(val) ||
                            /\/(?:trunk|branches|tags)(?:\/|$)/i.test(val)
                          ) {
                            setProvider('svn')
                          } else if (/^git@/i.test(val) || /\.git$/i.test(val)) {
                            setProvider('git')
                          }
                        }}
                        onKeyDown={(event) => { if (event.key === 'Enter') probe() }}
                        placeholder={provider === 'git' ? 'https://github.com/org/repo.git 或 git@...' : 'https://svn.example.com/svn/project/trunk'}
                      />
                      <button type="button" onClick={pasteUrlFromClipboard} title="粘贴剪贴板地址">
                        <Copy size={14} />
                      </button>
                      <button type="button" className={probing ? 'loading-button' : ''} onClick={() => probe()} title="读取远程分支与版本" disabled={probing || !url.trim()}>
                        {probing ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}
                      </button>
                    </div>
                    {probeError && <div className="field-error"><AlertCircle size={14} />{probeError}</div>}
                  </div>

                  {repo && (
                    <div className="repo-discovery">
                      <RepoSummary repo={repo} provider={provider} />
                    </div>
                  )}

                  {versions.length > 0 && (
                    <div className="field-group">
                      <div className="label-row">
                        <label className="field-title" htmlFor="version-select">目标分支 / 版本</label>
                        <span>{versions.length} 个可选</span>
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

                  <div className="field-group">
                    <div className="label-row">
                      <label className="field-title" htmlFor="target-path">本地目标目录</label>
                    </div>
                    <div className="input-with-icon">
                      <FolderOpen size={15} />
                      <input
                        id="target-path"
                        value={target}
                        onChange={(event) => handleSetTarget(event.target.value)}
                        placeholder="D:\workspace\project-name"
                      />
                      <button type="button" onClick={browseTarget} title="选择本地文件夹"><FolderOpen size={15} /></button>
                    </div>

                    {action === 'update' && target.trim() && (
                      <div className="local-inspect-card">
                        <div className="local-inspect-title">
                          <span>{inspectingLocal ? '正在检测本地仓库...' : localInspect?.provider ? `${localInspect.provider.toUpperCase()} 工作副本` : '目录状态'}</span>
                        </div>
                        {localInspect?.error ? (
                          <div style={{ color: 'var(--crimson-text)', fontSize: '11px' }}>{localInspect.error}</div>
                        ) : localInspect?.provider ? (
                          <div className="local-inspect-details">
                            {localInspect.branch && <span>分支: <b>{localInspect.branch}</b></span>}
                            {localInspect.revision && <span>修订: <b>r{localInspect.revision}</b></span>}
                            {localInspect.url && <span title={localInspect.url}>远端: <b>{localInspect.url}</b></span>}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>

                  {provider === 'git' && action === 'pull' && (
                    <div className="field-group">
                      <div className="label-row">
                        <label className="field-title">克隆选项</label>
                      </div>
                      <div className="push-strategy-pills">
                        <button
                          type="button"
                          className={`push-strategy-pill ${shallowClone ? 'active' : ''}`}
                          onClick={() => setShallowClone(!shallowClone)}
                          disabled={running}
                          title="使用 --depth 1 仅拉取最新一次提交，大幅提升大仓库克隆速度"
                        >
                          <Zap size={11} /> 浅克隆 (--depth=1)
                        </button>
                        <button
                          type="button"
                          className={`push-strategy-pill ${recurseSubmodules ? 'active' : ''}`}
                          onClick={() => setRecurseSubmodules(!recurseSubmodules)}
                          disabled={running}
                          title="使用 --recurse-submodules 同步拉取所有 Git 子模块"
                        >
                          <Layers size={11} /> 包含子模块
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="advanced-options-wrapper">
                    <button
                      type="button"
                      className="advanced-toggle-btn"
                      onClick={() => {
                        const next = !showAdvanced
                        setShowAdvanced(next)
                        if (next && !repo && url.trim() && !probing) {
                          probe()
                        }
                      }}
                    >
                      <SlidersHorizontal size={13} />
                      <span>
                        子目录按需检出 {selectedPath ? `(仅: ${selectedPath})` : svnMainlineOnly ? '(仅主线 trunk)' : '(Sparse Checkout)'}
                      </span>
                      <ChevronDown size={13} style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }} />
                    </button>
                    {showAdvanced && (
                      <div className="advanced-options-content">
                        {repo ? (
                          <div className="field-group browse-group" style={{ marginTop: 4 }}>
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
                        ) : (
                          <div className="discovery-empty" style={{ minHeight: 54 }}>
                            {probing ? (
                              <>
                                <LoaderCircle size={13} className="spin" />
                                <span>正在读取远程仓库目录结构...</span>
                              </>
                            ) : (
                              <>
                                <Folder size={13} />
                                <span>输入仓库地址后点击放大镜即可浏览并勾选子目录</span>
                              </>
                            )}
                          </div>
                        )}
                        {provider === 'svn' && action === 'pull' && (
                          <div className={`mainline-option ${svnMainlineOnly ? 'enabled' : ''}`} style={{ marginTop: 6 }}>
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

                  {!showAdvanced && recent.length > 0 && (
                    <div className="single-quick-recent">
                      <div className="label-row">
                        <label className="field-title">最近同步快捷载入</label>
                        <button
                          type="button"
                          className="batch-text-btn"
                          onClick={() => setMode('history')}
                        >
                          全部 ({recent.length})
                        </button>
                      </div>
                      <div className="single-quick-list">
                        {recent.slice(0, 3).map((item) => (
                          <div key={item.id} className="single-quick-item" onClick={() => loadRecent(item)} title={`点击载入: ${item.target}`}>
                            <span className={`provider-badge ${item.provider}`}>
                              <span>{item.provider === 'git' ? 'G' : 'S'}</span>
                            </span>
                            <span className="single-quick-path">{item.target}</span>
                            <span className="single-quick-ver">{item.version || 'HEAD'}</span>
                            <button
                              type="button"
                              className="batch-icon-action"
                              onClick={(e) => { e.stopPropagation(); openLocalPath(item.target) }}
                              title="打开本地目录"
                            >
                              <FolderOpen size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="panel-actions">
                  <button className="primary-action" onClick={runTask} disabled={running}>
                    {running ? <LoaderCircle size={16} className="spin" /> : action === 'pull' ? <Download size={16} /> : <RefreshCw size={16} />}
                    {running ? '正在执行...' : action === 'pull' ? '开始拉取代码' : '开始更新代码'}
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
                onImportFile={handleImportUrlsFromFile}
                onCopyUrls={handleCopyBatchUrls}
                onClearUrls={clearBatchUrls}
                batchShowAdvanced={batchShowAdvanced}
                setBatchShowAdvanced={setBatchShowAdvanced}
                activeBatchBrowseItem={activeBatchBrowseItem}
                setBatchBrowseItemId={(id) => {
                  setBatchBrowseItemId(id)
                  const targetItem = batchItems.find((i) => i.id === id)
                  if (targetItem) navigateBatchBrowse('', targetItem)
                }}
                batchBrowseEntries={batchBrowseEntries}
                batchBrowsePath={batchBrowsePath}
                batchBrowseLoading={batchBrowseLoading}
                batchBrowseError={batchBrowseError}
                activeBatchSelectedSubdir={activeBatchSelectedSubdir}
                onNavigateBatchBrowse={navigateBatchBrowse}
                onSelectBatchBrowsePath={selectBatchBrowsePath}
                onApplySubdirToAll={handleApplySubdirToAll}
                itemSubdirOverrides={itemSubdirOverrides}
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
                itemSubdirOverrides={itemSubdirOverrides}
                onOpenItemSubdir={handleOpenBatchItemSubdir}
                onClearItemSubdir={(itemId) => handleItemSubdirChange(itemId, '')}
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
          ) : mode === 'push' ? (
            <section className="sync-layout">
              <PushSyncPanel
                pushProvider={pushProvider}
                setPushProvider={setPushProvider}
                pushTarget={pushTarget}
                setPushTarget={handleSetPushTarget}
                browsePushTarget={browsePushTarget}
                pushRemoteUrl={pushRemoteUrl}
                setPushRemoteUrl={handleSetPushRemoteUrl}
                pushBranch={pushBranch}
                setPushBranch={setPushBranch}
                pushCommitMsg={pushCommitMsg}
                setPushCommitMsg={setPushCommitMsg}
                pushCommitChanges={pushCommitChanges}
                setPushCommitChanges={setPushCommitChanges}
                pushPullBeforePush={pushPullBeforePush}
                setPushPullBeforePush={setPushPullBeforePush}
                pushForce={pushForce}
                setPushForce={setPushForce}
                pushTags={pushTags}
                setPushTags={setPushTags}
                pushWorkspace={pushWorkspace}
                pushInspecting={pushInspecting}
                pushInspectError={pushInspectError}
                pushSelectedFiles={pushSelectedFiles}
                pushRunning={pushRunning}
                onInspect={() => inspectPushWorkspaceNow(pushTarget, false)}
                onOpenLocalPath={openLocalPath}
                onStartPush={runPushTask}
              />

              <PushTaskPanel
                progress={pushProgress}
                running={pushRunning}
                elapsedSeconds={pushElapsed}
                cancelTask={cancelPushTask}
                clearLogs={() => setPushProgress((current) => ({ ...current, logs: [] }))}
                pushWorkspace={pushWorkspace}
                pushInspecting={pushInspecting}
                pushSelectedFiles={pushSelectedFiles}
                setPushSelectedFiles={setPushSelectedFiles}
                pushFilter={pushFilter}
                setPushFilter={setPushFilter}
                pushViewMode={pushViewMode}
                setPushViewMode={setPushViewMode}
                onRefreshWorkspace={() => inspectPushWorkspaceNow(pushTarget, false)}
                onOpenFolder={() => openLocalPath(pushTarget)}
                onViewFileDiff={handleViewFileDiff}
              />
            </section>
          ) : mode === 'release' ? (
            <section className="sync-layout">
              <ReleaseSyncPanel
                releaseTarget={releaseTarget}
                setReleaseTarget={handleSetReleaseTarget}
                browseReleaseTarget={browseReleaseTarget}
                releaseRemoteUrl={releaseRemoteUrl}
                setReleaseRemoteUrl={handleSetReleaseRemoteUrl}
                releaseTag={releaseTag}
                setReleaseTag={setReleaseTag}
                releaseTitle={releaseTitle}
                setReleaseTitle={setReleaseTitle}
                releaseBranch={releaseBranch}
                setReleaseBranch={setReleaseBranch}
                releaseNotes={releaseNotes}
                setReleaseNotes={setReleaseNotes}
                releaseToken={releaseToken}
                setReleaseToken={setReleaseToken}
                releasePushTag={releasePushTag}
                setReleasePushTag={setReleasePushTag}
                releasePrerelease={releasePrerelease}
                setReleasePrerelease={setReleasePrerelease}
                releaseDraft={releaseDraft}
                setReleaseDraft={setReleaseDraft}
                releaseWorkspace={releaseWorkspace}
                releaseInspecting={releaseInspecting}
                releaseAssets={releaseAssets}
                releaseRunning={releaseRunning}
                releaseProgress={releaseProgress}
                onInspect={() => inspectReleaseWorkspaceNow(releaseTarget, false)}
                onResetRelease={() => {
                  setReleaseProgress({ value: 0, label: '等待 Release 发布任务启动', logs: [], status: 'idle' })
                  setReleasePublishedUrl('')
                  setReleaseAssetProgressMap({})
                }}
                onGenerateChangelog={generateReleaseChangelog}
                onOpenLocalPath={openLocalPath}
                onStartRelease={runReleaseTask}
              />

              <ReleaseTaskPanel
                progress={releaseProgress}
                running={releaseRunning}
                elapsedSeconds={releaseElapsed}
                cancelTask={cancelReleaseTask}
                clearLogs={() => setReleaseProgress((current) => ({ ...current, logs: [] }))}
                releaseAssets={releaseAssets}
                releaseAssetProgressMap={releaseAssetProgressMap}
                onAddFiles={addReleaseFiles}
                onRescanAssets={() => inspectReleaseWorkspaceNow(releaseTarget, false)}
                onClearAssets={() => { setReleaseAssets([]); setReleaseAssetProgressMap({}) }}
                onRemoveAsset={removeReleaseAsset}
                onUpdateUploadName={updateReleaseAssetUploadName}
                onOpenFolder={openLocalPath}
                releasePublishedUrl={releasePublishedUrl}
                onOpenExternal={(u) => api?.openExternalUrl && api.openExternalUrl(u)}
                releaseViewMode={releaseViewMode}
                setReleaseViewMode={setReleaseViewMode}
              />
            </section>
          ) : mode === 'workspace' ? (
            <WorkspacePanel
              workspaceRoot={workspaceRoot}
              setWorkspaceRoot={handleSetWorkspaceRoot}
              onBrowseRoot={browseWorkspaceRoot}
              onScan={() => scanWorkspaceNow(workspaceRoot, false)}
              scanning={workspaceScanning}
              repos={workspaceRepos}
              filter={workspaceFilter}
              setFilter={setWorkspaceFilter}
              typeFilter={workspaceTypeFilter}
              setTypeFilter={setWorkspaceTypeFilter}
              updatingMap={workspaceUpdatingMap}
              batchUpdating={workspaceBatchUpdating}
              onUpdateSingle={updateSingleWorkspaceRepo}
              onUpdateAll={updateAllWorkspaceRepos}
              onJumpToPush={jumpToPushRepo}
              onJumpToRelease={jumpToReleaseRepo}
              onJumpToSingle={jumpToSingleRepo}
              onOpenFolder={openLocalPath}
            />
          ) : (
            <section className="history-layout">
              <div className="history-panel panel">
                <div className="history-toolbar">
                  <div className="history-search-wrap">
                    <Search size={14} color="#64748b" />
                    <input
                      className="history-search-input"
                      placeholder="搜索历史记录 (仓库地址 / 目录 / 分支)..."
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
                      showToast('已清空历史记录')
                    }}
                    disabled={!recent.length}
                  >
                    <Trash2 size={13} />
                    <span>清空记录</span>
                  </button>
                </div>

                <div className="history-table-container">
                  <div className="history-table-header">
                    <span>#</span>
                    <span>引擎</span>
                    <span>类型</span>
                    <span>远程仓库地址</span>
                    <span>分支 / 版本</span>
                    <span>本地目录</span>
                    <span>时间</span>
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
                              {entry.action === 'pull' ? '克隆' : entry.action === 'push' ? '推送' : entry.action === 'release' ? '发布' : '更新'}
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
                            title={`点击打开目录: ${entry.target}`}
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
                              title="载入此任务配置"
                            >
                              <RotateCcw size={13} />
                            </button>
                            <button
                              type="button"
                              className="history-action-btn"
                              onClick={() => openLocalPath(entry.target)}
                              title="打开本地文件夹"
                            >
                              <FolderOpen size={13} />
                            </button>
                            <button
                              type="button"
                              className="history-action-btn danger"
                              onClick={() => removeRecent(entry.id)}
                              title="删除记录"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="history-empty">
                        <History size={32} />
                        <h3>{recent.length ? '未找到匹配的记录' : '暂无同步记录'}</h3>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
      </div>

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
  onImportFile,
  onCopyUrls,
  onClearUrls,
  batchShowAdvanced,
  setBatchShowAdvanced,
  activeBatchBrowseItem,
  setBatchBrowseItemId,
  batchBrowseEntries,
  batchBrowsePath,
  batchBrowseLoading,
  batchBrowseError,
  activeBatchSelectedSubdir,
  onNavigateBatchBrowse,
  onSelectBatchBrowsePath,
  onApplySubdirToAll,
  itemSubdirOverrides
}) {
  const currentUrls = batchProvider === 'git' ? batchGitUrls : batchSvnUrls
  const setUrls = batchProvider === 'git' ? setBatchGitUrls : setBatchSvnUrls
  const failedCount = batchItems.filter((item) => batchItemStatuses[item.id]?.status === 'error').length
  const configuredSubdirCount = batchItems.filter((item) => {
    const val = itemSubdirOverrides?.[item.id] !== undefined ? itemSubdirOverrides[item.id] : item.parsedSubdir
    return Boolean(val && val.trim())
  }).length

  return (
    <div className="sync-panel batch-sync-panel panel">
      <div className="panel-heading">
        <h2>批量拉取配置</h2>
        <span className="secure-label"><Check size={12} /> {batchProvider.toUpperCase()} 队列</span>
      </div>

      <div className={`sync-panel-content batch-panel-content ${batchShowAdvanced ? 'advanced-open' : ''}`}>
        <div className="field-group">
          <div className="label-row">
            <label className="field-title">版本控制引擎</label>
          </div>
          <div className="segmented-control">
            <button
              type="button"
              className={batchProvider === 'git' ? 'selected git-selected' : ''}
              onClick={() => setBatchProvider('git')}
              disabled={batchRunning}
            >
              <GitBranch size={15} /> Git 批量拉取
            </button>
            <button
              type="button"
              className={batchProvider === 'svn' ? 'selected svn-selected' : ''}
              onClick={() => setBatchProvider('svn')}
              disabled={batchRunning}
            >
              <Server size={15} /> SVN 批量拉取
            </button>
          </div>
        </div>

        <div className="field-group batch-urls-group">
          <div className="label-row">
            <label className="field-title" htmlFor="batch-urls-input">
              {batchProvider === 'git' ? 'Git 仓库地址列表' : 'SVN 仓库地址列表'}
            </label>
            <span>已解析 <b>{batchItems.length}</b> 项</span>
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
                  ? "每行输入一个 Git 仓库地址 (可选附加分支与子目录)：\nhttps://github.com/org/repo-one.git\nhttps://github.com/org/repo-two.git dev src/core"
                  : "每行输入一个 SVN 仓库地址 (可选附加修订号或子目录)：\nhttps://svn.example.com/svn/project-a/trunk\nhttps://svn.example.com/svn/project-b/trunk 1024"
              }
            />
          </div>
          <div className="batch-textarea-toolbar">
            <div className="batch-textarea-actions">
              <button type="button" className="batch-text-btn" onClick={onImportFile} disabled={batchRunning} title="从本地 .txt 文本文件导入链接列表"><FolderOpen size={11} />导入文件</button>
              <button type="button" className="batch-text-btn" onClick={onInsertSamples} disabled={batchRunning} title="插入示例链接"><Sparkles size={11} />示例</button>
              <button type="button" className="batch-text-btn" onClick={onCleanUrls} disabled={batchRunning || !currentUrls.trim()} title="去除空行与重复链接"><RefreshCw size={11} />去重</button>
              <button type="button" className="batch-text-btn" onClick={onCopyUrls} disabled={!currentUrls.trim()} title="复制当前全部链接"><Copy size={11} />复制</button>
            </div>
            <button type="button" className="batch-text-btn danger" onClick={onClearUrls} disabled={batchRunning || !currentUrls.trim()} title="清空列表"><Trash2 size={11} />清空</button>
          </div>
          {protocolWarning && (
            <div className="batch-alert warning">
              <AlertCircle size={14} />
              <span>{protocolWarning}</span>
            </div>
          )}
        </div>

        <div className="advanced-options-wrapper batch-advanced-wrapper">
          <button
            type="button"
            className="advanced-toggle-btn"
            onClick={() => setBatchShowAdvanced(!batchShowAdvanced)}
          >
            <SlidersHorizontal size={13} />
            <span>
              子目录按需检出 {configuredSubdirCount > 0 ? `(已配 ${configuredSubdirCount} 项)` : '(Sparse Checkout)'}
            </span>
            <ChevronDown size={13} style={{ transform: batchShowAdvanced ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }} />
          </button>
          {batchShowAdvanced && (
            <div className="advanced-options-content batch-advanced-content">
              <div className="batch-browse-toolbar">
                <div className="select-wrap batch-browse-repo-select">
                  <Folder size={13} />
                  <select
                    value={activeBatchBrowseItem?.id || ''}
                    onChange={(e) => setBatchBrowseItemId(e.target.value)}
                    disabled={!batchItems.length || batchRunning}
                    title="选择要浏览目录树的仓库"
                  >
                    {batchItems.length ? (
                      batchItems.map((it, idx) => {
                        const sub = itemSubdirOverrides?.[it.id] !== undefined ? itemSubdirOverrides[it.id] : it.parsedSubdir
                        return (
                          <option key={it.id} value={it.id}>
                            #{idx + 1} {it.name}{sub ? ` (${sub})` : ''}
                          </option>
                        )
                      })
                    ) : (
                      <option value="">请先输入仓库地址</option>
                    )}
                  </select>
                  <ChevronDown size={12} />
                </div>
                <div className="input-with-icon batch-subdir-input">
                  <FolderOpen size={13} />
                  <input
                    value={activeBatchSelectedSubdir}
                    onChange={(e) => onSelectBatchBrowsePath(e.target.value)}
                    disabled={!activeBatchBrowseItem || batchRunning}
                    placeholder="选择或输入子目录 (如 src/core)"
                  />
                  {activeBatchSelectedSubdir && (
                    <button type="button" onClick={() => onSelectBatchBrowsePath('')} title="清除子目录">
                      <X size={12} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="batch-fetch-all-btn"
                  onClick={() => onApplySubdirToAll(activeBatchSelectedSubdir)}
                  disabled={!batchItems.length || batchRunning}
                  title="将该子目录应用到全部仓库"
                >
                  应用全部
                </button>
              </div>
              {activeBatchBrowseItem ? (
                <DirectoryBrowser
                  entries={batchBrowseEntries}
                  path={batchBrowsePath}
                  loading={batchBrowseLoading}
                  error={batchBrowseError}
                  selectedPath={activeBatchSelectedSubdir}
                  onNavigate={(p) => onNavigateBatchBrowse(p, activeBatchBrowseItem)}
                  onSelect={onSelectBatchBrowsePath}
                  action="pull"
                />
              ) : (
                <div className="discovery-empty" style={{ minHeight: 50 }}>
                  <Folder size={13} />
                  <span>请先在上方输入仓库地址后再浏览目录</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="field-group">
          <div className="label-row">
            <label className="field-title" htmlFor="batch-target-root">本地保存根目录</label>
          </div>
          <div className="input-with-icon">
            <FolderOpen size={15} />
            <input
              id="batch-target-root"
              value={batchTargetRoot}
              onChange={(e) => setBatchTargetRoot(e.target.value)}
              disabled={batchRunning}
              placeholder="D:\workspace\my-projects"
            />
            <button type="button" onClick={browseBatchTargetRoot} title="浏览选择根目录" disabled={batchRunning}>
              <FolderOpen size={15} />
            </button>
          </div>
        </div>

        <div className="batch-options-grid">
          <div className="field-group" style={{ marginTop: 0 }}>
            <div className="label-row">
              <label className="field-title" htmlFor="batch-conflict-select">已存在目录策略</label>
            </div>
            <div className="select-wrap">
              <RefreshCw size={14} />
              <select
                id="batch-conflict-select"
                value={batchConflictStrategy}
                onChange={(e) => setBatchConflictStrategy(e.target.value)}
                disabled={batchRunning}
              >
                <option value="update">自动增量更新</option>
                <option value="skip">跳过已有目录</option>
                <option value="error">标记错误并继续</option>
              </select>
              <ChevronDown size={14} />
            </div>
          </div>

          {batchProvider === 'git' ? (
            <div className="field-group" style={{ marginTop: 0 }}>
              <div className="label-row">
                <label className="field-title" htmlFor="batch-git-branch">全局默认分支</label>
                <button
                  type="button"
                  className="batch-text-btn"
                  onClick={onApplyGlobalBranch}
                  disabled={batchRunning || !batchGitBranch.trim()}
                >
                  应用全部
                </button>
              </div>
              <div className="input-with-icon">
                <GitBranch size={14} />
                <input
                  id="batch-git-branch"
                  value={batchGitBranch}
                  onChange={(e) => setBatchGitBranch(e.target.value)}
                  disabled={batchRunning}
                  placeholder="留空拉取默认主线"
                />
              </div>
            </div>
          ) : (
            <div className="field-group" style={{ marginTop: 0 }}>
              <div className="label-row">
                <label className="field-title">SVN 主线策略</label>
              </div>
              <div className={`mainline-option batch-mainline-option ${batchSvnMainlineOnly ? 'enabled' : ''}`}>
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={batchSvnMainlineOnly}
                    onChange={(e) => setBatchSvnMainlineOnly(e.target.checked)}
                    disabled={batchRunning}
                  />
                  <span className="fake-checkbox"><Check size={12} /></span>
                  <span className="mainline-copy">
                    <b>仅检出 trunk 主线</b>
                  </span>
                </label>
              </div>
            </div>
          )}
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
          {batchRunning ? '批量执行中...' : `开始批量拉取 (${batchItems.length})`}
        </button>

        {failedCount > 0 && (
          <button
            type="button"
            className="ghost-action"
            onClick={onRetryFailed}
            disabled={batchRunning}
            title="仅重试失败项目"
          >
            <RotateCcw size={14} />
            重试 ({failedCount})
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
  itemSubdirOverrides,
  onOpenItemSubdir,
  onClearItemSubdir,
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
          <div className="input-with-icon batch-filter-input">
            <Filter size={11} />
            <input
              placeholder="过滤项目名/分支..."
              value={batchFilter}
              onChange={(e) => setBatchFilter(e.target.value)}
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
        <span>版本/分支与子目录选择</span>
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

            const currentSubdir = itemSubdirOverrides?.[item.id] !== undefined
              ? itemSubdirOverrides[item.id]
              : (item.parsedSubdir || '')

            return (
              <div key={item.id} className={`batch-queue-item ${itemStatusClass}`}>
                <span className="batch-item-index">#{index + 1}</span>
                <span className="batch-item-name" title={item.name}>{item.name}</span>

                <div className="batch-version-select-wrap">
                  {isProbing ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--cyan-primary)', fontSize: 11, flex: 1 }}>
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

                  <button
                    type="button"
                    className={`batch-subdir-btn ${currentSubdir ? 'active' : ''}`}
                    onClick={() => onOpenItemSubdir(item)}
                    disabled={running}
                    title={currentSubdir ? `当前仅拉取子目录: ${currentSubdir}（点击修改）` : '点击按需选择只拉取某个子目录 (Sparse Checkout)'}
                  >
                    <Folder size={10} />
                    <span>{currentSubdir ? currentSubdir.split('/').pop() : '子目录'}</span>
                  </button>
                  {currentSubdir && (
                    <button
                      type="button"
                      className="batch-subdir-clear-btn"
                      onClick={() => onClearItemSubdir(item.id)}
                      disabled={running}
                      title={`取消子目录限制 (${currentSubdir})`}
                    >
                      <X size={9} />
                    </button>
                  )}
                </div>

                <span className="batch-item-target" title={currentSubdir ? `${item.target} (仅检出: ${currentSubdir})` : item.target}>
                  {item.target}
                </span>
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
            <Layers size={18} />
            <span>暂未解析到仓库地址</span>
            <small>在左侧文本框中输入或粘贴仓库链接后，列表将自动生成</small>
          </div>
        )}
      </div>
    </div>
  )

  const renderTerminal = (isSplit = false) => (
    <div className={`batch-terminal-container ${isSplit ? 'split-mode' : 'full-mode'}`}>
      <div className="terminal-window">
        <div className="terminal-header-dots batch-terminal-header">
          <div className="terminal-header-left">
            <span className="terminal-dot red" />
            <span className="terminal-dot yellow" />
            <span className="terminal-dot green" />
            <span className="terminal-title-label">
              <Terminal size={12} />
              <b>终端输出</b>
            </span>
          </div>
          <div className="log-tools">
            <button type="button" className={onlyErrors ? 'active-error' : ''} onClick={() => setOnlyErrors(!onlyErrors)}>
              <Filter size={11} />{onlyErrors ? '全部' : '仅错误'}
            </button>
            <button type="button" onClick={() => setAutoScroll(!autoScroll)}>
              {autoScroll ? '锁定滚动' : '跟随滚动'}
            </button>
            <button type="button" onClick={copyAllLogs} disabled={!progress.logs.length}>复制</button>
            <button type="button" onClick={clearLogs} disabled={!progress.logs.length}>清空</button>
          </div>
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
              <Terminal size={18} />
              <span>等待任务启动</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="task-panel batch-task-panel panel">
      <div className="panel-heading">
        <h2>批量队列与遥测</h2>
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
            <span>终端</span>
          </button>
          <button
            type="button"
            className={`batch-view-btn ${batchViewMode === 'split' ? 'active' : ''}`}
            onClick={() => setBatchViewMode('split')}
            title="分屏对照查看清单与终端"
          >
            <Columns2 size={12} />
            <span>分屏</span>
          </button>
        </div>
      </div>

      <div className="batch-telemetry-bar">
        <div className="batch-telemetry-status">
          <div className="progress-ring compact-ring">
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
          <div className="batch-telemetry-copy">
            <b>{progress.label}</b>
            <div className="bar-track compact-bar-track">
              <span style={{ width: `${Math.max(0, Math.min(100, progress.value))}%` }} />
            </div>
          </div>
        </div>
        <div className="batch-stats-row">
          <span className="batch-stats-item">总计 <b>{progress.totalCount || batchItems.length}</b></span>
          <span className="batch-stats-item success">成功 <b>{progress.successCount || 0}</b></span>
          <span className="batch-stats-item error">失败 <b>{progress.errorCount || 0}</b></span>
          <span className="batch-stats-item skipped">跳过 <b>{progress.skippedCount || 0}</b></span>
        </div>
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
        <span><Zap size={13} />{running ? `批量执行中 · ${formatDuration(elapsedSeconds)}` : '引擎就绪'}</span>
        {running && (
          <button className="stop-button" onClick={cancelTask}><Square size={13} />停止任务</button>
        )}
      </div>
    </div>
  )
}

function PushSyncPanel({
  pushProvider,
  setPushProvider,
  pushTarget,
  setPushTarget,
  browsePushTarget,
  pushRemoteUrl,
  setPushRemoteUrl,
  pushBranch,
  setPushBranch,
  pushCommitMsg,
  setPushCommitMsg,
  pushCommitChanges,
  setPushCommitChanges,
  pushPullBeforePush,
  setPushPullBeforePush,
  pushForce,
  setPushForce,
  pushTags,
  setPushTags,
  pushWorkspace,
  pushInspecting,
  pushInspectError,
  pushSelectedFiles,
  pushRunning,
  onInspect,
  onOpenLocalPath,
  onStartPush
}) {
  const commitTemplates = [
    { label: 'feat: 新功能', prefix: 'feat: ' },
    { label: 'fix: 修复', prefix: 'fix: ' },
    { label: 'chore: 维护', prefix: 'chore: ' },
    { label: 'docs: 文档', prefix: 'docs: ' },
    { label: 'refactor: 重构', prefix: 'refactor: ' }
  ]

  const applyPrefix = (prefix) => {
    setPushCommitMsg((prev) => {
      const stripped = prev.replace(/^(feat|fix|chore|docs|refactor|style|perf|test):\s*/i, '')
      return `${prefix}${stripped}`
    })
  }

  return (
    <div className="sync-panel batch-sync-panel push-sync-panel panel">
      <div className="panel-heading">
        <h2>代码推送配置</h2>
        <span className="secure-label"><Upload size={12} /> {pushProvider.toUpperCase()} 推送</span>
      </div>

      <div className="sync-panel-content batch-panel-content">
        <div className="field-group">
          <div className="label-row">
            <label className="field-title">版本控制引擎</label>
          </div>
          <div className="segmented-control">
            <button
              type="button"
              className={pushProvider === 'git' ? 'selected git-selected' : ''}
              onClick={() => setPushProvider('git')}
              disabled={pushRunning}
            >
              <GitBranch size={15} /> Git 代码推送
            </button>
            <button
              type="button"
              className={pushProvider === 'svn' ? 'selected svn-selected' : ''}
              onClick={() => setPushProvider('svn')}
              disabled={pushRunning}
            >
              <Server size={15} /> SVN 提交推送
            </button>
          </div>
        </div>

        <div className="field-group">
          <div className="label-row">
            <label className="field-title" htmlFor="push-target-input">本地项目目录</label>
          </div>
          <div className="input-with-icon">
            <FolderOpen size={15} />
            <input
              id="push-target-input"
              value={pushTarget}
              onChange={(e) => setPushTarget(e.target.value)}
              disabled={pushRunning}
              placeholder="D:\workspace\my-project"
            />
            <button type="button" onClick={browsePushTarget} title="选择本地项目文件夹" disabled={pushRunning}>
              <FolderOpen size={15} />
            </button>
            <button type="button" onClick={onInspect} title="重新扫描本地目录状态" disabled={pushRunning || !pushTarget.trim()}>
              <RefreshCw size={14} className={pushInspecting ? 'spin' : ''} />
            </button>
          </div>

          {pushTarget.trim() && (
            <div className="local-inspect-card push-inspect-card">
              <div className="local-inspect-title">
                <span>
                  {pushInspecting
                    ? '正在扫描工作区...'
                    : pushInspectError
                    ? '目录扫描异常'
                    : pushWorkspace?.initialized
                    ? `${pushWorkspace.provider?.toUpperCase()} 仓库 · ${pushWorkspace.changes?.length || 0} 项改动`
                    : `未初始化目录 · 自动 git init (${pushWorkspace?.changes?.length || 0} 个文件)`}
                </span>
              </div>
              {pushInspectError ? (
                <div style={{ color: 'var(--crimson-text)', fontSize: '11px' }}>{pushInspectError}</div>
              ) : pushWorkspace ? (
                <div className="local-inspect-details">
                  {pushWorkspace.branch && <span>分支: <b>{pushWorkspace.branch}</b></span>}
                  {pushWorkspace.ahead > 0 && <span>待推: <b style={{ color: 'var(--emerald-text)' }}>↑{pushWorkspace.ahead}</b></span>}
                  {pushWorkspace.lastCommit && <span title={pushWorkspace.lastCommit}>最新: <b>{pushWorkspace.lastCommit}</b></span>}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="field-group">
          <div className="label-row">
            <label className="field-title" htmlFor="push-remote-url">
              远程 Git 仓库地址 (origin)
            </label>
            <span>填写目标仓库，提交时自动关联</span>
          </div>
          <div className="input-with-icon">
            <Upload size={15} />
            <input
              id="push-remote-url"
              value={pushRemoteUrl}
              onChange={(e) => setPushRemoteUrl(e.target.value)}
              disabled={pushRunning}
              placeholder="https://github.com/org/repo.git 或 git@github.com:org/repo.git"
            />
          </div>
        </div>

        {pushProvider === 'git' && (
          <div className="field-group">
            <div className="label-row">
              <label className="field-title">推送策略</label>
              <span>按需开启，全部为可选组合</span>
            </div>
            <div className="push-strategy-pills">
              <button
                type="button"
                className={`push-strategy-pill ${pushCommitChanges ? 'active' : ''}`}
                onClick={() => setPushCommitChanges(!pushCommitChanges)}
                disabled={pushRunning}
                title="推送前自动暂存并提交已勾选的改动文件"
              >
                <Check size={11} />自动提交
              </button>
              <button
                type="button"
                className={`push-strategy-pill ${pushPullBeforePush ? 'active' : ''}`}
                onClick={() => setPushPullBeforePush(!pushPullBeforePush)}
                disabled={pushRunning || pushForce}
                title="推送前先执行 git pull --rebase 同步远端提交，防止冲突"
              >
                <RefreshCw size={10} />先拉再推
              </button>
              <button
                type="button"
                className={`push-strategy-pill warning ${pushForce ? 'active' : ''}`}
                onClick={() => setPushForce(!pushForce)}
                disabled={pushRunning}
                title="使用 --force-with-lease 安全强推"
              >
                <Zap size={11} />强推
              </button>
              <button
                type="button"
                className={`push-strategy-pill ${pushTags ? 'active' : ''}`}
                onClick={() => setPushTags(!pushTags)}
                disabled={pushRunning}
                title="同时推送本地所有标签 (--tags)"
              >
                <GitCommitHorizontal size={11} />标签
              </button>
            </div>
          </div>
        )}

        {pushProvider === 'git' && (
          <div className="batch-options-grid">
            <div className="field-group" style={{ marginTop: 0 }}>
              <div className="label-row">
                <label className="field-title" htmlFor="push-branch-input">推送分支</label>
                <span>{pushWorkspace?.branch ? `当前: ${pushWorkspace.branch}` : '默认 main'}</span>
              </div>
              <div className="input-with-icon">
                <GitBranch size={14} />
                <input
                  id="push-branch-input"
                  value={pushBranch}
                  onChange={(e) => setPushBranch(e.target.value)}
                  disabled={pushRunning}
                  placeholder="main / master / dev"
                />
                {pushWorkspace?.branches?.length > 0 && (
                  <div className="inline-branch-picker" title="点击切换本地已有分支">
                    <ChevronDown size={13} />
                    <select
                      value={pushWorkspace.branches.includes(pushBranch) ? pushBranch : ''}
                      onChange={(e) => { if (e.target.value) setPushBranch(e.target.value) }}
                      disabled={pushRunning}
                    >
                      {!pushWorkspace.branches.includes(pushBranch) && (
                        <option value="">{pushBranch || '选择分支'}</option>
                      )}
                      {pushWorkspace.branches.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            <div className="field-group" style={{ marginTop: 0 }}>
              <div className="label-row">
                <label className="field-title">推送范围</label>
                <span>{pushWorkspace?.ahead > 0 ? `本地待推 ${pushWorkspace.ahead} 提交` : '改动文件与提交'}</span>
              </div>
              <div className="input-with-icon">
                <Upload size={14} />
                <input
                  value={pushWorkspace?.parsedRepo ? `${pushWorkspace.parsedRepo.owner}/${pushWorkspace.parsedRepo.repo}` : ''}
                  readOnly
                  tabIndex={-1}
                  className="readonly-repo-field"
                  title={pushWorkspace?.parsedRepo ? `${pushWorkspace.parsedRepo.owner}/${pushWorkspace.parsedRepo.repo} (${pushWorkspace.parsedRepo.platform})` : '选择本地目录后自动识别远程仓库'}
                  placeholder="选择本地目录后自动识别"
                />
                {pushWorkspace?.parsedRepo?.platform && (
                  <span className="push-stage-tag">{pushWorkspace.parsedRepo.platform.toUpperCase()}</span>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="field-group batch-urls-group">
          <div className="label-row">
            <label className="field-title" htmlFor="push-commit-msg">提交说明 (Commit Message)</label>
            <span>已选 <b>{pushSelectedFiles.length}</b> 项</span>
          </div>
          <div className="batch-textarea-wrap">
            <textarea
              id="push-commit-msg"
              className="batch-textarea"
              value={pushCommitMsg}
              onChange={(e) => setPushCommitMsg(e.target.value)}
              disabled={pushRunning || (pushProvider === 'git' && !pushCommitChanges)}
              placeholder={
                pushProvider === 'git' && !pushCommitChanges
                  ? '当前为「仅推送已有提交」模式，无需填写提交说明'
                  : '输入本次提交说明，例如：feat: 更新核心模块代码（留空使用默认说明）'
              }
            />
          </div>
          <div className="batch-textarea-toolbar">
            <div className="batch-textarea-actions">
              {commitTemplates.map((tpl) => (
                <button
                  key={tpl.prefix}
                  type="button"
                  className="batch-text-btn"
                  onClick={() => applyPrefix(tpl.prefix)}
                  disabled={pushRunning}
                >
                  {tpl.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="batch-text-btn danger"
              onClick={() => setPushCommitMsg('')}
              disabled={pushRunning || !pushCommitMsg}
            >
              <Trash2 size={11} />清空
            </button>
          </div>
        </div>
      </div>

      <div className="panel-actions">
        <button
          type="button"
          className="primary-action"
          onClick={onStartPush}
          disabled={pushRunning || !pushTarget.trim()}
        >
          {pushRunning ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />}
          {pushRunning
            ? '正在推送...'
            : `开始推送代码${pushSelectedFiles.length ? ` (${pushSelectedFiles.length})` : ''}`}
        </button>
        <button
          type="button"
          className="ghost-action"
          onClick={onInspect}
          disabled={pushRunning || !pushTarget.trim()}
        >
          <RefreshCw size={14} />刷新
        </button>
      </div>
    </div>
  )
}

function PushTaskPanel({
  progress,
  running,
  elapsedSeconds,
  cancelTask,
  clearLogs,
  pushWorkspace,
  pushInspecting,
  pushSelectedFiles,
  setPushSelectedFiles,
  pushFilter,
  setPushFilter,
  pushViewMode,
  setPushViewMode,
  onRefreshWorkspace,
  onOpenFolder,
  onViewFileDiff
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

  const allChanges = pushWorkspace?.changes || []
  const filteredChanges = useMemo(() => {
    if (!pushFilter.trim()) return allChanges
    const q = pushFilter.toLowerCase().trim()
    return allChanges.filter((c) => c.displayPath.toLowerCase().includes(q) || c.label.toLowerCase().includes(q))
  }, [allChanges, pushFilter])

  const selectedSet = useMemo(() => new Set(pushSelectedFiles), [pushSelectedFiles])
  const allSelected = allChanges.length > 0 && pushSelectedFiles.length === allChanges.length
  const untrackedCount = allChanges.filter((c) => c.status === 'U' || c.status === 'A').length

  const toggleSelectFile = (filePath) => {
    setPushSelectedFiles((prev) => (prev.includes(filePath) ? prev.filter((p) => p !== filePath) : [...prev, filePath]))
  }

  const toggleSelectAll = () => {
    if (allSelected) {
      setPushSelectedFiles([])
    } else {
      setPushSelectedFiles(allChanges.map((c) => c.path))
    }
  }

  const statusClass =
    progress.status === 'success' ? 'success' :
    progress.status === 'error' ? 'error' :
    running ? 'running' : 'idle'

  const renderChangesList = (isSplit = false) => (
    <div className={`batch-queue-container ${isSplit ? 'split-mode' : 'full-mode'}`}>
      <div className="batch-queue-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>变更文件清单 (<b>{allChanges.length}</b>)</span>
          {allChanges.length > 0 && (
            <button
              type="button"
              className="batch-text-btn"
              onClick={toggleSelectAll}
              disabled={running}
            >
              <Check size={11} />
              {allSelected ? '取消全选' : '全选'}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="input-with-icon batch-filter-input">
            <Filter size={11} />
            <input
              placeholder="过滤文件..."
              value={pushFilter}
              onChange={(e) => setPushFilter(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="batch-fetch-all-btn"
            onClick={onRefreshWorkspace}
            disabled={running || pushInspecting}
          >
            <RefreshCw size={11} className={pushInspecting ? 'spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      <div className="batch-queue-col-headers push-changes-col-headers">
        <span style={{ textAlign: 'center' }}>选</span>
        <span>状态</span>
        <span>文件相对路径</span>
        <span style={{ textAlign: 'right' }}>操作</span>
      </div>

      <div className="batch-queue-list">
        {filteredChanges.length ? (
          filteredChanges.map((item) => {
            const checked = selectedSet.has(item.path)
            return (
              <div
                key={item.path}
                className={`batch-queue-item push-change-item ${checked ? 'selected' : ''}`}
                onClick={() => !running && toggleSelectFile(item.path)}
              >
                <span className="push-check-cell">
                  <span className={`fake-checkbox ${checked ? 'checked' : ''}`}>
                    {checked && <Check size={10} />}
                  </span>
                </span>
                <span>
                  <span className={`push-file-badge status-${item.status}`}>
                    <b>{item.status}</b> {item.label}
                  </span>
                </span>
                <span className="batch-item-name push-file-path" title={item.displayPath}>
                  {item.displayPath}
                </span>
                <div className="push-row-actions" onClick={(e) => e.stopPropagation()}>
                  {item.committed ? (
                    <span className="push-stage-tag">待推提交</span>
                  ) : (
                    item.staged && <span className="push-stage-tag">已暂存</span>
                  )}
                  <button
                    type="button"
                    className="batch-subdir-btn"
                    onClick={() => onViewFileDiff && onViewFileDiff(item)}
                    title="在下方终端中查看该文件的代码差异 (Diff)"
                  >
                    <FileText size={10} />
                    <span>Diff</span>
                  </button>
                </div>
              </div>
            )
          })
        ) : (
          <div className="batch-queue-empty">
            <CheckCircle2 size={18} />
            <span>{pushWorkspace ? '工作区干净，无未提交改动' : '请先在左侧选择本地项目目录'}</span>
            {pushWorkspace?.ahead > 0 && (
              <small>检测到 {pushWorkspace.ahead} 个待推提交，可直接点击左侧开始推送</small>
            )}
          </div>
        )}
      </div>
    </div>
  )

  const renderTerminal = (isSplit = false) => (
    <div className={`batch-terminal-container ${isSplit ? 'split-mode' : 'full-mode'}`}>
      <div className="terminal-window">
        <div className="terminal-header-dots batch-terminal-header">
          <div className="terminal-header-left">
            <span className="terminal-dot red" />
            <span className="terminal-dot yellow" />
            <span className="terminal-dot green" />
            <span className="terminal-title-label">
              <Terminal size={12} />
              <b>推送与 Diff 终端</b>
            </span>
          </div>
          <div className="log-tools">
            <button type="button" className={onlyErrors ? 'active-error' : ''} onClick={() => setOnlyErrors(!onlyErrors)}>
              <Filter size={11} />{onlyErrors ? '全部' : '仅错误'}
            </button>
            <button type="button" onClick={() => setAutoScroll(!autoScroll)}>
              {autoScroll ? '锁定滚动' : '跟随滚动'}
            </button>
            <button type="button" onClick={copyAllLogs} disabled={!progress.logs.length}>复制</button>
            <button type="button" onClick={clearLogs} disabled={!progress.logs.length}>清空</button>
          </div>
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
              <Terminal size={18} />
              <span>等待推送任务或点击文件 Diff 预览</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="task-panel batch-task-panel panel">
      <div className="panel-heading">
        <h2>工作区变更与遥测</h2>
        <div className="batch-view-segmented">
          <button
            type="button"
            className={`batch-view-btn ${pushViewMode === 'changes' ? 'active' : ''}`}
            onClick={() => setPushViewMode('changes')}
          >
            <Layers size={12} />
            <span>变更 ({allChanges.length})</span>
          </button>
          <button
            type="button"
            className={`batch-view-btn ${pushViewMode === 'telemetry' ? 'active' : ''}`}
            onClick={() => setPushViewMode('telemetry')}
          >
            <Terminal size={12} />
            <span>终端</span>
          </button>
          <button
            type="button"
            className={`batch-view-btn ${pushViewMode === 'split' ? 'active' : ''}`}
            onClick={() => setPushViewMode('split')}
          >
            <Columns2 size={12} />
            <span>分屏</span>
          </button>
        </div>
      </div>

      <div className="batch-telemetry-bar">
        <div className="batch-telemetry-status">
          <div className="progress-ring compact-ring">
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
          <div className="batch-telemetry-copy">
            <b>{progress.label}</b>
            <div className="bar-track compact-bar-track">
              <span style={{ width: `${Math.max(0, Math.min(100, progress.value))}%` }} />
            </div>
          </div>
        </div>
        <div className="batch-stats-row">
          <span className="batch-stats-item">变动 <b>{allChanges.length}</b></span>
          <span className="batch-stats-item success">已选 <b>{pushSelectedFiles.length}</b></span>
          <span className="batch-stats-item skipped">新增 <b>{untrackedCount}</b></span>
          <span className="batch-stats-item">待推 <b>{pushWorkspace?.ahead || 0}</b></span>
        </div>
      </div>

      <div className="batch-views-body">
        {pushViewMode === 'changes' && renderChangesList(false)}
        {pushViewMode === 'telemetry' && renderTerminal(false)}
        {pushViewMode === 'split' && (
          <div className="batch-split-layout">
            {renderChangesList(true)}
            {renderTerminal(true)}
          </div>
        )}
      </div>

      <div className="task-bottom">
        <span><Zap size={13} />{running ? `正在推送 · ${formatDuration(elapsedSeconds)}` : '引擎就绪'}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {progress.status === 'success' && pushWorkspace?.root && (
            <button className="ghost-action" onClick={onOpenFolder} style={{ height: 26, padding: '0 10px', fontSize: 11 }}>
              <FolderOpen size={12} />打开目录
            </button>
          )}
          {running && (
            <button className="stop-button" onClick={cancelTask}><Square size={13} />停止推送</button>
          )}
        </div>
      </div>
    </div>
  )
}

function WorkspacePanel({
  workspaceRoot,
  setWorkspaceRoot,
  onBrowseRoot,
  onScan,
  scanning,
  repos,
  filter,
  setFilter,
  typeFilter,
  setTypeFilter,
  updatingMap,
  batchUpdating,
  onUpdateSingle,
  onUpdateAll,
  onJumpToPush,
  onJumpToRelease,
  onJumpToSingle,
  onOpenFolder
}) {
  const filteredRepos = useMemo(() => {
    return repos.filter((r) => {
      if (typeFilter === 'git' && r.provider !== 'git') return false
      if (typeFilter === 'svn' && r.provider !== 'svn') return false
      if (typeFilter === 'behind' && !(r.remoteSync === 'behind' || r.remoteSync === 'diverged' || r.behind > 0 || r.remoteSync === 'detached')) return false
      if (typeFilter === 'dirty' && !(r.changesCount > 0)) return false
      if (typeFilter === 'ahead' && !(r.ahead > 0 || r.remoteSync === 'ahead')) return false
      if (!filter.trim()) return true
      const q = filter.toLowerCase().trim()
      return (
        r.name.toLowerCase().includes(q) ||
        (r.relPath && r.relPath.toLowerCase().includes(q)) ||
        (r.branch && r.branch.toLowerCase().includes(q)) ||
        (r.url && r.url.toLowerCase().includes(q))
      )
    })
  }, [repos, filter, typeFilter])

  const gitCount = repos.filter((r) => r.provider === 'git').length
  const svnCount = repos.filter((r) => r.provider === 'svn').length
  const needUpdateCount = repos.filter((r) => r.remoteSync === 'behind' || r.remoteSync === 'diverged' || r.behind > 0 || r.remoteSync === 'detached').length
  const dirtyCount = repos.filter((r) => r.changesCount > 0).length
  const aheadCount = repos.filter((r) => r.ahead > 0 || r.remoteSync === 'ahead').length

  return (
    <section className="history-layout workspace-layout">
      <div className="history-panel workspace-panel panel">
        <div className="workspace-top-bar">
          <div className="workspace-root-box">
            <div className="input-with-icon workspace-root-input">
              <FolderOpen size={15} />
              <input
                value={workspaceRoot}
                onChange={(e) => setWorkspaceRoot(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onScan() }}
                placeholder="选择本地工作区根目录，自动扫描旗下所有 Git / SVN 仓库 (如 D:\workspace)"
              />
              <button type="button" onClick={onBrowseRoot} title="浏览选择工作区根目录">
                <FolderOpen size={15} />
              </button>
            </div>
            <button
              type="button"
              className="ghost-action workspace-scan-btn"
              onClick={onScan}
              disabled={scanning || batchUpdating}
            >
              <RefreshCw size={14} className={scanning ? 'spin' : ''} />
              <span>{scanning ? '扫描中...' : '扫描仓库'}</span>
            </button>
            <button
              type="button"
              className="primary-action workspace-update-all-btn"
              onClick={() => onUpdateAll(filteredRepos)}
              disabled={scanning || batchUpdating || !filteredRepos.length}
            >
              {batchUpdating ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
              <span>{batchUpdating ? '正在批量更新...' : `一键更新全部 (${filteredRepos.length})`}</span>
            </button>
          </div>

          <div className="workspace-filter-bar">
            <div className="history-search-wrap" style={{ maxWidth: 320 }}>
              <Search size={14} color="#64748b" />
              <input
                className="history-search-input"
                placeholder="过滤仓库名称 / 分支 / 远程地址..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              {filter && (
                <button type="button" className="clear-filter-btn" onClick={() => setFilter('')}>
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="history-filter-pills">
              <button
                type="button"
                className={`history-filter-pill ${typeFilter === 'all' ? 'active' : ''}`}
                onClick={() => setTypeFilter('all')}
              >
                全部 ({repos.length})
              </button>
              <button
                type="button"
                className={`history-filter-pill ${typeFilter === 'behind' ? 'active' : ''} ${needUpdateCount > 0 ? 'has-alert' : ''}`}
                onClick={() => setTypeFilter('behind')}
              >
                需更新 ({needUpdateCount})
              </button>
              <button
                type="button"
                className={`history-filter-pill ${typeFilter === 'dirty' ? 'active' : ''}`}
                onClick={() => setTypeFilter('dirty')}
              >
                有改动 ({dirtyCount})
              </button>
              <button
                type="button"
                className={`history-filter-pill ${typeFilter === 'ahead' ? 'active' : ''}`}
                onClick={() => setTypeFilter('ahead')}
              >
                待推送 ({aheadCount})
              </button>
              <button
                type="button"
                className={`history-filter-pill ${typeFilter === 'git' ? 'active' : ''}`}
                onClick={() => setTypeFilter('git')}
              >
                <GitBranch size={11} /> Git ({gitCount})
              </button>
              <button
                type="button"
                className={`history-filter-pill ${typeFilter === 'svn' ? 'active' : ''}`}
                onClick={() => setTypeFilter('svn')}
              >
                <Server size={11} /> SVN ({svnCount})
              </button>
            </div>
          </div>
        </div>

        <div className="history-table-container workspace-table-container">
          <div className="history-table-header workspace-table-header">
            <span>#</span>
            <span>引擎</span>
            <span>仓库名称</span>
            <span>当前分支 / 修订</span>
            <span>工作区状态</span>
            <span>远程同步状态</span>
            <span>远程仓库地址</span>
            <span>本地路径</span>
            <span style={{ textAlign: 'center' }}>快捷操作</span>
          </div>

          <div className="history-table-body">
            {scanning ? (
              <div className="history-empty">
                <LoaderCircle size={32} className="spin" />
                <h3>正在扫描本地工作区仓库...</h3>
              </div>
            ) : filteredRepos.length ? (
              filteredRepos.map((item, idx) => {
                const upState = updatingMap[item.target]
                const isUpdating = upState?.status === 'running'
                const needsUpdate = item.remoteSync === 'behind' || item.remoteSync === 'diverged' || item.behind > 0 || item.remoteSync === 'detached'
                return (
                  <div className="history-table-row workspace-table-row" key={item.target}>
                    <span className="history-col-index">#{idx + 1}</span>
                    <span>
                      <span className={`provider-badge ${item.provider}`}>
                        <span>{item.provider === 'git' ? 'G' : 'S'}</span>
                        {item.provider.toUpperCase()}
                      </span>
                    </span>
                    <span className="workspace-col-name" title={item.name}>
                      <b>{item.name}</b>
                    </span>
                    <span>
                      <span className="history-version-badge" title={item.isDetached ? `当前处于游离状态，主分支: ${item.branch}` : `当前分支: ${item.branch}`}>
                        <GitBranch size={11} />
                        {item.branch || 'HEAD'}
                      </span>
                    </span>
                    <div className="workspace-col-status">
                      {item.changesCount > 0 ? (
                        <span className="workspace-status-pill dirty" title={`${item.changesCount} 个本地文件存在未提交改动`}>
                          {item.changesCount} 项改动
                        </span>
                      ) : (
                        <span className="workspace-status-pill clean">干净</span>
                      )}
                      {upState?.status === 'error' && (
                        <span className="workspace-status-pill dirty" title={upState.message}>失败</span>
                      )}
                    </div>
                    <div className="workspace-col-remote-sync">
                      {isUpdating ? (
                        <span className="workspace-status-pill checking">
                          <LoaderCircle size={10} className="spin" /> 正在同步远程...
                        </span>
                      ) : item.remoteSync === 'checking' ? (
                        <span className="workspace-status-pill checking" title="正在对比本地提交与远程分支最新提交...">
                          <LoaderCircle size={10} className="spin" /> 检测远程...
                        </span>
                      ) : item.remoteSync === 'behind' || (item.behind > 0 && !(item.ahead > 0)) ? (
                        <>
                          <span
                            className="workspace-status-pill need-update"
                            title={`远程分支有新版本！本地 (${item.localHash || '-'}) 落后远程 (${item.remoteHash || '-'}) ${item.behind || 1} 个提交，建议点击右侧「更新」`}
                          >
                            <Download size={10} /> 需更新{item.behind > 0 ? ` · 落后 ${item.behind}` : ''}
                          </span>
                          {(item.localHash || item.remoteHash) && (
                            <span className="workspace-hash-tag diff" title={`本地最新: ${item.localHash || '?'} → 远程最新: ${item.remoteHash || '?'}`}>
                              {item.localHash || '?'} → {item.remoteHash || '?'}
                            </span>
                          )}
                        </>
                      ) : item.remoteSync === 'diverged' || (item.behind > 0 && item.ahead > 0) ? (
                        <>
                          <span
                            className="workspace-status-pill need-update"
                            title={`本地超前 ${item.ahead} 个提交且落后远程 ${item.behind} 个提交 (本地: ${item.localHash || '-'} / 远程: ${item.remoteHash || '-'})`}
                          >
                            ⇅ 需同步 (↓{item.behind} ↑{item.ahead})
                          </span>
                        </>
                      ) : item.remoteSync === 'ahead' || item.ahead > 0 ? (
                        <>
                          <span
                            className="workspace-status-pill ahead"
                            title={`本地比远程分支超前 ${item.ahead || 1} 个提交 (本地: ${item.localHash || '-'} / 远程: ${item.remoteHash || '-'})，可点击「推送」上传`}
                          >
                            <Upload size={10} /> 待推送 · 超前 {item.ahead || 1}
                          </span>
                          {item.localHash && (
                            <span className="workspace-hash-tag" title={`本地最新提交: ${item.lastCommit || item.localHash}`}>
                              {item.localHash}
                            </span>
                          )}
                        </>
                      ) : item.remoteSync === 'detached' ? (
                        <span
                          className="workspace-status-pill dirty"
                          title="本地仓库处于游离分支 (Detached HEAD)，点击右侧「更新」可自动切回默认主线并同步最新代码"
                        >
                          游离分支 · 需切回主线
                        </span>
                      ) : item.remoteSync === 'synced' ? (
                        <>
                          <span
                            className="workspace-status-pill synced"
                            title={`本地提交 (${item.localHash || 'HEAD'}) 与远程分支 (${item.remoteHash || item.branch}) 最新内容完全一致，无需更新`}
                          >
                            <Check size={10} /> 与远程一致
                          </span>
                          {item.localHash && (
                            <span className="workspace-hash-tag" title={`最新提交: ${item.lastCommit || item.localHash}`}>
                              {item.localHash}
                            </span>
                          )}
                        </>
                      ) : item.remoteSync === 'no-remote' ? (
                        <span className="workspace-status-pill clean">未配置远程</span>
                      ) : (
                        <span className="workspace-status-pill clean" title="暂时无法连接远程仓库获取最新哈希">
                          远程未响应
                        </span>
                      )}
                    </div>
                    <span className="history-col-url" title={item.url || '未配置远程地址'}>
                      {item.url || '-'}
                    </span>
                    <span
                      className="history-col-path"
                      onClick={() => onOpenFolder(item.target)}
                      title={`点击打开目录: ${item.target}`}
                    >
                      {item.target}
                    </span>
                    <div className="history-col-actions workspace-col-actions">
                      <button
                        type="button"
                        className={`workspace-action-btn ${needsUpdate ? 'needs-update' : ''}`}
                        onClick={() => onUpdateSingle(item)}
                        disabled={isUpdating || batchUpdating}
                        title={needsUpdate ? '检测到远程有新版本，点击立即拉取更新' : '立即拉取更新该仓库'}
                      >
                        {isUpdating ? <LoaderCircle size={12} className="spin" /> : <RefreshCw size={12} />}
                        <span>更新</span>
                      </button>
                      <button
                        type="button"
                        className="workspace-action-btn push"
                        onClick={() => onJumpToPush(item)}
                        title="在【代码推送】中打开该仓库"
                      >
                        <Upload size={12} />
                        <span>推送</span>
                      </button>
                      {item.provider === 'git' && onJumpToRelease && (
                        <button
                          type="button"
                          className="workspace-action-btn release"
                          onClick={() => onJumpToRelease(item)}
                          title="在【版本发布】中为此仓库发布 Release"
                        >
                          <Rocket size={12} />
                          <span>发布</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="history-action-btn"
                        onClick={() => onJumpToSingle(item)}
                        title="在【单仓同步】中载入该仓库"
                      >
                        <ArrowUpRight size={13} />
                      </button>
                      <button
                        type="button"
                        className="history-action-btn"
                        onClick={() => onOpenFolder(item.target)}
                        title="在资源管理器中打开文件夹"
                      >
                        <FolderOpen size={13} />
                      </button>
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="history-empty">
                <FolderOpen size={34} />
                <h3>{repos.length ? '未找到符合过滤条件的仓库' : '选择工作区根目录即可一键盘点所有本地仓库'}</h3>
                <p>自动识别目录下所有 Git 与 SVN 仓库的分支、未提交改动数与待推送状态，支持一键批量更新或直达推送。</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
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
        <div className="dir-search-bar">
          <Search size={12} />
          <input
            placeholder="搜索当前目录下文件/文件夹..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
          {filterText && (
            <button type="button" className="dir-search-clear" onClick={() => setFilterText('')} title="清除搜索">
              <X size={10} />
            </button>
          )}
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
          <b>{provider === 'git' ? 'Git 仓库' : 'SVN 仓库'}</b>
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
            <span><GitCommitHorizontal size={12} /><b>r{repo.latestRevision || 'HEAD'}</b> 最新</span>
            <span><Server size={12} /><b>{repo.directories?.length || 0}</b> 目录</span>
            <span><strong>{repo.revisions?.length || 0}</strong> 提交</span>
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
    progress.status === 'success' ? '已完成' :
    progress.status === 'error' ? '执行失败' :
    running ? '执行中' : '就绪'

  const statusClass =
    progress.status === 'success' ? 'success' :
    progress.status === 'error' ? 'error' :
    running ? 'running' : 'idle'

  return (
    <div className="task-panel panel">
      <div className="panel-heading">
        <h2>实时遥测与终端</h2>
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
          <span>{running ? `已耗时 ${formatDuration(elapsedSeconds)}` : progress.status === 'success' ? '代码同步已完成' : '终端实时输出'}</span>
        </div>
      </div>
      <div className="bar-track"><span style={{ width: `${Math.max(0, Math.min(100, progress.value))}%` }} /></div>
      <div className="log-heading">
        <span><Terminal size={13} />终端输出</span>
        <div className="log-tools">
          <button type="button" className={onlyErrors ? 'active-error' : ''} onClick={() => setOnlyErrors(!onlyErrors)}>
            <Filter size={11} />{onlyErrors ? '全部' : '仅错误'}
          </button>
          <button type="button" onClick={() => setAutoScroll(!autoScroll)}>
            {autoScroll ? '锁定滚动' : '跟随滚动'}
          </button>
          <button type="button" onClick={copyAllLogs} disabled={!progress.logs.length}>复制</button>
          <button type="button" onClick={clearLogs} disabled={!progress.logs.length}>清空</button>
        </div>
      </div>
      <div className="terminal-window">
        <div className="terminal-header-dots">
          <span className="terminal-dot red" />
          <span className="terminal-dot yellow" />
          <span className="terminal-dot green" />
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
              <span>等待任务启动</span>
            </div>
          )}
        </div>
      </div>
      <div className="task-bottom">
        <span><Zap size={13} />{running ? `执行中 · ${formatDuration(elapsedSeconds)}` : '引擎就绪'}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {progress.status === 'success' && targetPath && (
            <button className="ghost-action" onClick={onOpenPath} style={{ height: 30, padding: '0 12px', fontSize: 12 }}>
              <FolderOpen size={13} />打开目录
            </button>
          )}
          {running && (
            <button className="stop-button" onClick={cancelTask}><Square size={13} />停止任务</button>
          )}
        </div>
      </div>
    </div>
  )
}

function ReleaseSyncPanel({
  releaseTarget,
  setReleaseTarget,
  browseReleaseTarget,
  releaseRemoteUrl,
  setReleaseRemoteUrl,
  releaseTag,
  setReleaseTag,
  releaseTitle,
  setReleaseTitle,
  releaseBranch,
  setReleaseBranch,
  releaseNotes,
  setReleaseNotes,
  releaseToken,
  setReleaseToken,
  releasePushTag,
  setReleasePushTag,
  releasePrerelease,
  setReleasePrerelease,
  releaseDraft,
  setReleaseDraft,
  releaseWorkspace,
  releaseInspecting,
  releaseAssets,
  releaseRunning,
  releaseProgress,
  onInspect,
  onResetRelease,
  onGenerateChangelog,
  onOpenLocalPath,
  onStartRelease
}) {
  const platformName = releaseWorkspace?.parsedRepo?.platform === 'gitee' ? 'Gitee' : 'GitHub'
  const repoLabel = releaseWorkspace?.parsedRepo
    ? `${releaseWorkspace.parsedRepo.owner}/${releaseWorkspace.parsedRepo.repo}`
    : ''

  return (
    <div className="sync-panel panel">
      <div className="panel-heading">
        <h2>版本发布</h2>
        <span className="secure-label"><Rocket size={12} /> {platformName}</span>
      </div>

      <div className="sync-panel-content batch-panel-content">
        <div className="field-group">
          <div className="label-row">
            <label className="field-title">本地项目目录</label>
            {releaseWorkspace?.branch && <span>当前分支: <b>{releaseWorkspace.branch}</b></span>}
          </div>
          <div className="input-with-icon">
            <FolderOpen size={15} />
            <input
              value={releaseTarget}
              onChange={(e) => setReleaseTarget(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onInspect() }}
              placeholder="D:\workspace\project-name"
              disabled={releaseRunning}
            />
            <button type="button" onClick={browseReleaseTarget} title="选择本地项目目录" disabled={releaseRunning}>
              <FolderOpen size={14} />
            </button>
            <button
              type="button"
              className={releaseInspecting ? 'loading-button' : ''}
              onClick={onInspect}
              title="重新读取版本与打包产物"
              disabled={releaseRunning || releaseInspecting || !releaseTarget.trim()}
            >
              <RefreshCw size={14} className={releaseInspecting ? 'spin' : ''} />
            </button>
          </div>
        </div>

        <div className="field-group">
          <div className="label-row">
            <label className="field-title">远程仓库地址</label>
            {repoLabel && <span style={{ color: 'var(--cyan-primary)' }}>{repoLabel}</span>}
          </div>
          <div className="input-with-icon">
            <Upload size={15} />
            <input
              value={releaseRemoteUrl}
              onChange={(e) => setReleaseRemoteUrl(e.target.value)}
              placeholder="https://github.com/owner/repo.git"
              disabled={releaseRunning}
            />
          </div>
        </div>

        <div className="batch-options-grid">
          <div className="field-group" style={{ marginTop: 0 }}>
            <div className="label-row">
              <label className="field-title">版本标签</label>
            </div>
            <div className="input-with-icon">
              <Tag size={14} />
              <input
                value={releaseTag}
                onChange={(e) => setReleaseTag(e.target.value)}
                placeholder="v1.4.6"
                disabled={releaseRunning}
              />
            </div>
          </div>

          <div className="field-group" style={{ marginTop: 0 }}>
            <div className="label-row">
              <label className="field-title">目标分支</label>
            </div>
            <div className="input-with-icon">
              <GitBranch size={14} />
              <input
                value={releaseBranch}
                onChange={(e) => setReleaseBranch(e.target.value)}
                placeholder="main"
                disabled={releaseRunning}
              />
              {releaseWorkspace?.branches?.length > 0 && (
                <div className="inline-branch-picker" title="点击切换本地已有分支">
                  <ChevronDown size={13} />
                  <select
                    value={releaseWorkspace.branches.includes(releaseBranch) ? releaseBranch : ''}
                    onChange={(e) => { if (e.target.value) setReleaseBranch(e.target.value) }}
                    disabled={releaseRunning}
                  >
                    {!releaseWorkspace.branches.includes(releaseBranch) && (
                      <option value="">{releaseBranch || '选择分支'}</option>
                    )}
                    {releaseWorkspace.branches.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="batch-options-grid">
          <div className="field-group" style={{ marginTop: 0 }}>
            <div className="label-row">
              <label className="field-title">发布标题</label>
            </div>
            <div className="input-with-icon">
              <Rocket size={14} />
              <input
                value={releaseTitle}
                onChange={(e) => setReleaseTitle(e.target.value)}
                placeholder="CodeSync Studio v1.4.6"
                disabled={releaseRunning}
              />
            </div>
          </div>

          <div className="field-group" style={{ marginTop: 0 }}>
            <div className="label-row">
              <label className="field-title">访问令牌</label>
              {releaseWorkspace?.tokenConfigured && <span style={{ color: 'var(--emerald-text)' }}>已存加密凭据</span>}
            </div>
            <div className="input-with-icon">
              <KeyRound size={14} />
              <input
                type="password"
                value={releaseToken}
                onChange={(e) => setReleaseToken(e.target.value)}
                placeholder={releaseWorkspace?.tokenConfigured ? '默认使用已存 Token' : 'GitHub / Gitee Token'}
                disabled={releaseRunning}
              />
            </div>
          </div>
        </div>

        <div className="field-group batch-urls-group">
          <div className="label-row release-notes-header-row">
            <label className="field-title">更新说明</label>
            <div className="release-inline-options">
              <button
                type="button"
                className={`release-mini-pill ${releasePushTag ? 'active' : ''}`}
                onClick={() => setReleasePushTag(!releasePushTag)}
                disabled={releaseRunning}
                title="发布前自动在本地创建并向远程推送该 Git Tag"
              >
                <Tag size={10} />推送标签
              </button>
              <button
                type="button"
                className={`release-mini-pill ${releasePrerelease ? 'active' : ''}`}
                onClick={() => setReleasePrerelease(!releasePrerelease)}
                disabled={releaseRunning}
                title="标记为预发布版本 (Pre-release)"
              >
                <Sparkles size={10} />预发布
              </button>
              <button
                type="button"
                className={`release-mini-pill ${releaseDraft ? 'active' : ''}`}
                onClick={() => setReleaseDraft(!releaseDraft)}
                disabled={releaseRunning}
                title="保存为草稿 (Draft) 而不立即公开"
              >
                <FileText size={10} />草稿
              </button>
            </div>
          </div>
          <div className="batch-textarea-wrap">
            <textarea
              className="batch-textarea"
              value={releaseNotes}
              onChange={(e) => setReleaseNotes(e.target.value)}
              placeholder="输入本次版本更新内容..."
              disabled={releaseRunning}
            />
          </div>
          <div className="batch-textarea-toolbar">
            <div className="batch-textarea-actions">
              <button
                type="button"
                className="batch-text-btn"
                onClick={onGenerateChangelog}
                disabled={releaseRunning}
              >
                <Sparkles size={11} />自动生成
              </button>
              <button
                type="button"
                className="batch-text-btn"
                onClick={() => setReleaseNotes((prev) => `${prev ? prev + '\n' : ''}### 🚀 新增特性\n- \n\n### 🛠️ 问题修复\n- \n`)}
                disabled={releaseRunning}
              >
                + 章节模板
              </button>
            </div>
            <button
              type="button"
              className="batch-text-btn danger"
              onClick={() => setReleaseNotes('')}
              disabled={releaseRunning || !releaseNotes}
            >
              <Trash2 size={11} />清空
            </button>
          </div>
        </div>
      </div>

      <div className="panel-actions">
        <button className="primary-action" onClick={onStartRelease} disabled={releaseRunning || !releaseTarget.trim()}>
          {releaseRunning ? <LoaderCircle size={16} className="spin" /> : <Rocket size={16} />}
          {releaseRunning ? `正在发布 (${Math.round(releaseProgress.value || 0)}%)...` : `开始发布 ${releaseTag || 'Release'}`}
        </button>
        <button
          type="button"
          className="ghost-action"
          onClick={() => {
            setReleaseNotes('')
            setReleaseToken('')
            setReleasePrerelease(false)
            setReleaseDraft(false)
            setReleasePushTag(true)
            if (onResetRelease) onResetRelease()
            if (releaseTarget.trim()) onInspect()
          }}
          disabled={releaseRunning}
        >
          <X size={14} />重置
        </button>
      </div>
    </div>
  )
}

function ReleaseTaskPanel({
  progress,
  running,
  elapsedSeconds,
  cancelTask,
  clearLogs,
  releaseAssets,
  releaseAssetProgressMap,
  onAddFiles,
  onRescanAssets,
  onClearAssets,
  onRemoveAsset,
  onUpdateUploadName,
  onOpenFolder,
  releasePublishedUrl,
  onOpenExternal,
  releaseViewMode,
  setReleaseViewMode
}) {
  const [autoScroll, setAutoScroll] = useState(true)
  const [onlyErrors, setOnlyErrors] = useState(false)
  const terminalRef = useRef(null)

  const filteredLogs = useMemo(() => {
    if (!onlyErrors) return progress.logs
    return progress.logs.filter((line) => line.source === 'stderr' || /error|fail|fatal|失败|错误|拒绝/i.test(line.text))
  }, [progress.logs, onlyErrors])

  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [filteredLogs, autoScroll])

  const statusClass =
    progress.status === 'success' ? 'success' :
    progress.status === 'error' ? 'error' :
    running ? 'running' : 'idle'

  const totalBytes = releaseAssets.reduce((acc, a) => acc + (Number(a.size) || 0), 0)
  const doneAssetsCount = releaseAssets.filter((a) => releaseAssetProgressMap[a.path]?.status === 'done').length

  function copyAllLogs() {
    if (!progress.logs.length) return
    const content = progress.logs
      .map((l) => `[${new Date(l.time).toLocaleTimeString('zh-CN', { hour12: false })}] ${l.text}`)
      .join('\n')
    navigator.clipboard?.writeText(content)
  }

  const renderAssetsTable = (isSplit = false) => (
    <div className={`batch-queue-container ${isSplit ? 'split-mode' : 'full-mode'}`}>
      <div className="batch-queue-header">
        <span>发行版附件 (<b>{releaseAssets.length}</b>)</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="batch-fetch-all-btn"
            onClick={onAddFiles}
            disabled={running}
            title="从本地选择要上传到 Release 的安装包或压缩包"
          >
            <Plus size={11} />
            添加附件
          </button>
          <button
            type="button"
            className="batch-text-btn"
            onClick={onRescanAssets}
            disabled={running}
            title="自动扫描项目目录下的打包产物"
          >
            <RefreshCw size={11} />
            扫描产物
          </button>
          {releaseAssets.length > 0 && (
            <button
              type="button"
              className="batch-text-btn danger"
              onClick={onClearAssets}
              disabled={running}
              title="清空附件列表"
            >
              <Trash2 size={11} />
              清空
            </button>
          )}
        </div>
      </div>

      <div className="batch-queue-col-headers release-assets-col-headers">
        <span>#</span>
        <span>附件名称</span>
        <span>大小</span>
        <span>上传进度</span>
        <span style={{ textAlign: 'right' }}>操作</span>
      </div>

      <div className="batch-queue-list">
        {releaseAssets.length > 0 ? (
          releaseAssets.map((item, idx) => {
            const p = releaseAssetProgressMap[item.path]
            const st = p?.status || 'idle'
            const pct = p?.percent ?? 0
            return (
              <div className={`batch-queue-item release-asset-item ${st}`} key={item.path}>
                <span className="batch-item-index">#{idx + 1}</span>
                <div style={{ minWidth: 0 }}>
                  <input
                    className="release-asset-name-input"
                    value={item.uploadName || item.name}
                    onChange={(e) => onUpdateUploadName(item.path, e.target.value)}
                    disabled={running}
                    title={`本地路径: ${item.path}`}
                  />
                </div>
                <span className="release-col-size">{formatFileSize(item.size)}</span>
                <div className="release-col-progress">
                  <div className="release-asset-bar">
                    <span
                      className={`release-asset-bar-fill ${st}`}
                      style={{ width: `${st === 'done' ? 100 : pct}%` }}
                    />
                  </div>
                  <span className={`release-asset-status-text ${st}`}>
                    {st === 'uploading'
                      ? `${pct}%${p?.speed ? ` · ${p.speed}` : ''}`
                      : st === 'done'
                      ? '已完成'
                      : st === 'error'
                      ? '失败'
                      : st === 'pending'
                      ? '等待中'
                      : '待上传'}
                  </span>
                </div>
                <div className="batch-item-actions">
                  <button
                    type="button"
                    className="batch-icon-action"
                    onClick={() => onOpenFolder(item.path)}
                    title="打开所在目录"
                  >
                    <FolderOpen size={12} />
                  </button>
                  <button
                    type="button"
                    className="batch-icon-action danger"
                    onClick={() => onRemoveAsset(item.path)}
                    disabled={running}
                    title="移除此附件"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            )
          })
        ) : (
          <div className="batch-queue-empty">
            <Package size={18} />
            <span>暂未添加附件</span>
            <small>点击右上角「添加附件」或「扫描产物」载入安装包</small>
          </div>
        )}
      </div>
    </div>
  )

  const renderTerminal = (isSplit = false) => (
    <div className={`batch-terminal-container ${isSplit ? 'split-mode' : 'full-mode'}`}>
      <div className="terminal-window">
        <div className="terminal-header-dots batch-terminal-header">
          <div className="terminal-header-left">
            <span className="terminal-dot red" />
            <span className="terminal-dot yellow" />
            <span className="terminal-dot green" />
            <span className="terminal-title-label">
              <Terminal size={12} />
              <b>发布终端</b>
            </span>
          </div>
          <div className="log-tools">
            <button type="button" className={onlyErrors ? 'active-error' : ''} onClick={() => setOnlyErrors(!onlyErrors)}>
              <Filter size={11} />{onlyErrors ? '全部' : '仅错误'}
            </button>
            <button type="button" onClick={() => setAutoScroll(!autoScroll)}>
              {autoScroll ? '锁定滚动' : '跟随滚动'}
            </button>
            <button type="button" onClick={copyAllLogs} disabled={!progress.logs.length}>复制</button>
            <button type="button" onClick={clearLogs} disabled={!progress.logs.length}>清空</button>
          </div>
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
              <Terminal size={18} />
              <span>等待发布任务启动</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="task-panel batch-task-panel panel">
      <div className="panel-heading">
        <h2>发布进度与附件</h2>
        <div className="batch-view-segmented">
          <button
            type="button"
            className={`batch-view-btn ${releaseViewMode === 'assets' ? 'active' : ''}`}
            onClick={() => setReleaseViewMode('assets')}
          >
            <Package size={12} />
            <span>附件 ({releaseAssets.length})</span>
          </button>
          <button
            type="button"
            className={`batch-view-btn ${releaseViewMode === 'telemetry' ? 'active' : ''}`}
            onClick={() => setReleaseViewMode('telemetry')}
          >
            <Terminal size={12} />
            <span>终端</span>
          </button>
          <button
            type="button"
            className={`batch-view-btn ${releaseViewMode === 'split' ? 'active' : ''}`}
            onClick={() => setReleaseViewMode('split')}
          >
            <Columns2 size={12} />
            <span>分屏</span>
          </button>
        </div>
      </div>

      <div className="batch-telemetry-bar">
        <div className="batch-telemetry-status">
          <div className="progress-ring compact-ring">
            <svg viewBox="0 0 42 42">
              <circle className="ring-track" cx="21" cy="21" r="17" />
              <circle
                className={`ring-value ${statusClass}`}
                cx="21"
                cy="21"
                r="17"
                pathLength="100"
                strokeDasharray={`${Math.max(0, Math.min(100, progress.value || 0))} 100`}
              />
            </svg>
            <strong>{Math.round(progress.value || 0)}<small>%</small></strong>
          </div>
          <div className="batch-telemetry-copy">
            <b>{progress.label}</b>
            <div className="bar-track compact-bar-track">
              <span style={{ width: `${Math.max(0, Math.min(100, progress.value || 0))}%` }} />
            </div>
          </div>
        </div>
        <div className="batch-stats-row">
          <span className="batch-stats-item">附件 <b>{releaseAssets.length}</b></span>
          <span className="batch-stats-item success">已传 <b>{doneAssetsCount}</b></span>
          <span className="batch-stats-item">体积 <b>{formatFileSize(totalBytes)}</b></span>
        </div>
      </div>

      <div className="batch-views-body">
        {releaseViewMode === 'assets' && renderAssetsTable(false)}
        {releaseViewMode === 'telemetry' && renderTerminal(false)}
        {releaseViewMode === 'split' && (
          <div className="batch-split-layout">
            {renderAssetsTable(true)}
            {renderTerminal(true)}
          </div>
        )}
      </div>

      <div className="task-bottom">
        <span><Zap size={13} />{running ? `正在发布 · ${formatDuration(elapsedSeconds)}` : '引擎就绪'}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {releasePublishedUrl && (
            <button
              className="ghost-action"
              onClick={() => onOpenExternal(releasePublishedUrl)}
              style={{ height: 26, padding: '0 10px', fontSize: 11, color: 'var(--cyan-primary)', borderColor: 'rgba(0, 240, 255, 0.35)' }}
            >
              <ExternalLink size={12} />查看 Release
            </button>
          )}
          {running && (
            <button className="stop-button" onClick={cancelTask}><Square size={13} />停止发布</button>
          )}
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)

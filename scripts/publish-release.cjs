const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { spawnSync } = require('child_process')

function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim()
  const res = spawnSync('git', ['-c', 'credential.helper=', '-c', 'credential.helper=manager', 'credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8'
  })
  const token = res.stdout.split('\n').find((l) => l.startsWith('password='))?.slice(9).trim()
  if (!token) throw new Error('Could not find GitHub token in Git Credential Manager')
  return token
}

function getProxyAgent() {
  // Connect via 127.0.0.1:7890 if available
  try {
    return new https.Agent({ keepAlive: true })
  } catch {
    return undefined
  }
}

function apiRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body)
          resolve({ status: res.statusCode, headers: res.headers, data: parsed, raw: body })
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: body })
        }
      })
    })
    req.on('error', reject)
    if (postData) req.write(postData)
    req.end()
  })
}

function uploadAsset(uploadUrlTemplate, filePath, assetName, token) {
  return new Promise((resolve, reject) => {
    const uploadUrl = uploadUrlTemplate.replace(/\{\?name,label\}/, `?name=${encodeURIComponent(assetName)}`)
    const parsed = new URL(uploadUrl)
    const stats = fs.statSync(filePath)
    console.log(`Uploading ${assetName} (${(stats.size / 1024 / 1024).toFixed(1)} MB)...`)

    const options = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'User-Agent': 'CodeSync-Studio-Publisher',
        Authorization: `token ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': stats.size
      }
    }

    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`Successfully uploaded ${assetName}`)
          resolve(JSON.parse(body))
        } else {
          reject(new Error(`Upload failed (${res.statusCode}): ${body}`))
        }
      })
    })

    req.on('error', reject)

    const stream = fs.createReadStream(filePath)
    let uploaded = 0
    let lastLog = Date.now()
    stream.on('data', (chunk) => {
      uploaded += chunk.length
      if (Date.now() - lastLog > 2000) {
        const pct = Math.round((uploaded / stats.size) * 100)
        console.log(`Progress [${assetName}]: ${pct}%`)
        lastLog = Date.now()
      }
    })
    stream.pipe(req)
  })
}

async function main() {
  const token = getGitHubToken()
  const repo = 'CGW-Dev1/code-sync-studio'
  const tag = 'v1.4.0'
  const title = 'CodeSync Studio v1.4.0'
  const body = `## CodeSync Studio v1.4.0

### ✨ 新增功能与核心升级
- **新增「代码推送」工作台**：
  - 支持本地 Git 与 SVN 工作区变更自动扫描、状态统计与文件列表过滤。
  - 支持按需勾选待提交文件、填写 Commit 信息并一键提交推送至远程仓库。
  - 内置文件级 **Diff 差异预览弹窗**（语法着色展示新增/删除行），支持 Git **先拉再推（\`pull --rebase\`）**、附带标签推送（\`--tags\`）与强制推送（\`--force-with-lease\`）。
- **新增「本地仓库」管家菜单**：
  - 支持一键扫描指定工作区根目录下的所有本地 Git / SVN 仓库。
  - 集中展示各仓库引擎类型、当前分支/版本、待提交变更数及远端地址，支持单仓更新、**一键更新全部本地仓库**以及一键跳转至推送/单仓面板。
- **批量拉取支持「子目录按需检出（Sparse Checkout）」**：
  - 与单仓模式体验完全一致，支持为批量队列中的每个仓库独立浏览远程目录树并指定只拉取某个子目录，也支持将所选子目录一键应用到全部仓库。
  - 支持从本地 \`.txt\` / \`.list\` 文件导入仓库地址清单与一键复制列表。
- **单仓同步增强**：
  - 新增剪贴板一键粘贴、Git 浅克隆（\`--depth=1\`）、递归拉取子模块（\`--recurse-submodules\`）及最近同步记录快捷载入条。
- **界面极简化与一体化深色顶栏**：
  - 采用一体化深色窗口标题栏，与深空座舱主题无缝融合。
  - 全面精简界面冗余提示文案，优化批量拉取三大核心区域可视空间，全应用严格保持单屏（\`100vh\`）紧凑呈现，并修复全局加载图标旋转动画与高亮显示。

### 📦 资产下载说明
- **安装包**：\`CodeSync.Studio.Setup.1.4.0.exe\`（Windows 标准 NSIS 安装向导）
- **便携版**：\`CodeSync-Studio-1.4.0-portable.zip\`（解压即用免安装版）
`

  console.log(`Creating GitHub Release ${tag}...`)
  const createRes = await apiRequest({
    hostname: 'api.github.com',
    path: `/repos/${repo}/releases`,
    method: 'POST',
    headers: {
      'User-Agent': 'CodeSync-Studio-Publisher',
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github.v3+json'
    }
  }, JSON.stringify({
    tag_name: tag,
    target_commitish: 'main',
    name: title,
    body: body,
    draft: false,
    prerelease: false
  }))

  if (createRes.status !== 201) {
    console.error('Failed to create release:', createRes.data || createRes.raw)
    process.exit(1)
  }

  const release = createRes.data
  console.log(`Release created successfully: ${release.html_url}`)
  const uploadUrl = release.upload_url

  const installerDir = path.resolve(__dirname, '..', 'release-installer-codesync')
  const portableDir = path.resolve(__dirname, '..', 'release-portable')
  const exePath = path.join(installerDir, 'CodeSync Studio Setup 1.4.0.exe')
  const zipPath = fs.existsSync(path.join(installerDir, 'CodeSync-Studio-1.4.0-portable.zip'))
    ? path.join(installerDir, 'CodeSync-Studio-1.4.0-portable.zip')
    : path.join(portableDir, 'CodeSync-Studio-1.4.0-portable.zip')

  if (fs.existsSync(exePath)) {
    await uploadAsset(uploadUrl, exePath, 'CodeSync.Studio.Setup.1.4.0.exe', token)
  }

  if (fs.existsSync(zipPath)) {
    await uploadAsset(uploadUrl, zipPath, 'CodeSync-Studio-1.4.0-portable.zip', token)
  }

  console.log(`\n🎉 Release v1.4.0 has been published successfully!`)
  console.log(`URL: ${release.html_url}`)
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})

const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { spawnSync } = require('child_process')

function getGitHubToken() {
  const res = spawnSync('git', ['credential', 'fill'], {
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
  const tag = 'v1.3.0'
  const title = 'CodeSync Studio v1.3.0'
  const body = `## CodeSync Studio v1.3.0

### 🚀 界面与交互全面升级（Cyber-Tech Cockpit）
- **全新深空科技座舱视觉风格**：重构整体页面布局，采用太空深黑、全息青蓝与霓虹翡翠的沉浸式科技风格，磨砂玻璃层叠卡片与高科技雷达动态状态展示。
- **单仓与多仓双引擎优化**：
  - 增强本地已有工作目录自动探测（实时识别分支、最新提交与远端仓库源地址）。
  - 批量队列支持独立版本选择、单项版本探测、单独拉取/更新与目录一键打开。
  - 批量版本探测引入并发控制池，避免远端代码平台限流。
- **遥测终端与进程管理**：终端支持滚动锁定、一键复制日志、仅看错误日志过滤，Windows 任务取消升级为进程树强制终止。
- **连接设置体验优化**：连接凭据弹窗支持磨砂玻璃遮罩与吸底操作栏，适配多种分辨率显示。

### 📦 资产下载说明
- **安装包**：\`CodeSync.Studio.Setup.1.3.0.exe\`（Windows 标准 NSIS 安装向导）
- **便携版**：\`CodeSync-Studio-1.3.0-portable.zip\`（解压即用免安装版）
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
  const exePath = path.join(installerDir, 'CodeSync Studio Setup 1.3.0.exe')
  const zipPath = path.join(installerDir, 'CodeSync-Studio-1.3.0-portable.zip')

  if (fs.existsSync(exePath)) {
    await uploadAsset(uploadUrl, exePath, 'CodeSync.Studio.Setup.1.3.0.exe', token)
  }

  if (fs.existsSync(zipPath)) {
    await uploadAsset(uploadUrl, zipPath, 'CodeSync-Studio-1.3.0-portable.zip', token)
  }

  console.log(`\n🎉 Release v1.3.0 has been published successfully!`)
  console.log(`URL: ${release.html_url}`)
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})

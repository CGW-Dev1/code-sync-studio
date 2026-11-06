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
  const tag = 'v1.3.1'
  const title = 'CodeSync Studio v1.3.1'
  const body = `## CodeSync Studio v1.3.1

### 🚀 屏幕视口满屏无滚动布局与高精字型呈现
- **整屏铺满无需滚动设计**：
  - 每一个菜单页内容完全自适应铺满整屏窗口视口，杜绝外层页面上下滚动条。
  - 单仓工作台精简布局，操作按键永久可见，分支/版本探测按需智能呈现，高级选项折叠展开。
  - 批量引擎左侧配置与开始按键直截了当，右侧支持「待拉取清单 / 实时终端遥测 / 分屏对照」自由一键切换。
- **第三菜单页独立历史任务归档**：
  - 侧边栏第三项与顶部导航直接激活「同步记录」专属仪表盘。
  - 具备全屏检索、Git/SVN 快速筛选、一键重载配置回工作台、本地文件夹直达及一键清空记录。
- **字体呈现优化（彻底消除马赛克与模糊）**：
  - 引入 Windows 原生 ClearType 次像素抗锯齿（Subpixel Antialiasing）与高 DPI 渲染支持。
  - 中文字体首选优化度极高的 \`Microsoft YaHei UI\`，西文选用 \`Cascadia Code\` / \`JetBrains Mono\`。
  - 全面规范字号层级，中文字符绝不低于 12px，笔画细腻清晰，告别发虚与像素马赛克。

### 📦 资产下载说明
- **安装包**：\`CodeSync.Studio.Setup.1.3.1.exe\`（Windows 标准 NSIS 安装向导）
- **便携版**：\`CodeSync-Studio-1.3.1-portable.zip\`（解压即用免安装版）
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
  const exePath = path.join(installerDir, 'CodeSync Studio Setup 1.3.1.exe')
  const zipPath = path.join(installerDir, 'CodeSync-Studio-1.3.1-portable.zip')

  if (fs.existsSync(exePath)) {
    await uploadAsset(uploadUrl, exePath, 'CodeSync.Studio.Setup.1.3.1.exe', token)
  }

  if (fs.existsSync(zipPath)) {
    await uploadAsset(uploadUrl, zipPath, 'CodeSync-Studio-1.3.1-portable.zip', token)
  }

  console.log(`\n🎉 Release v1.3.1 has been published successfully!`)
  console.log(`URL: ${release.html_url}`)
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const asar = require('@electron/asar')

const root = path.resolve(__dirname, '..')
const defaultPortableRoot = path.join(root, 'release-portable')
const installerOutput = path.join(root, 'release-installer-codesync')
const electronDist = path.join(root, 'node_modules', 'electron', 'dist')

// Electron ships ~55 locale packs (~45 MB). The UI is Chinese/English only,
// so keeping three of them removes ~43 MB without changing any behaviour.
const KEEP_LOCALES = new Set(['zh-CN.pak', 'en-US.pak', 'en-GB.pak'])

function copy(source, destination) {
  fs.cpSync(source, destination, { recursive: true, force: true })
}

async function waitFileReadable(filePath, retries = 15, delayMs = 400) {
  for (let i = 0; i < retries; i++) {
    try {
      const fd = fs.openSync(filePath, 'r')
      fs.closeSync(fd)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

function pruneElectronRuntime(targetDir) {
  const localesDir = path.join(targetDir, 'locales')
  if (fs.existsSync(localesDir)) {
    let removed = 0
    for (const name of fs.readdirSync(localesDir)) {
      if (!KEEP_LOCALES.has(name)) {
        try {
          fs.rmSync(path.join(localesDir, name), { force: true })
          removed += 1
        } catch {}
      }
    }
    console.log(`Pruned ${removed} unused locale packs`)
  }
  const defaultApp = path.join(targetDir, 'resources', 'default_app.asar')
  if (fs.existsSync(defaultApp)) {
    try { fs.rmSync(defaultApp, { force: true }) } catch {}
  }
}

async function main() {
  const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  if (build.error) throw build.error
  if (build.status !== 0) process.exit(build.status || 1)
  if (!fs.existsSync(electronDist)) throw new Error(`Electron runtime not found: ${electronDist}`)

  let portableRoot = defaultPortableRoot
  let portableApp = path.join(portableRoot, 'CodeSync Studio')
  let appRoot = path.join(portableApp, 'resources', 'app')
  let appAsar = path.join(portableApp, 'resources', 'app.asar')
  let usingTempStage = false

  try {
    const exeLockPath = path.join(portableApp, 'CodeSync Studio.exe')
    const asarLockPath = path.join(portableApp, 'resources', 'app.asar')
    for (const f of [exeLockPath, asarLockPath]) {
      if (fs.existsSync(f)) {
        const fd = fs.openSync(f, 'r+')
        fs.closeSync(fd)
      }
    }
    fs.rmSync(portableRoot, { recursive: true, force: true })
  } catch (err) {
    if (err && (err.code === 'EBUSY' || err.code === 'EPERM')) {
      usingTempStage = true
      portableRoot = path.join(root, 'release-staging')
      portableApp = path.join(portableRoot, 'CodeSync Studio')
      appRoot = path.join(portableApp, 'resources', 'app')
      appAsar = path.join(portableApp, 'resources', 'app.asar')
      fs.rmSync(portableRoot, { recursive: true, force: true })
      console.warn('Notice: release-portable is locked by a running CodeSync Studio process; staging installers cleanly in release-staging.')
    }
  }

  try {
    fs.mkdirSync(appRoot, { recursive: true })
    if (!fs.existsSync(path.join(portableApp, 'CodeSync Studio.exe'))) {
      copy(electronDist, portableApp)
      if (fs.existsSync(path.join(portableApp, 'electron.exe'))) {
        fs.renameSync(path.join(portableApp, 'electron.exe'), path.join(portableApp, 'CodeSync Studio.exe'))
      }
    }
    pruneElectronRuntime(portableApp)
    fs.rmSync(path.join(appRoot, 'dist'), { recursive: true, force: true })
    fs.rmSync(path.join(appRoot, 'electron'), { recursive: true, force: true })
    copy(path.join(root, 'dist'), path.join(appRoot, 'dist'))
    copy(path.join(root, 'electron'), path.join(appRoot, 'electron'))
    copy(path.join(root, 'assets'), path.join(appRoot, 'assets'))
    copy(path.join(root, 'package.json'), path.join(appRoot, 'package.json'))

    // Pack the app into a single app.asar: one file instead of hundreds means much
    // fewer disk seeks / AV scans on cold start, and a smaller on-disk footprint.
    if (fs.existsSync(appAsar)) fs.rmSync(appAsar, { force: true })
    await asar.createPackage(appRoot, appAsar)
    fs.rmSync(appRoot, { recursive: true, force: true })
    console.log('Packed resources/app.asar')

    // Build portable zip BEFORE electron-builder runs (with retry for transient Windows AV scan locks)
    await waitFileReadable(appAsar)
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    const zipName = `CodeSync-Studio-${pkg.version}-portable.zip`
    const stagedZipPath = path.join(portableRoot, zipName)
    const entries = fs.readdirSync(portableApp)
    let zipOk = false
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (fs.existsSync(stagedZipPath)) fs.rmSync(stagedZipPath, { force: true })
      const zipResult = spawnSync('tar', ['-a', '-cf', stagedZipPath, ...entries], { cwd: portableApp, stdio: 'inherit' })
      if (zipResult.error) throw zipResult.error
      if (zipResult.status === 0) {
        zipOk = true
        break
      }
      console.warn(`tar retry ${attempt}/4 after transient lock on app.asar...`)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    if (!zipOk) process.exit(1)

    fs.rmSync(installerOutput, { recursive: true, force: true })
    const builder = path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
    const packageResult = spawnSync(process.execPath, [builder, '--prepackaged', portableApp, '--win', 'nsis', 'portable', '--config.directories.output=release-installer-codesync'], { cwd: root, stdio: 'inherit' })
    if (packageResult.status !== 0) process.exit(packageResult.status || 1)

    const zipPath = path.join(installerOutput, zipName)
    fs.mkdirSync(installerOutput, { recursive: true })
    fs.renameSync(stagedZipPath, zipPath)

    if (!usingTempStage) console.log(`Portable app: ${portableApp}`)
    console.log(`Installer output (3 packages): ${installerOutput}`)
  } finally {
    if (usingTempStage) {
      try { fs.rmSync(portableRoot, { recursive: true, force: true }) } catch {}
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

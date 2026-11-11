const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const asar = require('@electron/asar')

const root = path.resolve(__dirname, '..')
const portableRoot = path.join(root, 'release-portable')
const portableApp = path.join(portableRoot, 'CodeSync Studio')
const appRoot = path.join(portableApp, 'resources', 'app')
const appAsar = path.join(portableApp, 'resources', 'app.asar')
const installerOutput = path.join(root, 'release-installer-codesync')
const electronDist = path.join(root, 'node_modules', 'electron', 'dist')

// Electron ships ~55 locale packs (~45 MB). The UI is Chinese/English only,
// so keeping three of them removes ~43 MB without changing any behaviour.
const KEEP_LOCALES = new Set(['zh-CN.pak', 'en-US.pak', 'en-GB.pak'])

function copy(source, destination) {
  fs.cpSync(source, destination, { recursive: true, force: true })
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

  try {
    fs.rmSync(portableRoot, { recursive: true, force: true })
  } catch {
    // If CodeSync Studio.exe is running, update resources/app in-place
  }
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

  const builder = path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
  const packageResult = spawnSync(process.execPath, [builder, '--prepackaged', portableApp, '--win', 'nsis', 'portable', '--config.directories.output=release-installer-codesync'], { cwd: root, stdio: 'inherit' })
  if (packageResult.status !== 0) process.exit(packageResult.status || 1)
  console.log(`Portable app: ${portableApp}`)
  console.log(`Installer: ${installerOutput}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

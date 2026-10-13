const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const portableRoot = path.join(root, 'release-portable')
const portableApp = path.join(portableRoot, 'CodeSync Studio')
const appRoot = path.join(portableApp, 'resources', 'app')
const installerOutput = path.join(root, 'release-installer-codesync')
const electronDist = path.join(root, 'node_modules', 'electron', 'dist')

function copy(source, destination) {
  fs.cpSync(source, destination, { recursive: true, force: true })
}

function main() {
  const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  if (build.error) throw build.error
  if (build.status !== 0) process.exit(build.status || 1)
  if (!fs.existsSync(electronDist)) throw new Error(`Electron runtime not found: ${electronDist}`)

  fs.rmSync(portableRoot, { recursive: true, force: true })
  fs.mkdirSync(appRoot, { recursive: true })
  copy(electronDist, portableApp)
  copy(path.join(root, 'dist'), path.join(appRoot, 'dist'))
  copy(path.join(root, 'electron'), path.join(appRoot, 'electron'))
  copy(path.join(root, 'assets'), path.join(appRoot, 'assets'))
  copy(path.join(root, 'package.json'), path.join(appRoot, 'package.json'))
  fs.renameSync(path.join(portableApp, 'electron.exe'), path.join(portableApp, 'CodeSync Studio.exe'))

  const builder = path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
  const packageResult = spawnSync(process.execPath, [builder, '--prepackaged', portableApp, '--win', 'nsis', '--config.directories.output=release-installer-codesync'], { cwd: root, stdio: 'inherit' })
  if (packageResult.status !== 0) process.exit(packageResult.status || 1)
  console.log(`Portable app: ${portableApp}`)
  console.log(`Installer: ${installerOutput}`)
}

main()

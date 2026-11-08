const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('codeSync', {
  choosePath: () => ipcRenderer.invoke('path:choose'),
  chooseFile: () => ipcRenderer.invoke('path:choose-file'),
  chooseReleaseFiles: () => ipcRenderer.invoke('path:choose-release-files'),
  readTextFile: (target) => ipcRenderer.invoke('path:read-text', target),
  openPath: (target) => ipcRenderer.invoke('path:open', target),
  openExternalUrl: (url) => ipcRenderer.invoke('url:open-external', url),
  checkPath: (target) => ipcRenderer.invoke('path:check', target),
  probeRepository: (payload) => ipcRenderer.invoke('repository:probe', payload),
  browseRepository: (payload) => ipcRenderer.invoke('repository:browse', payload),
  inspectLocal: (payload) => ipcRenderer.invoke('repository:inspect', payload),
  inspectPushWorkspace: (payload) => ipcRenderer.invoke('repository:inspect-push', payload),
  inspectReleaseWorkspace: (payload) => ipcRenderer.invoke('repository:inspect-release', payload),
  scanLocalRepos: (payload) => ipcRenderer.invoke('repository:scan-local', payload),
  getWorkspaceDiff: (payload) => ipcRenderer.invoke('repository:diff', payload),
  runTask: (payload) => ipcRenderer.invoke('task:run', payload),
  cancelTask: () => ipcRenderer.invoke('task:cancel'),
  getToolStatus: () => ipcRenderer.invoke('tools:status'),
  getCredentialStatus: () => ipcRenderer.invoke('credentials:get'),
  saveCredentials: (payload) => ipcRenderer.invoke('credentials:save', payload),
  testCredentials: (payload) => ipcRenderer.invoke('credentials:test', payload),
  clearCredentials: (provider) => ipcRenderer.invoke('credentials:clear', provider),
  onTaskEvent: (handler) => {
    const listener = (_, event) => handler(event)
    ipcRenderer.on('task:event', listener)
    return () => ipcRenderer.removeListener('task:event', listener)
  }
})

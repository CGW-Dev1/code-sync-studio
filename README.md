# CodeSync Studio

> 现代化 Git 与 SVN 仓库拉取、增量同步与多源代码管理桌面工具。

![CodeSync Studio Icon](assets/codesync-sakura.svg)

## 📖 项目简介

**CodeSync Studio** 是一款基于 Electron + React + Vite 构建的轻量级、跨平台桌面应用，专为简化日常 Git 与 SVN 仓库代码拉取、子目录按需检出（Sparse Checkout）及多凭据管理而设计。

### ✨ 核心特性

- **双引擎支持**：原生支持 Git 和 SVN 两种主流版本控制系统。
- **目录树按需拉取**：支持在拉取前浏览远程/分支目录树，仅拉取指定子目录（Git Sparse-checkout / SVN 深度检出），节省带宽与磁盘空间。
- **安全凭据存储**：使用操作系统底层安全存储机制（Electron SafeStorage / Windows DPAPI），安全加密保存 HTTPS Token、SSH 密钥密码及 SVN 凭据。
- **分支与标签切换**：便捷切换目标分支或 Tag，自动管理拉取进度。
- **实时任务进度与日志**：可视化展示拉取阶段、百分比进度与命令行实时输出。
- **现代化 UI**：清爽的樱花主题界面，支持响应式布局与直观的仓库配置管理。

---

## 🛠️ 技术栈

- **框架**：[React 18](https://react.dev/) + [Vite](https://vitejs.dev/)
- **桌面运行时**：[Electron](https://www.electronjs.org/)
- **图标**：[lucide-react](https://lucide.dev/)
- **打包工具**：[electron-builder](https://www.electron.build/)

---

## 🚀 快速上手

### 环境要求

- Node.js >= 18.0.0
- Git 客户端（支持 sparse-checkout）
- SVN 客户端（Subversion）

### 1. 安装依赖

```bash
npm install
```

### 2. 开发模式

启动 Vite 前端热重载开发服务器：
```bash
npm run dev
```

在另一个终端启动 Electron 桌面应用窗口：
```bash
npm run desktop
```

### 3. 构建与打包

构建前端生产代码：
```bash
npm run build
```

打包生成 Windows 便携版及安装包（NSIS Setup）：
```bash
npm run package
```

打包完成后，产物将保存在：
- `release-portable/`：便携免安装版
- `release-installer-codesync/`：安装包（`CodeSync Studio Setup x.x.x.exe`）

---

## 📦 发行版下载

最新的 Windows 安装包（`.exe`）可直接在项目的 [Releases](../../releases) 页面中下载使用。

---

## 📄 开源许可

本项目遵循 MIT 许可证。

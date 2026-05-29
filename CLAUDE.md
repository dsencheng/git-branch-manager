# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供指引。

## 项目概述

Git Branch Manager — 一个本地 Web 面板，用于查看和管理多个 Git 仓库的分支。基于 Hono (Node.js) 构建，前端为单页应用。UI 语言为中文 (zh-CN)。

## 命令

```bash
npm start          # 启动服务 http://localhost:3456
```

无构建步骤、无测试、无 lint 配置。通过 `node server.js` 直接运行。

## 架构

单服务器架构，核心文件：

- **server.js** — Hono HTTP 服务。根据 `config.json` 中配置的目录扫描含 `.git` 的文件夹，暴露 REST 端点用于仓库列表、分支管理、checkout、stash、批量操作等。所有 git 操作使用 `execFile('git', ...)` 并以仓库路径为 cwd。
- **public/index.html** — 自包含 SPA（HTML + 内联 CSS + 内联 JS）。渲染仓库卡片网格，支持单个/批量分支切换、创建、删除，stash 处理，批量 pull，自动轮询。
- **config.json** — 持久化配置，存储扫描目录列表和单独仓库路径。

### API 端点

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/repos` | 列出所有仓库及当前分支和脏状态 |
| GET | `/api/repos/:name/branches` | 列出仓库的分支 |
| POST | `/api/repos/:name/checkout` | 切换分支 (body: `{branch}`) |
| POST | `/api/repos/:name/stash` | 暂存改动 |
| POST | `/api/repos/:name/stash-pop` | 恢复暂存 |
| POST | `/api/batch-checkout` | 批量切换分支 (body: `{branch, repoNames}`) |
| POST | `/api/batch-create-branch` | 批量创建分支 (body: `{branch, repoNames}`) |
| POST | `/api/batch-delete-branch` | 批量删除分支 (body: `{branch, repoNames}`) |
| POST | `/api/batch-pull` | 批量拉取 (body: `{repoNames}`) |
| POST | `/api/batch-push` | 批量推送 (body: `{repoNames}`) |
| POST | `/api/batch-sync` | 批量同步：fetch 远端源分支并合并到当前分支 (body: `{sourceBranch, repoNames}`) |
| GET | `/api/config` | 获取仓库配置 |
| POST | `/api/config/base-dirs` | 添加扫描目录 (body: `{path}`) |
| DELETE | `/api/config/base-dirs` | 删除扫描目录 (body: `{path}`) |
| POST | `/api/config/repos` | 添加单独仓库 (body: `{path}`) |
| DELETE | `/api/config/repos` | 删除单独仓库 (body: `{path}`) |
| POST | `/api/pick-directory` | 调用系统目录选择器 (macOS) |

### 关键设计决策

- 无数据库 — 仓库发现在请求时通过扫描文件系统完成。
- 配置持久化使用 JSON 文件 (`config.json`)，支持动态添加/删除扫描目录和仓库。
- `batch-pull` 在冲突时自动中止合并并重置，避免仓库处于损坏状态。
- `batch-delete-branch` 删除当前所在分支时会先自动切换到 master/main/develop。
- `batch-sync` 同步前检查远端分支是否存在、当前分支是否等于源分支（跳过）、自动 stash 未提交改动，冲突时自动 abort 回滚。前端弹窗确认操作计划后执行。
- 前端使用轮询（可配置间隔）而非 WebSocket，追求简洁。
- 静态文件通过 Hono 的 `serveStatic` 中间件从 `./public/` 提供。
- 左侧操作记录面板记录所有操作结果，默认隐藏，可展开查看。

### 前端规范

- **禁止使用浏览器原生弹窗**（`alert()`、`confirm()`、`prompt()`）。所有确认/提示交互必须使用项目内的自定义弹窗组件 `showConfirm()`，保持 UI 风格一致。

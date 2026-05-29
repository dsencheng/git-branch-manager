# Git Branch Manager

一个本地 Web 面板，用于查看和管理多个 Git 仓库的分支。

## 功能

- 仓库状态一览（当前分支、是否有未提交改动）
- 单个仓库分支切换（支持 stash 处理）
- 批量切换分支
- 批量创建分支
- 批量删除分支（自动处理当前所在分支）
- 批量拉取（冲突时自动回滚）
- 可配置仓库目录（支持系统目录选择器）
- 操作记录面板
- 自动轮询刷新

## 快速开始

```bash
npm install
npm start
```

打开浏览器访问 http://localhost:3456

首次使用请点击右上角"设置"按钮添加仓库扫描目录。

## 技术栈

- [Hono](https://hono.dev/) — 轻量 HTTP 框架
- Node.js — 运行时
- 原生 HTML/CSS/JS — 无前端框架依赖

## 配置

仓库配置保存在项目根目录的 `config.json` 中：

```json
{
  "baseDirs": ["/path/to/your/code"],
  "repos": ["/path/to/specific/repo"]
}
```

- `baseDirs` — 扫描该目录下所有含 `.git` 的一级子目录
- `repos` — 单独添加的仓库绝对路径

配置可通过 Web UI 的设置面板管理，无需手动编辑。

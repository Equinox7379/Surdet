# Surdet 项目路径迁移说明

迁移日期：2026-08-08

## 当前路径

- 项目根目录：`E:\surdet`
- 编辑器开发地址：http://localhost:5174/
- 所有 npm、Vite、测试、构建和项目脚本，均应在 `E:\surdet` 目录执行。

示例：

```powershell
Set-Location E:\surdet
npm run typecheck --workspaces --if-present
npm test
npm run dev -w surdet-editor
```

## 旧路径处理

旧项目路径 `C:\Users\Equinox\Documents\Default Project\surdet` 已不再是主项目位置。文档、配置和交接说明中的项目绝对路径已统一更新到 E 盘。

`C:\Users\Equinox\Documents\Default Project` 是原来的超级仓库位置，包含其他无关项目；Surdet 不再从那里运行。现在 `E:\surdet` 已建立独立 Git 工作树，分支 `main` 跟踪远端 `surdet/main`，项目内的 Git 路径不带 `surdet/` 前缀。

## 运行规则

1. 新终端默认进入 `E:\surdet`。
2. 编辑器固定使用 `http://localhost:5174/`（端口由 `packages/editor/vite.config.ts` 统一配置）。
3. 任何新脚本不得写死 C 盘旧路径；需要路径时优先使用当前工作目录或 `SURDET_ROOT` 环境变量。
4. 提交前检查：

```powershell
git status --short
git diff --check
```

用户明确要求推送时，在 E 盘执行：

```powershell
git push surdet main
```

5. 若发现旧路径引用，先搜索：

```powershell
rg -n --hidden -S -g '!node_modules/**' -g '!dist/**' 'C:\\Users\\Equinox\\Documents\\Default Project\\surdet|C:/Users/Equinox/Documents/Default Project/surdet' E:\surdet
```

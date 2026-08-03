# Surdet 示例项目（最小演示）

展示 DSL 核心能力的合法剧本。运行校验：

```bash
npm run build -w @surdet/cli
node packages/cli/dist/index.js lint examples/starter
```

## 目录约定

```
content/scenario/*.gal   剧本（场景 ID = 文件名）
content/config/          配置（M2 起：角色/变量表）
assets/images|audio      素材
```

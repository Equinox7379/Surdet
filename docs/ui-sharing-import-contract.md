# U3：现有主题/界面片段的导入预览与应用

基线为U1/U2已合入的main（821a1400）。本批只补Editor数据投影和草稿端口，不改`surdet-ui/version:1`、Core/Authoring能力号或保存格式；没有新增可见对话框、默认美术、在线市场。可见接线由Claude另开PR。

## 只读投影

`authoring-project-storage.ts`导出：

```ts
previewUiShareImport(text, destination, target?)
// target: { page: ProjectUiPageId; parentId?: string; prefix: string }
```

- 先调用原`readUiShare`完整校验，复用Core资源/变量依赖和Authoring `patchUiDocument`，不另写片段修改规则。
- 返回`share`（原共享包）、`config`（完整目标预览）、`value`（目标UI）、`themeForm`（主题时为原主题表单文本，片段为null）、`patch`（片段时为原UI操作，主题为null）、`pages`（每页`change/before/after`）。
- `pages.change`为`unchanged/add/remove/replace/insert`；before/after为真实节点ID列表。`remove`是移除目标自定义页、恢复其默认页，不是删除游戏功能。完整主题按共享包替换页面集合，未携带的自定义页会恢复默认，必须向作者说清。
- 完整主题只替换拥有的主题、字体、标题图片和UI字段；目标标题、剧情、变量初值、插件、玩家其他配置和私有字段保留。共享包省略主题时重置已公开主题项，但保留目标未知私有主题字段。
- 片段必须匹配目标页面类型；parentId存在时插入指定父组件末尾，省略时替换该页根节点。prefix由调用方生成一次，并在同一预览/应用中保持不变。主题/字体始终继承目标项目。
- 错误页面、消失的父节点、重复ID、非法嵌套页面动效等在产生预览前拒绝；不删除片段字段“修好”它。

## 当前项目的两步端口

`panels/config.ts`导出：

```ts
const proposal = await prepareUiShareImportDraft(text, target?);
// proposal.preview: 上面的完整投影，独立副本
// proposal.resources: { path, state: 'present' | 'missing' }[]
await proposal.stageMissingAssets(); // 作者明确要求后才加入原素材导入待选区；返回文件数
await proposal.apply();             // 作者确认后，主题+UI作为一次配置撤销点
```

准备阶段只读文件，不修改草稿、磁盘或素材待选区；取消只需丢弃proposal。资源状态由原素材目录与共享字节核对，内容冲突直接拒绝，不覆盖同名资源。悬停/焦点等状态图片也来自Core的原资源依赖枚举。

`stageMissingAssets`和`apply`都会再次检查原项目目录、配置会话、最新导入请求、完整草稿正文、可写状态及资源。新项目/会话、换共享文件、草稿已改变或资源内容冲突时旧proposal拒绝。没有新增摘要、永久token或版本格式。公开预览对象被修改不会改变捕获的实际应用数据；成功apply后不可重复应用。

缺资源时apply拒绝；必须通过现有素材导入工作台确认导入，不能只把File放进列表就宣称已安装。完成素材导入后重新准备预览最清楚；无冲突、无缺失后再确认应用。

apply只改变草稿，不写盘；一次撤销/重做同时恢复主题和UI。保存沿原项目写锁和`saveDirtyConfigSections`/“保存全部”，不能仅保存UI而丢掉主题/字体草稿。没有改存档身份、插件信任、玩家阅读设置或保存事务。

## Claude接线

替换原导入回调的立即应用/浏览器confirm为应用前预览：展示受影响页面/组件、保留项、缺少资源和冲突原因，完整主题与片段含义不同。确认前不改草稿。预览只读`proposal.preview.config`及共享资源；取消/关闭/切换项目释放临时图片/字体与Player实例，旧异步加载不能覆盖新预览。

调用上面的端口，不维护第二份资源清单、不在UI重新拼应用配置；对话框只能调用一次apply，失败保留原草稿并显示真实原因。完整样式示例覆盖标题、对白、选项、系统菜单、存读档、设置、文字记录和鉴赏，正常/焦点/禁用/空状态与U1/U2统一；示例不等于Owner认可的最终生成美术，不自动替换默认项目或两部作品。

## 已验与未验

本机Windows：原共享与新投影9项定向测试通过；真实绑定Editor数据端口验证只读/取消、缺资源、显式待选不落盘、确认时资源变化、过期草稿与会话/请求、一次撤销、正常保存及重开，页面错误0。Editor类型（含desktop）和构建另按实际结果记录。

尚未交付可见预览对话框和新完整示例，未将这批U3打进Electron/最终导出包，不是正式美术验收。U2的既有Windows/桌面/导出证据不代替U3前端验收。10月Actions额度用尽，提交[skip ci]，不跑CI。

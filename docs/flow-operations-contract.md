# 流程图编辑：结构化操作后端合同

成熟化规划第7项。后端依赖PR #11，合同2.34.0（73能力），继续使用`scene.create`、`scene.patch`等现有入口，不新增写盘通道。Claude负责全部图上交互、差异预览、源码高亮与既有撤销/保存接线。

## 实际接口

`scene.patch.patch`新增`{kind:'insertBefore',anchor,expectedFingerprint,blocks}`，插在真实源行或规范label对象之前。anchor从当前object.inspect获得，使用它原有的行级前置事实；scene根对象不能作为源行anchor。复用既有检查，不另计算摘要，不在前端另造指纹。旧`insertAfter`仍表示插在行之后；两者不是同义字段。

- 支持首行就是结束指令、LF/CRLF、无末行换行。UTF-8 BOM保持在新首行，原有正文/换行继续保留。
- before允许规范`label:场景.标签`，用于空标签段在下一个标签之前插入。
- 不能在scene声明之前插入；不能在choice标题与选项之间、两选项之间插入一般正文或指令，应改完整choice组。请求拒绝时不修改草稿。
- `replaceInstruction`白名单增加call；提供完整instruction，参数中的目标和合法修饰符按真实语义保留/修改，省略修饰符仍表示移除。不能用该单行入口处理choice/if结构、return、音频或视频。
- 选择肢继续用`replaceChoiceOption`或`replaceChoiceGroup`，条件组用`replaceConditionBlock`，删除已有连线对应原`removeObject`。跨场景call后的返回位置由Core保留，不重建调用栈。

## 图上连接落成什么

同场景连接使用goto目标标签，跨场景使用jump目标场景或场景.标签。读取当前SceneDocument和Core结构跨度，先限定到选定场景或标签段，不把嵌套条件的分支末端当成整个场景末端。

1. 选定段最后是无条件end/jump/goto/return时，用insertBefore放在这个真实终结指令之前，预览差异并说明将改变其后的可达路径；不追加到结束之后。
2. 标签段没有内容、直接接下一个标签时，用insertBefore以下一个规范label为anchor。
3. 没有终结指令的段，选其实际最后合法源对象insertAfter。空文件没有真实anchor，先用已有scene.create/模板建立声明与正文；不要制造虚拟ID或把scene根ref当源行。
4. 新选择组以typed choice blocks插入；不要拼DSL字符串或分多次临时拆组。箭头goto/jump与effects独立，现有choice模型不把call冒充goto；call效果保持为effects，不在本批另扩目标种类。
5. 改已有goto/jump/call目标用replaceInstruction；改选择连线用对应choice变体，并保留条件/效果。不把return当作可任意改终点的普通边。

变更先展示原有源码差异，确认后进入原撤销/保存链。来源变化、只读结果、未明回执或当前写入保护继续按已有合同拒绝，不新增第二份SceneDocument或写盘状态机。操作成功重读当前源对象；Editor图、剧本和Agent看到同一份源稿。

## 已验证与交付边界

本机定向验证：首行终结指令前连接真实可达、LF/CRLF/BOM与无末行换行、空标签段、选择边界拒绝、call改目标后真实返回续句。真实MCP在候选中执行insertBefore，新场景实际可达，candidateReadiness为ready，存储事实记录真实候选目标依赖，原文件保持未写回。审阅内容/选择摘要同步消费新blocks。

未在本机执行组合结果正式审批/写回或Editor图上拖动；这些不被单元数量代签。Claude需完成新建、连线、分支、改目标、删除、撤销重做、保存重开以及Agent读取同稿的真实前端路径，随后由本机Windows复核。

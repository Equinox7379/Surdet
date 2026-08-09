# Surdet Renderer v2 M8 最终限定整改交付报告

日期：2026-08-10  
项目目录：E:\surdet  
当前停止点：WAITING_FOR_REVIEW  
发布状态：RELEASE_BLOCKED（性能门禁仍有正式红灯，未取得独立最终发行批准）

## 1. 结论先行

本报告对应总经理授权的 Renderer v2 M8 最终限定整改。P1-1、P1-2、P1-3、P1-4 及 P2 报告闭环已完成，源码、测试、工具、视觉证据、性能 artifact、正式游戏和 Windows 包均已重新核验。

工程结论：

- Starter owner teardown 已补齐，资源、监听器、运行时和异步任务的退出路径已覆盖，并有失败先行测试；
- Renderer runtime 与 legacy adapter 的依赖方向已反转，严格 legacy 使用扫描器已收紧并通过；
- 17 个 M8 目标视觉状态均有语义断言、PNG、SHA-256 和 contact sheet；由于没有批准视觉 manifest，17 项视觉状态全部明确标为 CANDIDATE，没有伪造 PASS；
- M7.5→最终运行时代码的固定配对 A/B 已使用正确 baseline 和最终代码 SHA 完成，保存 2 次 warmup 与 40 个正式原始 launch，官方 validator 通过；
- 本次 A/B 的 coldStartMs、assetReadyMs、sceneP95Ms 通过，但 menuOpenP95Ms 正式失败，不能宣称性能全绿；
- M7.5 冻结候选原有 sceneP95Ms 红灯仍保留：gateRatio=1.2488932611978962，没有被覆盖、删除或改写；
- 《零点之后》仍为 23/23 选择分支、3 个结局、44 项资产、运行时错误 0；
- Windows 包已按运行时代码变更重新生成并通过 verify-pack.mjs --artifact，但本报告不代表正式发行批准；
- 没有修改 DSL、存档格式、游戏规则、正式剧本、用户存档、正常 Electron userData 或四个受保护文件；
- 没有 push、没有 force push、没有开始 M9。

因此，本轮状态是：工程限定整改完成，等待总经理独立复审；发布仍被性能红灯阻断。

## 2. 范围、基线和 Git 起点

### 2.1 两个必须区分的起点

| 项目 | 完整 SHA | 含义 |
|---|---|---|
| M8 原始授权起始基线 | 007438b569ec95350fdc9d7882ad49f55bbb7968 | M7.5 最终批准后进入 M8 的起始 HEAD |
| 本轮限定整改开始时 HEAD | 9644076504cdecc585a5ef3eb96737db9baca553 | 总经理提出 M8 最终限定整改时的代码/报告起点 |
| M7.5→M8 A/B baseline | 007438b569ec95350fdc9d7882ad49f55bbb7968 | 本次正式比较的 baseline |
| 本次最终运行时代码 | 0365cff80910597d4985408a187c4b663020e1f0 | A/B current；最后一个包含运行时/测试修正的代码提交 |
| A/B 与能力证据提交 | 23182e3b10a8aba28ed5f60dd70956bc94e728b1 | 纳入最终 A/B artifact 和能力矩阵路径修正 |
| 报告写入前现场 HEAD | 23182e3b10a8aba28ed5f60dd70956bc94e728b1 | 本报告创建前最后一个已提交 HEAD |

报告写入前现场：

~~~text
HEAD = 23182e3b10a8aba28ed5f60dd70956bc94e728b1
HEAD...surdet/main = 83 0
~~~

报告提交后的最终 HEAD、ahead/behind、工作树和报告文件 SHA-256 不在正文中自指式预填，统一以最终只读 Git 回读作为终端交付回执，避免把尚未产生的提交 SHA 写入报告。

### 2.2 本轮聚焦提交链

| SHA | 提交信息 | 范围 |
|---|---|---|
| ce76c72bbdb0b629f1b9012c1e850dc84915d726 | refactor(renderer): detach v2 runtime from legacy adapters | 独立 runtime ports，反转依赖方向 |
| a34006085f8550cf862030877cc9982d5c7b49ba | test(renderer): enforce exact legacy usage boundary | 精确 legacy 边界测试和恶意 fixture |
| d22df9a960092f117d44f2e3b74ea26d1c9684d3 | fix(starter): dispose renderer runtime on teardown | Starter owner teardown 与退出路径 |
| 04c4609eb546a222052e9f5ddb193cc45721e3ae | test(shell): close M8 visual acceptance evidence | 17 状态语义/视觉证据 harness |
| 53a2961b4d360fac03ddb7515ebb34b8f2d611f1 | test(shell): require complete baseline asset health | artifact 资源完成状态校验 |
| 0365cff80910597d4985408a187c4b663020e1f0 | fix(renderer): complete legacy boundary migration | 修复实际扫描器阻断，完成 legacy 路径隔离 |
| 23182e3b10a8aba28ed5f60dd70956bc94e728b1 | test(renderer): record final M8 evidence | 最终 A/B artifact、能力矩阵证据路径同步 |

## 3. P1 限定整改完成情况

### 3.1 P1-1：使用正确 M7.5 baseline 的固定 A/B

本次没有把 Starter 历史 M0 样本冒充 M7.5 baseline，也没有通过重复抽样挑选绿色轮次。比较使用两个系统临时目录隔离 worktree：

~~~text
baseline = C:\Users\Equinox\AppData\Local\Temp\surdet-m8-ab-2026-08-10\baseline-007438b
current  = C:\Users\Equinox\AppData\Local\Temp\surdet-m8-ab-2026-08-10\current-0365cff
~~~

固定协议：

- baseline：007438b569ec95350fdc9d7882ad49f55bbb7968；
- current：0365cff80910597d4985408a187c4b663020e1f0；
- pairCount=20，每侧各 warmup 一次，artifact 中 warmups=2、rawLaunches=40；
- counterbalanced 顺序由官方 comparator 固定并写入 artifact；
- 两侧均以相同模式重新 npm ci --ignore-scripts --no-audit --no-fund，构建顺序相同；
- Node v24.15.0、npm 11.12.1、Electron 43.2.0、Playwright 1.62.1；
- OS：win32 10.0.26220、x64、AMD Ryzen 9 7940HX with Radeon Graphics；
- build mode：electron-dev-shell-starter；
- 两侧 package-lock SHA-256 完全相同：
  60a48410727eb3c536ad005459a6e3460bb9abf77e3bdd7d19c799429e273e8f；
- 所有原始样本均保留，没有删异常值、降低样本数或只保留中位数；
- artifact：E:\surdet\docs\baselines\renderer-v3-m8-ab-2026-08-10.json；
- artifact SHA-256：0C08C3C9D7B36D6B45F4A40551224EF0B1830BFF06C385B179938065AB8261E9；
- schema：3；官方 validator 结果：validated=true。

采样和离线重建时间明确分离：

~~~text
sampledAt = 2026-08-09T17:59:23.247Z
rebuiltAt = 2026-08-09T18:00:47.606Z
~~~

M8 artifact 的正式比较结果如下。顶层启动/资源使用 median，菜单/场景使用 p95；门限保持原值 1.10/1.15。

| 指标 | 统计量 | M7.5 baseline | 最终 current | gateRatio | 门限 | 结果 |
|---|---:|---:|---:|---:|---:|---|
| coldStartMs | median | 877.19515 | 832.67850 | 0.9492511444 | 1.10 | PASS |
| assetReadyMs | median | 936.14790 | 920.29660 | 0.9830675260 | 1.10 | PASS |
| menuOpenP95Ms | p95 | 11.41500 | 19.89500 | 1.7428821725 | 1.15 | FAIL |
| sceneP95Ms | p95 | 26.03000 | 25.83000 | 0.9923165580 | 1.15 | PASS |

正式失败项只有：

~~~text
formalFailures = menuOpenP95Ms
baseline p95   = 11.414999998733402
current p95    = 19.894999996945263
gateRatio      = 1.74288217250572
limit          = 1.15
~~~

M0 历史比较在本 artifact 中仍报告 menuOpenP95Ms：current / historical baseline 比率为 1.8421296273134597。pairedMedianRatio=1.0240516767317382 仅作诊断，没有被用来覆盖正式 p95 gate。

M7.5 冻结候选另行保持原红灯：

~~~text
file           = E:\surdet\docs\baselines\renderer-v3-candidate-2026-08-09.json
baseline       = cab200b5aaed49b053b18ff05907aac4d02fb731
current        = 93b472bf20e351b53f151323d5080070427fd7f2
formalFailures = sceneP95Ms
gateRatio      = 1.2488932611978962
limit          = 1.15
SHA-256        = 61EF931C07FA74A4890CE5A80607685954B99EC31C3040B4CA1A2CAFF2C2A90E
~~~

该文件没有被覆盖，也没有被改写为绿色；renderer-baseline-v3-verify.mjs 现场复核结果仍为 formalFailures=sceneP95Ms。

### 3.2 P1-2：Starter owner teardown

新增 examples/starter/src/starter-owner-teardown.ts 和对应测试，统一处理 Starter 所有者资源的同步、幂等退出：

1. 停止 gamepad；
2. dispose audio；
3. dispose Renderer runtime；
4. 移除窗口/输入监听器；
5. revoke font URL 和 asset URL；
6. 每个 disposer 抛错后仍继续执行其余清理，最后用 AggregateError 报告；
7. 显式 teardown、重复 teardown 和 runtime 已被外部 dispose 的路径均保持安全。

生产入口的 listener 注册改为可追踪并由统一 teardown 清理；formal game 的 runtime disposal 也收紧为同步、幂等路径。这里没有改 DSL、存档或游戏行为。

先行失败记录：最初只加入测试时因 starter-owner-teardown.js 不存在而失败；补实现后：

~~~text
npm test -w surdet-starter          3 files / 5 tests passed
npm run typecheck -w surdet-starter PASS
npm run build -w surdet-starter     PASS
~~~

### 3.3 P1-3：runtime/legacy 依赖方向与精确扫描

整改内容：

- 新增 packages/renderer/src/runtime/presentation-ports.ts，把 RendererStagePort、Presentation 端口及相关类型放到独立 runtime 层；
- legacy adapter 依赖 runtime port，runtime 不再依赖 ../legacy/、PixiStage、AdvRenderer 或 AdvStage；
- packages/renderer/src/plugin-host.ts 改用独立窄 RendererPluginStage，不再以 AdvStage 作为插件生产端口；
- packages/renderer/test/integration/resource-cycles.test.ts 改用 createPresentationPorts，不再把 AdvStage 类型带入测试接线；
- 与 legacy API 相关的兼容测试集中到 packages/renderer/test/legacy/；
- Editor preview contract 测试中的扫描器 fixture 改为字符串片段构造，避免测试自身的恶意正则文本被当作生产消费者；
- scanner 只允许明确的 adapter、compatibility entry 和 test/legacy/** 路径，禁止对整个测试树或整个 runtime 做 blanket exemption；
- verify:renderer-legacy 的真实仓库扫描结果为空。

这里经历过一次真实 RED：初版依赖反转后，严格扫描器仍发现 plugin-host.ts 和散落在旧路径的兼容测试；没有弱化扫描器，而是完成文件归位和窄类型修正，最后提交 0365cff 后转 GREEN：

~~~text
npm run verify:renderer-legacy     3/3 tests + real scan PASS
npm run verify:renderer-boundaries 3/3 tests + real scan PASS
~~~

静态入口证据（同一 A/B worktree 的 Starter bundle）：

| token | M7.5 baseline | 最终 current |
|---|---:|---:|
| summarizeRendererMetricV3 | false | false |
| pairedMedianRatio | false | false |
| packageLockSha256 | false | false |
| historicalComparison | false | false |
| __surdetDebug | true | true |
| __rendererV2Debug | false | true |
| rendererV2Layers | false | true |
| new PixiStage | false | false |
| new AdvRenderer | false | false |

其中 __rendererV2Debug/rendererV2Layers 只用于受控验收的只读语义证据，不改变公开 Runtime contract；v3 comparator 和 legacy 构造器没有静态进入 Starter 启动入口。

### 3.4 P1-4：17 状态视觉/语义验收

packages/shell/e2e/renderer-v2-acceptance.e2e.mjs 现在对每个状态同时执行语义检查和截图保存；没有批准 manifest，所以视觉状态保持 CANDIDATE。最新 manifest：

~~~text
manifest = E:\surdet\packages\shell\e2e\artifacts\renderer-v2-review-2026-08-09T18-06-52-714Z-18436\manifest.json
contact sheet = E:\surdet\packages\shell\e2e\artifacts\renderer-v2-review-2026-08-09T18-06-52-714Z-18436\contact-sheet.png
manifest schema = 1
visualStatus = CANDIDATE
approvedManifestPath = null
page errors = 0
console errors = 0
failed requests = 0
~~~

17 个状态的原始证据摘要如下；每一行对应保留在该 review 目录中的 PNG：

| 状态 | 语义 | PNG bytes | SHA-256 前 16 位 |
|---|---|---:|---|
| title | PASS | 35,221 | aca617dcc09733b2 |
| settings | PASS | 53,146 | 9d999e4e96c573e6 |
| gallery-tabs | PASS | 15,691 | 941a0edaf45352d4 |
| adv-ruby | PASS | 294,234 | efff9f268e95ecc5 |
| narration | PASS | 290,352 | 497a922ffd806d83 |
| choice | PASS | 295,895 | 4e667dc6d168450c |
| nvl | PASS | 129,098 | 5ddac0bc349c16ca |
| backlog | PASS | 117,263 | 0c52caa780d7e0fa |
| settings-command | PASS | 158,619 | 9917c41c3007c9da |
| save-load | PASS | 137,455 | 5327aa6a52523d0a |
| gallery-command | PASS | 111,428 | 4b8d66d3751faa56 |
| map | PASS | 92,222 | 19a1b11e92882ede |
| base | PASS | 89,784 | 74dfbaa6b8b98a89 |
| shop | PASS | 88,803 | 763cf5e96ed3a271 |
| battle | PASS | 132,463 | d39e0239f9fed73c |
| particle-transition | PASS | 274,535 | e1e528f718a3a209 |
| reduced-motion | PASS | 287,482 | b7118ca6f3c702cf |

语义覆盖包括 title/settings/gallery overlay、Gallery counts、Ruby base/text projection、旁白 speaker null、choice 两项标签、NVL 两行、Backlog、save/load slots、map/base/shop/battle/system projections、particle transition、reduced-motion，以及 system boundary rollback probe。命令退出码为 0；“PASS”只表示语义断言通过，不表示视觉审批已通过。

## 4. M8 工具卫生修复

### 4.1 资源完成状态

packages/shell/e2e/renderer-baseline-v3-artifact.mjs 对每一个 warmup 和 formal raw launch 强制验证：

~~~text
assetLoading.total > 0
assetLoading.completed === assetLoading.total
assetLoading.failed === 0
assetLoading.done === true
~~~

六类恶意篡改均被拒绝：completed=0、completed<total、total=0、done=false、删除 done、failed>0。Shell artifact test 结果为 12/12。

### 4.2 sampledAt 与 rebuiltAt

没有凭记忆填写原始生成时间，而是从提交 9d39dc9 机械读取：

~~~text
generatedAt = 2026-08-09T13:31:47.300Z
~~~

离线重建只更新 rebuiltAt，保留 sampledAt；测试证明重复 rebuild 不改变 sampledAt。本次 M8 A/B 使用新的真实采样时间并明确分栏：

~~~text
sampledAt = 2026-08-09T17:59:23.247Z
rebuiltAt = 2026-08-09T18:00:47.606Z
~~~

两者均为合法 ISO 时间，正式 artifact validator 通过。

## 5. Renderer bundle 与增量证据

最终 A/B worktree 中 Starter 主 bundle：

| 版本 | 文件 | bytes | SHA-256 |
|---|---|---:|---|
| M7.5 / baseline | index-15Xa0GkV.js | 626,453 | a4a24f2e75180b06253ab4235be85b7febcd203586b2b723a62bfdc57c351681 |
| 最终 current | index-kPN0Rmwv.js | 656,218 | 3484fd31de3feba8201597bbc4614cdf612d068777d49c887b6f438a8e0b72f4 |

历史静态值及增量：

| 比较 | bytes 增量 | 相对增量 |
|---|---:|---:|
| M0/cab200b 583,620 → M6 618,400 | +34,780 | 5.960% |
| M6 618,400 → M7 626,051 | +7,651 | 1.237% |
| M7 626,051 → M7.5 626,453 | +402 | 0.064% |
| M7.5 626,453 → M8 656,218 | +29,765 | 4.751% |
| M6 618,400 → M8 656,218 | +37,818 | 6.115% |
| M0 583,620 → M8 656,218 | +72,598 | 12.439% |

M8 新增的静态可达内容是受控 Layer 诊断证据 channel；v3 比较器本身没有静态进入 Starter。M8 没有在没有热点证据时做缓存、懒加载或阈值调整，也没有用 M8 增量 PASS 覆盖 M0 历史风险。

## 6. 全量门禁结果

以下命令均在最终源码/最终工作树上重新执行并退出码为 0：

| 命令 | 结果 |
|---|---|
| npm test -w @surdet/renderer -- legacy-stage-contract.test.ts legacy-renderer-contract.test.ts renderer-runtime.test.ts resource-cycles.test.ts | 4 文件 / 12/12 |
| npm test -w @surdet/renderer | 46 文件 / 323/323 |
| npm run typecheck -w @surdet/renderer | PASS |
| npm run build -w @surdet/renderer | PASS |
| npm test -w surdet-starter | 3 文件 / 5/5 |
| npm run typecheck -w surdet-starter | PASS |
| npm run build -w surdet-starter | PASS |
| npm test -w surdet-editor | 20 文件 / 135/135 |
| npm run typecheck -w surdet-editor | PASS |
| npm run build -w surdet-editor | PASS |
| npm test -w @surdet/cli -- new.test.ts lint.test.ts | 2 文件 / 57/57 |
| npm run typecheck -w @surdet/cli | PASS |
| npm run verify:renderer-boundaries | 3/3 + real scan PASS |
| npm run verify:renderer-legacy | 3/3 + real scan PASS |
| npm run verify:tools | 7/7 |
| npm run verify:docs | PASS |
| npm run verify:all | PASS |
| npm run e2e:renderer-v2 -w @surdet/shell | 17/17 semantic states；page/console/request errors 0 |
| npm run e2e -w @surdet/shell | PASS；save/load true，steps=55，choices=41 |
| npm run lint -w zero-after-midnight | 11 scenes；0 errors；0 warnings |
| npm run simulate -w zero-after-midnight | 23/23；3 endings；39 save/load；runtime errors 0 |
| node examples/zero-after-midnight/scripts/check-assets.mjs | 44 assets PASS |
| npm run build -w zero-after-midnight | PASS |
| node packages/shell/e2e/renderer-baseline-v3-verify.mjs | M7.5 sceneP95Ms 红灯保留 |
| M8 official A/B artifact validator | PASS 验证结构；正式 menuOpenP95Ms 保留 FAIL |
| node packages/shell/scripts/verify-pack.mjs --artifact | PASS；app.asar 身份、关键文件和加密素材通过 |
| git diff --check | PASS |

verify:all 中各 workspace 测试的最新组成是：CLI 86、Core 298、Editor 135、Host 18、Renderer 323、Shell 44、Starter 5；合计 909 个 workspace 测试，另含正式游戏 verify/simulate/build 流程。该数字不包含 17 项独立视觉状态的语义断言和独立 E2E 流程。

## 7. 正式游戏和 Windows 包

### 7.1 《零点之后》

独立命令结果：

~~~text
入口             = prologue
场景             = 11
choice 分支      = 23/23
可达结局         = testimony_end / meeting_end / silence_end
结局数量         = 3
save/load 往返   = 39
运行时错误       = 0
资产             = 44
~~~

正式 game lint、simulate、assets check、build 和 Shell Electron E2E 全部通过。没有改动正式游戏剧本或规则。

### 7.2 本地包校验

因为本轮确实改变了正式可达 runtime，按授权要求重新执行了本地 pack 和 artifact verify。pack 输出确认：

~~~text
目标：zero-after-midnight 0.1.0
入口：prologue
素材：50
加密：true
加密方式：AES-256-GCM
~~~

verify-pack.mjs --artifact 通过，app.asar 关键文件、游戏身份和加密素材校验通过。以下是当前本地包中所有相关 EXE 的只读 SHA-256 记录；release 输出为 ignored 生成物，没有加入 Git，也没有对外发行：

| 文件 | bytes | LastWriteTime（+08:00） | SHA-256 |
|---|---:|---|---|
| E:\surdet\packages\shell\release\SurdetGame-0.1.0.exe | 298,945,255 | 2026-08-10T02:10:20.8822342+08:00 | c5e48c40ee78d09b25680880d217d7d42921d6b46e6dbcadf581f134bd988f03 |
| E:\surdet\packages\shell\release\SurdetGame-Setup-0.1.0.exe | 299,175,076 | 2026-08-10T02:10:23.9624280+08:00 | d140b4bb90eb7269e15e004b2eba595c357486a9b633d147dc1d6d4dd537c226 |
| E:\surdet\packages\shell\release\win-unpacked\Surdet Game.exe | 225,613,824 | 2026-08-10T02:08:12.3617175+08:00 | cc0bdfbda6340a63e8cb3f6b4ed2fdf6a1d016317c7b4c4cb1326331797f0cfb |

elevate.exe 是 electron-builder 的内部辅助文件，不作为 Surdet 游戏发行 EXE 计入上表；其 SHA-256 为 9b1fbf0c11c520ae714af8aa9af12cfd48503eedecd7398d8992ee94d1b4dc37。

## 8. 首次失败、修复和未隐藏的观察

本报告不把失败的中间尝试伪装成一次性成功：

1. Starter teardown 测试先因实现文件不存在而 RED；补实现后 2 个专门测试和完整 Starter 5 个测试通过。
2. runtime 依赖反转的初版实际扫描先在 plugin-host.ts 与散落的旧兼容测试上失败；通过窄类型、测试归位和精确 allowlist 修复，而不是放宽扫描器；最终 verify:renderer-legacy 3/3 和真实扫描通过。
3. 测试文件迁移后，npm run verify:docs 曾因能力矩阵仍指向旧路径 packages/renderer/test/adv-renderer.test.ts / pixi-stage.test.ts 而失败；只同步 docs/capabilities.json 和生成的 docs/capability-matrix.md，然后文档门禁恢复通过。
4. 早期一次 A/B 尝试因两个隔离 worktree 的 package-lock 字节 SHA 不一致，被比较器在计入样本前拒绝；该轮没有计入正式样本。统一 npm ci 和 package-lock SHA 后才执行本报告所列唯一有效的 20 对 A/B。
5. 视觉 harness 早期 contact-sheet 尝试使用 Electron 不支持的额外 page 接口；改为复用同一个受控 page 后，最终 17 状态命令通过。最终视觉结果仍全部保持 CANDIDATE，没有把语义通过冒充人工视觉批准。
6. A/B 官方命令因为 menuOpenP95Ms 正式失败而返回非零；没有吞掉该失败。artifact 仍单独由官方 validator 验证结构、健康状态、原始样本和比较字段，并在报告中保留红灯。

## 9. 完整实际改动范围

相对于本轮限定整改起点 9644076504cdecc585a5ef3eb96737db9baca553，截至报告写入前 HEAD，Git 统计为 34 个路径、+1,802 / −1,151 行。实际路径如下：

~~~text
.gitignore
docs/baselines/renderer-v3-m8-ab-2026-08-10.json
docs/capabilities.json
docs/capability-matrix.md
examples/starter/src/main.ts
examples/starter/src/starter-owner-teardown.ts
examples/starter/test/starter-owner-teardown.test.ts
examples/zero-after-midnight/src/main.ts
packages/editor/test/preview-runtime-contract.test.ts
packages/renderer/src/adv-renderer.ts
packages/renderer/src/layers/dialogue/dialogue-layer.ts
packages/renderer/src/layers/gallery/gallery-layer.ts
packages/renderer/src/layers/menu/menu-layer.ts
packages/renderer/src/layers/system-panel/system-panel-layer.ts
packages/renderer/src/layers/world/world-layer.ts
packages/renderer/src/legacy/legacy-renderer-adapter.ts
packages/renderer/src/plugin-host.ts
packages/renderer/src/runtime/create-renderer-runtime.ts
packages/renderer/src/runtime/presentation-controller.ts
packages/renderer/src/runtime/presentation-ports.ts
packages/renderer/src/runtime/renderer-facade.ts
packages/renderer/test/integration/resource-cycles.test.ts
packages/renderer/test/legacy/adv-renderer.test.ts (from test/adv-renderer.test.ts)
packages/renderer/test/legacy/dialogue-layer.test.ts (from test/layers/dialogue-layer.test.ts)
packages/renderer/test/legacy/menu-layer.test.ts (from test/layers/menu-layer.test.ts)
packages/renderer/test/legacy/nvl.test.ts (from test/nvl.test.ts)
packages/renderer/test/legacy/pixi-stage.test.ts (from test/pixi-stage.test.ts)
packages/renderer/test/legacy/plugin-host.test.ts (from test/plugin-host.test.ts)
packages/renderer/test/legacy/presentation-controller.test.ts (from test/runtime/presentation-controller.test.ts)
packages/shell/e2e/renderer-baseline-v3-ab.e2e.mjs
packages/shell/e2e/renderer-v2-acceptance.e2e.mjs
scripts/check-renderer-legacy-usage.mjs
scripts/test/renderer-legacy-usage.test.mjs
scripts/test/renderer-runtime-boundary.test.mjs
~~~

明确未修改、未暂存、未提交、未删除、未移动、未推送：

~~~text
USER.md
SESSION-HANDOFF.md
docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
docs/baselines/renderer-v2-cab200b.json
~~~

冻结 v2 baseline SHA-256 现场值：

~~~text
docs/baselines/renderer-v2-cab200b.json
DE0AA52BEF955165213123EDA9632D14456355828A15B2FE9F4CBB548D934EDC
~~~

同时未修改 docs/dsl-spec.md、存档 schema/迁移、packages/core、正式游戏 .gal 剧本和游戏规则；release、日志、截图、缓存及生成目录未纳入 Git。

## 10. 交付结论与下一步边界

本轮只执行 M8 最终限定整改，没有启动 M9，没有进行计划外架构扩张，没有修改阈值，也没有为了性能红灯进行无证据优化。

当前可交付给独立复审的事实是：

1. 工具卫生和资源完成状态校验已关闭；
2. runtime/legacy 依赖方向和严格扫描已关闭；
3. Starter teardown 已关闭；
4. 17 状态视觉/语义证据已完整生成，但视觉审批仍等待人工/总经理批准；
5. 正式游戏和本地加密包可验证；
6. 性能正式门禁没有关闭：M8 A/B 的 menuOpenP95Ms 失败，M7.5 冻结候选的 sceneP95Ms 红灯也继续保留。

因此本报告完成后立即停止在 WAITING_FOR_REVIEW，不 push、不 force push、不发行，等待总经理独立复审及后续明确授权。

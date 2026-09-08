# 雾港来信

这是一个约 5–10 分钟读完的现代视觉小说切片。玩家与成年搭档凛在雾港旧邮局接下一封退回三次的旧信，查出灯塔地址早已被邮局撤出邮路，再把信送到山上；出发前的提问、查验和等待会改变凛愿意说出的内容，也会影响灯塔前的三种结局。

主线入口由 `game.config.json` 的 `entryScene: "ch01_01"` 指向。主线依次经过 `ch01_01`（雾港）、`ch01_02`（旧邮局后门）和 `ch02`（灯塔），再跳到 `ending_open_door`、`ending_unanswered` 或 `ending_delivered` 之一；这些 `ending_` 场景结束后回到标题。`playground.gal` 是标题里的“自由探索”入口，主线不会强迫玩家打开地图、商店或战斗。

## 推荐主线

想看最完整的关系变化，可以在第一处选择先问清凛与沈岳的关系，第二处选择等她准备好，灯塔前让凛亲自把信交出去。也可以查退回章，再选择替她解释，让凛带着“地址已撤出邮路”的记录见沈岳；只递信、不替任何人解释会得到只完成送件的结局。

## 自由探索验收路径

从标题选择“自由探索”进入 `playground`。菜单中的地图会打开雾港日程，补给会打开商店并反馈金币与背包；演练进入港口教练的非致命 `fight_01`，结束后才记录完成、给凛经验并反馈结果。完成任一项后可回到探索菜单，选择“返回标题”结束 `playground`。

## 目录约定

```
content/scenario/*.gal   剧本（场景 ID = 文件名）
content/config/          角色关系与系统配置
content/assets/bg/       harbor、post_office、lighthouse_dawn 背景
content/assets/portrait/ 人物透明立绘
content/assets/avatar/   角色头像
```

作者从 `content/scenario/*.gal` 修改剧情与分支，从 `game.config.json` 修改变量和入口，从 `content/config/*.json` 修改地图、商店、战斗、成长、回想与成就配置。入口“自由探索”由 Starter 共享 Player 的额外入口配置指向 `playground`。

在仓库根目录启动与验证：

```bash
npm run dev -w surdet-starter
node packages/cli/dist/index.js lint examples/starter
node packages/cli/dist/index.js simulate examples/starter --max-paths 200
npm run verify:starter
```

玩家可用点击/空格推进、Esc 打开菜单、↑ 回退，存档、读档、设置和鉴赏都经过现有公共 Player Shell。Starter 与 `surdet new` 使用同一个 [玩家入口](../shared/player/player.ts)，项目入口只负责内容、素材、主题和可选系统配置。新增能力先扩展公共层，避免复制另一套菜单或恢复接线。

图片来源、生成提示词和字体说明见 [素材说明](content/assets/README.md)。当前切片没有音频文件，音乐页显示真实空状态。

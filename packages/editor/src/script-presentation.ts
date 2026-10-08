/** Display names only. Script tokens and tool-facing identifiers are unchanged. */
const INSTRUCTION_NAMES: Record<string, string> = {
  scene: '场景', label: '段落标记', bg: '背景', show: '人物出场', hide: '人物退场',
  bgm: '背景音乐', ambience: '环境音', se: '音效', voice: '语音', video: '视频',
  wait: '等待', fadein: '淡入', fadeout: '淡出', flash: '闪白', shake: '画面震动',
  wipe: '擦除转场', zoom: '镜头缩放', transition: '转场', mov: '人物移动', tint: '画面染色',
  particle: '粒子特效', title: '标题提示', chapter: '章节提示', center: '居中文字',
  tip: '提示', note: '注记', nvl: '全屏阅读', timeline: '演出', stage: '舞台',
  set: '变量赋值', mod: '变量增量', inc: '变量加一', dec: '变量减一',
  toggle: '切换开关', flag: '开启标记', unflag: '关闭标记', check: '条件检查', random: '随机数',
  if: '条件', elif: '其他条件', else: '否则', endif: '条件结束', switch: '多路分支',
  choice: '分支选择', goto: '前往段落', loop: '循环', jump: '前往场景', call: '调用场景',
  return: '返回调用处', end: '结束', clear: '登记结局', autosave: '自动存档', savepoint: '保存节点',
  unlock_cg: '解锁鉴赏图片', unlock_music: '解锁鉴赏音乐', unlock_text: '解锁剧情回想',
  unlock_profile: '解锁人物资料', unlock_term: '解锁用语词条', achievement: '成就',
  add_item: '添加道具', remove_item: '移除道具', has_item: '检查道具', item: '道具',
  exp: '增加经验', battle: '战斗', calendar: '日历与地图', affection: '好感阶段', event: '事件', shop: '商店',
};

export function instructionLabel(name: string): string { return INSTRUCTION_NAMES[name] ?? `自定义指令（${name}）`; }

export const PARTICLE_NAMES: Readonly<Record<string, string>> = {
  snow: '飘雪', rain: '下雨', sakura: '落樱', sparkle: '闪光', fireflies: '萤火虫',
};

export function instructionArgumentSummary(name: string, args: string[]): string {
  const values = [...args];
  if (name === 'particle' && values[0]) values[0] = values[0] === 'off' ? '关闭特效' : PARTICLE_NAMES[values[0]] ?? values[0];
  if (name === 'nvl' && values[0]) values[0] = ({ on: '开启', off: '关闭', clear: '清空本页' } as Record<string, string>)[values[0]] ?? values[0];
  if (name === 'achievement' && values[0] === 'unlock') values[0] = '解锁';
  if (['wait', 'fadein', 'fadeout'].includes(name) && values[0] && /^\d+(\.\d+)?$/.test(values[0])) values[0] += ' 毫秒';
  return values.join('  ') || (name === 'choice' ? '选择剧情走向' : '');
}

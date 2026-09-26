import {
  decodeStageToken, parseProjectStage, readProjectStage, stageCommandFromInstruction, stagePoseFromModifiers,
  validateStageFrame, resolveTimelineDefinition, type LintIssue, type ProjectStage, type StageCommand, type TimelineDefinition,
} from '@surdet/core';
import type { ProjectSnapshot } from './project-snapshot.js';
import type { ProjectAssetCatalog } from './contracts.js';

export function validateProjectStageContent(snapshot: ProjectSnapshot, assets?: ProjectAssetCatalog): LintIssue[] {
  const issues: LintIssue[] = [];
  const add = (error: unknown, file: string, line = 1, code = 'STAGE_INVALID') => issues.push({ severity: 'error', code,
    text: error instanceof Error ? error.message : String(error), file, line, col: 1 });
  let stage: ProjectStage | null;
  try { stage = readProjectStage(snapshot.config); }
  catch (error) { add(error, 'game.config.json'); return issues; }
  const effective = stage ?? parseProjectStage({ version: 1 });
  const background = (key: string, file: string, line = 1) => {
    if (assets && !assets.backgrounds.some(item => item.key === key && item.resolved)) add(`舞台图片不存在或不唯一：${key}`, file, line, 'STAGE_ASSET_MISSING');
  };
  const portrait = (target: string, expression: string, file: string, line = 1) => {
    const normalized = target.includes(':') ? target : `${target}:normal`;
    if (assets && !assets.portraits.some(item => item.timelineTarget === normalized && item.expression === expression && item.resolved))
      add(`舞台角色素材不存在或不唯一：${normalized}:${expression}`, file, line, 'STAGE_ASSET_MISSING');
  };
  for (const [id, composition] of Object.entries(stage?.compositions ?? {})) {
    if (composition.background != null) background(composition.background, 'game.config.json');
    for (const layer of composition.layers ?? []) background(layer.key, 'game.config.json');
  }
  for (const [target, profile] of Object.entries(stage?.portraits ?? {})) {
    for (const expression of new Set([...Object.keys(profile.expressions), ...Object.keys(profile.sources)])) {
      portrait(target, expression, 'game.config.json');
      const pin = profile.sources[expression];
      if (!pin) continue;
      const mapped = assets?.portraits.find(item => item.timelineTarget === target && item.expression === expression && item.resolved);
      const actual = assets?.intelligence.items.find(item => item.physical && item.sourcePath === pin.path);
      if (actual?.sha256 !== undefined && actual.sha256 !== pin.sha256) add(`校准图片内容已改变：${pin.path}；请重新确认可见范围和锚点`, 'game.config.json', 1, 'STAGE_CALIBRATION_STALE');
      if (mapped && mapped.sourcePath !== pin.path) add(`校准来源映射已变化：${target}:${expression}`, 'game.config.json', 1, 'STAGE_CALIBRATION_STALE');
      if (profile.expressions[expression]) try { validateStageFrame(profile.expressions[expression], pin.width, pin.height); }
      catch (error) { add(error, 'game.config.json'); }
    }
  }
  const validateCommand = (command: StageCommand, file: string, line: number) => {
    if (command.type === 'composition' && !Object.prototype.hasOwnProperty.call(effective.compositions, command.id)) throw new Error(`构图不存在：${command.id}`);
    if (command.type === 'layer') background(command.definition.key, file, line);
    if (command.type === 'pose' || command.type === 'show') {
      const modifiers = new Map(Object.entries(command.modifiers ?? {}));
      stagePoseFromModifiers(effective, command.target, modifiers);
      if (command.type === 'show' && (stage !== null || command.instance !== undefined || [...modifiers.keys()].some(key => key !== 'pos')))
        portrait(command.target, command.expression, file, line);
    }
    if (command.type === 'layer-pose') {
      if (Object.keys(command.modifiers).some(key => !['x', 'y', 'scale', 'opacity', 'alpha', 'z'].includes(key))) throw new Error('图层变换只接受坐标、缩放、透明度和顺序');
      stagePoseFromModifiers(effective, '', new Map(Object.entries(command.modifiers)));
    }
  };
  for (const scene of snapshot.scenes) for (const instruction of scene.compiled.instructions) {
    if (instruction.op !== 'instr' || !['show', 'pose', 'layer', 'stage'].includes(instruction.name)) continue;
    try {
      const command = stageCommandFromInstruction(instruction.name, instruction.args.map(decodeStageToken),
        new Map([...instruction.modifiers].map(([key, value]) => [key, decodeStageToken(value)])));
      if (command) validateCommand(command, scene.path, instruction.line);
    } catch (error) { add(error, scene.path, instruction.line); }
  }
  const definitions = new Map<string, { path: string; definition: TimelineDefinition }>();
  for (const file of snapshot.timelines) {
    try { const definition = JSON.parse(file.text.replace(/^\uFEFF/, '')) as TimelineDefinition;
      if (definition.version === 1 || definition.version === 2) definitions.set(file.path.replace(/^.*\//, '').replace(/\.json$/i, ''), { path: file.path, definition });
    } catch { /* Existing JSON validator reports the exact malformed file. */ }
  }
  for (const { path, definition } of definitions.values()) {
    if (definition.version !== 2) continue;
    try {
      const resolved = resolveTimelineDefinition(definition, id => definitions.get(id)?.definition);
      for (const track of resolved.tracks) for (const cue of track.cues) {
        if (track.kind === 'layer' && cue.action === 'show' && typeof cue.key === 'string') background(cue.key, path);
        if (track.kind === 'portrait') {
          const target = typeof cue.source === 'string' ? cue.source : track.target ?? '';
          if (cue.action === 'show' || cue.action === 'expression') portrait(target, String(cue.expression), path);
          if (['show', 'pose', 'move'].includes(cue.action)) {
            const modifiers = new Map<string, string>();
            for (const name of ['x', 'y', 'scale', 'opacity', 'z', 'facing', 'distance', 'baseHeight', 'anchorX', 'anchorY']) if (cue[name] !== undefined) modifiers.set(name, String(cue[name]));
            if (cue.position !== undefined) modifiers.set('pos', String(cue.position));
            stagePoseFromModifiers(effective, target, modifiers);
          }
        }
      }
    } catch (error) { add(error, path, 1, 'STAGE_TIMELINE_INVALID'); }
  }
  return issues;
}

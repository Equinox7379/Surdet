import { loadProjectSnapshot, type SimulationReport, type SimulationOptions, type StoryLocation, type PreviewTraceMessage } from '@surdet/authoring';
import { previewTextHash } from './preview-content.js';

export interface StoryCheckInput { files: Record<string, string> }
export interface StoryCheckResult { revision: string; report: SimulationReport; options: SimulationOptions }
export interface StoryCheckFailure { message: string; code: string; file?: string; line?: number; col?: number }
export function storyInputKey(input: StoryCheckInput): string { return JSON.stringify(Object.entries(input.files).sort(([a], [b]) => a.localeCompare(b))); }
export async function storySnapshot(input: StoryCheckInput) {
  return loadProjectSnapshot({ rootIdentity: 'editor-story-check', listFiles: async () => Object.keys(input.files),
    exists: async file => Object.hasOwn(input.files, file), readText: async file => {
      const text = input.files[file]; if (text === undefined) throw new Error(`检查内容缺少文件：${file}`);
      return { path: file, text, sha256: await previewTextHash(text), bytes: new TextEncoder().encode(text).length };
    } }, { sha256: previewTextHash });
}

export interface StoryPreview {
  traceId: string; owner: unknown; scope: string; working: boolean; revision: string; seed: number;
  isCurrent: () => boolean;
  sources: { id: string; file: string; text: string; version: string }[];
  generation: number | null; sequence: number; completed: boolean; status: 'starting' | 'running' | 'passed' | 'failed';
  eventCount: number; scenes: string[]; choices: number; conditions: { passed: number; failed: number };
  events: { kind: string; location: StoryLocation; optionIndex?: number; conditionResult?: boolean }[];
  errors: { phase: string; message: string; location: StoryLocation | null }[];
}
let latestPreview: StoryPreview | null = null;
export function readStoryPreview(): StoryPreview | null { return latestPreview; }
export function clearStoryPreview(): void { latestPreview = null; }
export async function prepareStoryPreview(input: {
  traceId: string; owner: unknown; scope: string; working: boolean; seed: number; sources: { id: string; file: string; text: string }[];
  contentKey: string; isCurrent: () => boolean;
}): Promise<StoryPreview> {
  return { ...input, revision: await previewTextHash(input.contentKey), sources: await Promise.all(input.sources.map(async source => ({ ...source, version: await previewTextHash(source.text) }))),
    generation: null, sequence: -1, completed: false, status: 'starting', eventCount: 0, scenes: [], choices: 0, conditions: { passed: 0, failed: 0 }, events: [], errors: [] };
}
export function activateStoryPreview(preview: StoryPreview): void { latestPreview = preview; }
export function appendStoryPreview(message: PreviewTraceMessage): void {
  const record = latestPreview; if (!record || record.traceId !== message.traceId) return;
  if (message.type === 'surdet-preview-trace-start') {
    if (record.generation !== null) return;
    record.generation = message.generation; record.status = 'running'; return;
  }
  // A diagnostic can arrive before buffered trace events. Only the trace's
  // completion message closes the event stream, not the visible failure status.
  if (record.generation !== message.generation || record.completed) return;
  if (message.type === 'surdet-preview-trace-event') {
    if (message.sequence <= record.sequence) return;
    record.sequence = message.sequence;
    const source = message.event.source, scene = record.sources.find(scene => scene.id === source.sceneId);
    if (!scene) return;
    const location: StoryLocation = { sceneId: scene.id, file: scene.file, sourceVersion: scene.version, index: source.index, line: source.line, col: source.col };
    record.eventCount++;
    if (!record.scenes.includes(scene.id)) record.scenes.push(scene.id);
    if (message.event.choice) record.choices++;
    if (message.event.condition) { if (message.event.condition.result) record.conditions.passed++; else record.conditions.failed++; }
    record.events.push({ kind: message.event.kind, location,
      ...(message.event.choice ? { optionIndex: message.event.choice.optionIndex } : message.event.condition?.optionIndex !== undefined ? { optionIndex: message.event.condition.optionIndex } : {}),
      ...(message.event.condition ? { conditionResult: message.event.condition.result } : {}) });
    if (record.events.length > 40) record.events.shift();
  } else {
    record.completed = true;
    record.status = record.errors.length ? 'failed' : message.status;
    if (message.firstError) {
      const existing = record.errors.find(error => error.message === message.firstError);
      if (existing) { if (existing.phase === 'runtime') existing.location = record.events.at(-1)?.location ?? null; }
      else record.errors.push({ phase: 'runtime', message: message.firstError, location: record.events.at(-1)?.location ?? null });
    }
  }
}
export function appendStoryPreviewError(traceId: string, phase: string, message: string, point?: { sceneId?: string; line?: number; col?: number }) {
  const record = latestPreview; if (!record || record.traceId !== traceId) return;
  const scene = record.sources.find(scene => scene.id === point?.sceneId);
  const location = scene && point?.line ? { sceneId: scene.id, file: scene.file, sourceVersion: scene.version, line: point.line, col: point.col ?? 1, index: -1 }
    : phase === 'runtime' ? record.events.at(-1)?.location ?? null : null;
  const existing = record.errors.find(error => error.message === message);
  if (existing) { if (location) existing.location = location; existing.phase = phase; return; }
  record.errors.push({ phase, message, location }); if (record.errors.length > 20) record.errors.shift(); record.status = 'failed';
}

/** Export fixed facts only: no raw errors, variable values, story text or presentation snapshots. */
export function storyDiagnostic(input: { check?: StoryCheckResult | null; checkCurrent?: boolean; failure?: StoryCheckFailure | null; preview?: StoryPreview | null }) {
  const check = input.check, preview = input.preview;
  return {
    schemaVersion: 1, kind: 'surdet-story-diagnostic', exportedAt: new Date().toISOString(),
    ...(check ? { simulation: { revision: check.revision, current: input.checkCurrent === true, status: check.report.status,
      entryScene: check.report.entryScene, seed: check.report.seed, maxPaths: check.options.maxPaths ?? 500, maxStepsPerPath: check.options.maxStepsPerPath ?? 20000,
      initialOverrideCount: Object.keys(check.options.initialVariables ?? {}).length, pathsExplored: check.report.pathsExplored, budgetExhausted: check.report.budgetExhausted,
      scenes: check.report.coverage.scenes, branches: check.report.coverage.branches.map(({ label: _label, ...branch }) => branch),
      conditions: check.report.coverage.conditions.map(({ expression: _expression, ...condition }) => condition),
      stops: check.report.coverage.stops.map(({ message: _message, ...stop }) => stop), hostInstructions: check.report.coverage.hostInstructions } } : {}),
    ...(input.failure ? { checkFailure: { code: input.failure.code, ...(input.failure.file ? { file: input.failure.file } : {}),
      ...(input.failure.line ? { line: input.failure.line, col: input.failure.col ?? 1 } : {}) } } : {}),
    ...(preview ? { preview: { revision: preview.revision, scope: preview.scope, current: preview.working ? preview.isCurrent() : null, status: preview.status, seed: preview.seed,
      eventCount: preview.eventCount, sampledEvents: preview.events.length, scenes: preview.scenes, choices: preview.choices, conditions: preview.conditions,
      events: preview.events, errors: preview.errors.map(({ message: _message, ...error }) => error) } } : {}),
  };
}

import { AuthoringOperationError, evidenceFreshness, stableStringify } from './change-session.js';
import type {
  CandidateCapsuleRef,
  CandidateEvidenceSummary,
  CompositionManifest,
  CompositionComparison,
  CompositionOperation,
  ObjectChangeUnit,
  VerifiedCompositionCandidate,
} from './composition-contracts.js';
import type { AuthoringObject, ChangeRecord, TextHasher } from './contracts.js';
import type { ChangeDiff } from './diff.js';
import { parseSceneDocument } from './scene-document.js';
import { compileScene } from '@surdet/core';
import type { IntegrationPlan } from './integration-plan.js';
import type {
  CandidateAdoptionPreset,
  CreativeBriefInput,
  HumanReviewProjection,
  HumanReviewProjectionV1,
  HumanReviewProjectionV2,
  ReviewActualResultExplanation,
  ReviewCandidateClaim,
  ReviewCandidateVerifiedFacts,
  ReviewCandidateV2,
  ReviewCandidateRuntimeInput,
  ReviewChangedObjectFact,
  ReviewChoiceFact,
  ReviewCreativeBrief,
  ReviewCandidate,
  ReviewConflict,
  ReviewDependency,
  ReviewEvidenceSummary,
  ReviewFinalResult,
  ReviewHumanFact,
  ReviewObjectSummary,
  ReviewRuntimePathFact,
  ReviewRuntimeTraceInput,
  ReviewResultFreshness,
  ReviewRuntimeTraceObservation,
  ReviewSceneFact,
  ReviewSafeGroup,
  ReviewTimelineFact,
  ReviewUnitOutcome,
  ReviewVariableFact,
  ReviewAssetFact,
  ReviewWarning,
} from './review-contracts.js';
import {
  buildReviewUnitPresentation,
  metadataOnlyReviewUnitPresentation,
} from './review-presentation.js';
import {
  deriveWholeCandidateSelection,
  isReviewDecisionIntent,
  type ReviewDecisionCandidate,
  type ReviewDecisionIntent,
} from './review-decision-preview.js';

export interface BuildComparisonReviewProjectionInput {
  reviewId: string;
  comparison: CompositionComparison;
  /** Defaults to v1 so existing callers keep the historical payload and fingerprint. */
  reviewVersion?: '1.0.0' | '2.0.0';
  creativeBrief?: CreativeBriefInput;
  candidates: Array<Pick<VerifiedCompositionCandidate,
    'candidateId' | 'ref' | 'evidenceSummary'> & {
      intent?: string;
      acceptanceCriteria: string[];
      manifest?: CompositionManifest;
      /** Runtime facts already selected from the candidate's sealed evidence. */
      sealedRuntimeTraceIds?: readonly string[];
      sealedFileDiffs?: ChangeDiff['files'];
      sourceWorkingRevision?: number;
      objectDiffFreshness?: VerifiedCompositionCandidate['objectDiffFreshness'];
      runtime?: ReviewCandidateRuntimeInput;
    }>;
  objects: AuthoringObject[];
}

function candidateRefKey(ref: CandidateCapsuleRef): string {
  return [ref.artifactSha256, ref.changeId, ref.capsuleId].join('\u0000');
}

function compareRefs(left: CandidateCapsuleRef, right: CandidateCapsuleRef): number {
  return left.artifactSha256.localeCompare(right.artifactSha256)
    || left.changeId.localeCompare(right.changeId)
    || left.capsuleId.localeCompare(right.capsuleId);
}

function sortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizedEvidence(summary: CandidateEvidenceSummary): CandidateEvidenceSummary {
  return {
    validation: summary.validation,
    simulation: summary.simulation,
    runtime: summary.runtime,
    warnings: summary.warnings,
    manualReviewRequired: sortedStrings(summary.manualReviewRequired),
  };
}

function sortedFacts(values: readonly unknown[]): unknown[] {
  const byIdentity = new Map<string, unknown>();
  for (const value of values) byIdentity.set(stableStringify(value), value);
  return [...byIdentity.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

function unitPresentation(
  unit: ObjectChangeUnit,
  manifests: ReadonlyMap<string, CompositionManifest | undefined>,
  detail: 'summary' | 'full' = 'summary',
): ReviewUnitOutcome['presentation'] {
  const manifest = manifests.get(unit.candidateId);
  if (manifest === undefined) return metadataOnlyReviewUnitPresentation(unit.primaryObject);
  const bySequence = new Map<number, CompositionOperation>();
  for (const operation of manifest.operations) {
    if (bySequence.has(operation.sequence)) return metadataOnlyReviewUnitPresentation(unit.primaryObject);
    bySequence.set(operation.sequence, operation);
  }
  const operations: CompositionOperation[] = [];
  for (const sequence of [...unit.operationSequences].sort((left, right) => left - right)) {
    const operation = bySequence.get(sequence);
    if (operation === undefined || operation.primaryObject !== unit.primaryObject) {
      return metadataOnlyReviewUnitPresentation(unit.primaryObject);
    }
    operations.push(operation);
  }
  return buildReviewUnitPresentation(unit.primaryObject, operations, detail);
}

function projectUnitOutcome(
  unit: ObjectChangeUnit,
  manifests: ReadonlyMap<string, CompositionManifest | undefined>,
  detail: 'summary' | 'full' = 'summary',
): ReviewUnitOutcome {
  return {
    unitId: unit.unitId,
    candidateId: unit.candidateId,
    primaryObject: unit.primaryObject,
    ...(unit.finalFingerprint === undefined ? {} : { finalFingerprint: unit.finalFingerprint }),
    outcomes: [...unit.producedObjects]
      .sort((left, right) => left.objectRef.localeCompare(right.objectRef)
        || left.disposition.localeCompare(right.disposition)
        || (left.finalFingerprint ?? '').localeCompare(right.finalFingerprint ?? ''))
      .map((outcome) => ({ ...outcome })),
    potentialImpact: sortedFacts(unit.potentialImpact),
    observedImpact: sortedFacts(unit.observedImpact),
    evidence: normalizedEvidence(unit.evidenceSummary),
    presentation: unitPresentation(unit, manifests, detail),
  };
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const record = jsonRecord(value);
  const field = record?.[key];
  return typeof field === 'string' && field.length > 0 ? field : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  const record = jsonRecord(value);
  const field = record?.[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined;
}

function arrayField(value: unknown, key: string): unknown[] {
  const record = jsonRecord(value);
  return Array.isArray(record?.[key]) ? record[key] as unknown[] : [];
}

function operationSourceFacts(
  unit: ObjectChangeUnit,
  operation: CompositionOperation,
  presentation: ReviewUnitOutcome['presentation'],
): {
  scenes: ReviewSceneFact[];
  choices: ReviewChoiceFact[];
  variables: ReviewVariableFact[];
  timelines: ReviewTimelineFact[];
  assets: ReviewAssetFact[];
  excerpts: string[];
} {
  const input = jsonRecord(operation.normalizedInput);
  const scenes: ReviewSceneFact[] = [];
  const choices: ReviewChoiceFact[] = [];
  const variables: ReviewVariableFact[] = [];
  const timelines: ReviewTimelineFact[] = [];
  const assets: ReviewAssetFact[] = [];
  const excerpts = presentation?.highlights ?? [];
  const sceneId = stringField(input, 'sceneId');
  if (operation.capabilityId === 'scene.create' || operation.capabilityId === 'scene.patch') {
    const patch = jsonRecord(input?.['patch']);
    const action = operation.capabilityId === 'scene.create'
      ? 'create'
      : stringField(patch, 'kind') ?? 'patch';
    scenes.push({
      sceneId: sceneId ?? operation.primaryObject.replace(/^scene:/, ''),
      objectRef: operation.primaryObject,
      unitId: unit.unitId,
      action,
      operationSequence: operation.sequence,
      highlights: [...excerpts],
    });
    {
      const blocks = operation.capabilityId === 'scene.create' ? arrayField(input, 'blocks')
        : stringField(patch, 'kind') === 'insertAfter' ? arrayField(patch, 'blocks')
          : stringField(patch, 'kind') === 'replaceChoiceOption' ? [{ kind: 'choice', options: [patch?.['option']] }]
            : stringField(patch, 'kind') === 'replaceChoiceGroup' ? [patch?.['choice']] : [];
      for (const block of blocks) {
        if (stringField(block, 'kind') !== 'choice') continue;
        for (const option of arrayField(block, 'options')) {
          const label = stringField(option, 'label');
          if (label === undefined) continue;
          const target = jsonRecord(option)?.['target'];
          choices.push({
            unitId: unit.unitId,
            ...(sceneId === undefined ? {} : { sceneId }),
            label,
            action,
            operationSequence: operation.sequence,
            ...(stringField(target, 'value') === undefined ? {} : { target: stringField(target, 'value') }),
          });
        }
      }
    }
  }
  if (operation.capabilityId === 'variable.ensure') {
    const name = stringField(input, 'name');
    if (name !== undefined) {
      const initial = jsonRecord(input)?.['initial'];
      variables.push({
        unitId: unit.unitId,
        name,
        ...(stringField(input, 'type') === undefined ? {} : { type: stringField(input, 'type') }),
        ...(initial === undefined || (typeof initial !== 'string' && typeof initial !== 'number'
          && typeof initial !== 'boolean' && initial !== null && !Array.isArray(initial)
          && typeof initial !== 'object') ? {} : { initial: initial as never }),
      });
    }
  }
  if (operation.capabilityId === 'timeline.create' || operation.capabilityId === 'timeline.patch') {
    const definition = jsonRecord(input?.['definition']);
    const timelineId = stringField(input, 'timelineId') ?? operation.primaryObject.replace(/^timeline:/, '');
    const tracks = arrayField(definition, 'tracks');
    const trackKinds = tracks
      .map((track) => stringField(track, 'kind'))
      .filter((kind): kind is string => kind !== undefined)
      .sort((left, right) => left.localeCompare(right));
    timelines.push({
      unitId: unit.unitId,
      timelineId,
      ...(numberField(definition, 'durationMs') === undefined ? {} : { durationMs: numberField(definition, 'durationMs') }),
      ...(definition === undefined ? {} : { trackCount: tracks.length }),
      trackKinds,
    });
  }
  for (const required of operation.requiredObjects) {
    if (!required.objectRef.startsWith('asset:')) continue;
    assets.push({ unitId: unit.unitId, assetRef: required.objectRef });
  }
  return { scenes, choices, variables, timelines, assets, excerpts };
}

function candidateContentFacts(
  units: readonly ObjectChangeUnit[],
  manifests: ReadonlyMap<string, CompositionManifest | undefined>,
): ReviewCandidateVerifiedFacts['content'] {
  const changedObjects: ReviewChangedObjectFact[] = [];
  const scenes: ReviewSceneFact[] = [];
  const choices: ReviewChoiceFact[] = [];
  const variables: ReviewVariableFact[] = [];
  const timelines: ReviewTimelineFact[] = [];
  const assets: ReviewAssetFact[] = [];
  const excerpts: string[] = [];
  let omittedFactCount = 0;
  const sortedUnits = [...units].sort((left, right) =>
    left.primaryObject.localeCompare(right.primaryObject)
    || left.unitId.localeCompare(right.unitId));
  for (const unit of sortedUnits) {
    for (const produced of unit.producedObjects) {
      changedObjects.push({
        objectRef: produced.objectRef,
        disposition: produced.disposition,
        ...(produced.finalFingerprint === undefined ? {} : { finalFingerprint: produced.finalFingerprint }),
        unitId: unit.unitId,
      });
    }
    const manifest = manifests.get(unit.candidateId);
    if (manifest === undefined) continue;
    const bySequence = new Map(manifest.operations.map((operation) => [operation.sequence, operation]));
    const usedOperations = [...unit.operationSequences]
      .sort((left, right) => left - right)
      .map((sequence) => bySequence.get(sequence))
      .filter((operation): operation is CompositionOperation => operation !== undefined);
    for (const operation of usedOperations) {
      const presentation = buildReviewUnitPresentation(unit.primaryObject, [operation], 'full');
      omittedFactCount += presentation.omittedFactCount;
      const facts = operationSourceFacts(unit, operation, presentation);
      scenes.push(...facts.scenes);
      choices.push(...facts.choices);
      variables.push(...facts.variables);
      timelines.push(...facts.timelines);
      assets.push(...facts.assets);
      excerpts.push(...facts.excerpts);
    }
  }
  const unique = <T>(items: readonly T[]): T[] => [...new Map(items.map((item) => [stableStringify(item), item])).values()]
    .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
  return {
    changedObjects: unique(changedObjects),
    scenes: unique(scenes),
    choices: unique(choices),
    variables: unique(variables),
    timelines: unique(timelines),
    assets: unique(assets),
    excerpts: unique(excerpts),
    omittedFactCount,
    finalSceneStatus: 'unavailable',
    finalSceneLimitations: [],
    finalScenes: [],
  };
}

function runtimeInputsOf(
  candidate: BuildComparisonReviewProjectionInput['candidates'][number],
): ReviewRuntimeTraceInput[] {
  const runtime = candidate.runtime;
  if (runtime === undefined || runtime.status !== 'available') return [];
  const sealedIds = new Set(candidate.sealedRuntimeTraceIds ?? []);
  const byIdentity = new Map<string, ReviewRuntimeTraceInput>();
  for (const trace of runtime.traces) {
    if (sealedIds.size > 0 && !sealedIds.has(trace.traceId)) continue;
    const value: ReviewRuntimeTraceInput = {
      sourceChangeId: runtime.sourceChangeId,
      sourceWorkingRevision: runtime.sourceWorkingRevision,
      traceId: trace.traceId,
      events: trace.events,
      status: trace.status,
    };
    if (!value || typeof value.traceId !== 'string' || value.traceId.length === 0
      || typeof value.sourceChangeId !== 'string' || value.sourceChangeId.length === 0
      || !Number.isInteger(value.sourceWorkingRevision)
      || !Array.isArray(value.events)) continue;
    const key = [value.sourceChangeId, value.sourceWorkingRevision, value.traceId].join('\u0000');
    if (!byIdentity.has(key)) {
      byIdentity.set(key, {
        sourceChangeId: value.sourceChangeId,
        sourceWorkingRevision: value.sourceWorkingRevision,
        traceId: value.traceId,
        events: value.events.map((event) => ({
          ...event,
          source: { ...event.source },
          ...(event.stateDelta === undefined ? {} : { stateDelta: event.stateDelta.map((delta) => ({ ...delta })) }),
          ...(event.condition === undefined ? {} : { condition: { ...event.condition } }),
          ...(event.controlFlow === undefined ? {} : { controlFlow: { ...event.controlFlow } }),
          ...(event.choice === undefined ? {} : { choice: { ...event.choice } }),
        })),
        ...(value.status === undefined ? {} : { status: value.status }),
      });
    }
  }
  return [...byIdentity.values()].sort((left, right) =>
    left.sourceChangeId.localeCompare(right.sourceChangeId)
    || left.sourceWorkingRevision - right.sourceWorkingRevision
    || left.traceId.localeCompare(right.traceId));
}

function runtimePathOf(trace: ReviewRuntimeTraceInput): ReviewRuntimePathFact | undefined {
  if (trace.events.length === 0) return undefined;
  const visitedSceneIds: string[] = [];
  const visited = new Set<string>();
  const choices: ReviewRuntimePathFact['choices'] = [];
  const finalVariables = new Map<string, ReviewRuntimePathFact['finalVariables'][number]>();
  let endingSceneId: string | undefined;
  for (const event of trace.events) {
    const sceneId = event.source.sceneId;
    if (!visited.has(sceneId)) {
      visited.add(sceneId);
      visitedSceneIds.push(sceneId);
    }
    if (event.kind === 'choice' && event.choice !== undefined) {
      choices.push({
        sceneId,
        optionIndex: event.choice.optionIndex,
        ...(event.choice.label.length === 0 ? {} : { label: event.choice.label }),
      });
    }
    if (event.kind === 'scene-end') endingSceneId = sceneId;
    for (const delta of event.stateDelta ?? []) {
      finalVariables.set(delta.variable, {
        name: delta.variable,
        ...(delta.after === undefined ? {} : { value: delta.after as ReviewRuntimePathFact['finalVariables'][number]['value'] }),
      });
    }
  }
  return {
    traceId: trace.traceId,
    status: trace.status ?? 'passed',
    startSceneId: visitedSceneIds[0] ?? trace.events[0]!.source.sceneId,
    visitedSceneIds,
    choices,
    ...(endingSceneId === undefined ? {} : { endingSceneId }),
    finalVariables: [...finalVariables.values()].sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function candidateRuntimeFacts(
  candidate: BuildComparisonReviewProjectionInput['candidates'][number],
): ReviewCandidateVerifiedFacts['runtime'] {
  const manifest = candidate.manifest;
  const runtime = candidate.runtime;
  const runtimeInputs = runtimeInputsOf(candidate);
  const expectedChangeId = manifest?.sourceChangeId ?? candidate.ref.changeId;
  const expectedWorkingRevision = manifest?.sourceWorkingRevision;
  const identityMismatch = runtime !== undefined
    && (runtime.sourceChangeId !== expectedChangeId
      || (expectedWorkingRevision !== undefined && runtime.sourceWorkingRevision !== expectedWorkingRevision));
  const matching = identityMismatch
    ? []
    : runtimeInputs.filter((trace) => trace.sourceChangeId === expectedChangeId
      && (expectedWorkingRevision === undefined || trace.sourceWorkingRevision === expectedWorkingRevision));
  const paths = matching
    .map(runtimePathOf)
    .filter((path): path is ReviewRuntimePathFact => path !== undefined)
    .sort((left, right) => left.traceId.localeCompare(right.traceId));
  if (paths.length === 0) {
    const limitations = [
      ...(runtime?.limitations ?? []),
      ...(identityMismatch ? ['运行事实不可用：封存轨迹与候选 source change 或 workingRevision 不匹配。'] : []),
      ...(runtime?.status === 'available' && !identityMismatch && runtimeInputs.length === 0
        ? ['运行事实不可用：当前候选没有可核对的封存轨迹身份。'] : []),
      ...(runtime === undefined ? ['运行事实不可用：当前候选没有可核对的封存轨迹身份。'] : []),
    ];
    return {
      status: 'unavailable',
      ...(runtime?.sourceWorkingRevision !== undefined ? { workingRevision: runtime.sourceWorkingRevision } : {}),
      paths: [],
      limitations: sortedStrings(limitations),
    };
  }
  const limitations = sortedStrings([
    ...(runtime?.limitations ?? []),
    ...(matching.length === paths.length ? [] : ['部分运行轨迹为空，仅展示可读的操作摘录。']),
  ]);
  return {
    status: 'verified',
    workingRevision: matching[0]!.sourceWorkingRevision,
    paths,
    limitations,
  };
}

function candidateVerifiedFacts(
  candidate: BuildComparisonReviewProjectionInput['candidates'][number],
  units: readonly ObjectChangeUnit[],
  manifests: ReadonlyMap<string, CompositionManifest | undefined>,
): ReviewCandidateVerifiedFacts {
  const content = candidateContentFacts(units, manifests);
  const freshness = candidate.objectDiffFreshness;
  const currentDiff = freshness?.status === 'fresh'
    && candidate.sourceWorkingRevision !== undefined
    && freshness.workingRevision === candidate.sourceWorkingRevision
    && freshness.currentWorkingRevision === candidate.sourceWorkingRevision;
  if (!currentDiff) content.finalSceneLimitations.push('当前胶囊没有与最终工作版本一致的完整正文差异。');
  for (const file of currentDiff ? candidate.sealedFileDiffs ?? [] : []) {
    if (!file.path.endsWith('.gal')) continue;
    const [beforeHeader, afterHeader, ...lines] = file.unifiedDiff.split('\n');
    // Surdet's diff contains every line, without context hunks. Never infer missing content.
    if (beforeHeader !== `--- ${file.path}` || afterHeader !== `+++ ${file.path}`
      || lines.some((line) => !/^[ +\-]/.test(line))) {
      content.finalSceneLimitations.push(`场景文件 ${file.path} 的封存差异不包含可核对的完整正文。`);
      continue;
    }
    const sourceText = lines.filter((line) => line[0] !== '-').map((line) => line.slice(1)).join('\n');
    const document = parseSceneDocument(sourceText);
    const header = document.find((line) => line.kind === 'instr' && line.name === 'scene');
    const sceneId = header?.raw.trim().match(/^@scene\s+(\S+)\s*$/)?.[1];
    const producerUnitIds = sortedStrings(units.filter((unit) => unit.producedObjects.some((object) => object.objectRef === `scene:${sceneId}`)).map((unit) => unit.unitId));
    if (sceneId === undefined || producerUnitIds.length === 0) {
      content.finalSceneLimitations.push(`场景文件 ${file.path} 无法与候选的场景产物对应。`);
      continue;
    }
    const paragraphs = compileScene(sourceText, file.path, sceneId).instructions.flatMap((instruction): string[] => {
      if (instruction.op === 'text') return [instruction.speaker ? `${instruction.speaker}：${instruction.value}` : instruction.value];
      if (instruction.op === 'choice') return instruction.options.map((option) => `选项：${option.label}`);
      return [];
    });
    content.finalScenes.push({ producerUnitIds, sceneId, source: 'sealed-current-object-diff', paragraphs });
  }
  if (currentDiff) {
    const sceneRefs = sortedStrings(units.flatMap((unit) => unit.producedObjects)
      .filter((object) => object.objectRef.startsWith('scene:') && object.disposition !== 'remove').map((object) => object.objectRef));
    for (const objectRef of sceneRefs) {
      if (!content.finalScenes.some((scene) => objectRef === `scene:${scene.sceneId}`)) {
        content.finalSceneLimitations.push(`场景 ${objectRef.slice('scene:'.length)} 没有可核对的完整正文差异。`);
      }
    }
  }
  if (currentDiff && content.finalSceneLimitations.length === 0) content.finalSceneStatus = 'verified';
  else content.finalScenes = [];
  content.finalScenes.sort((left, right) => left.sceneId.localeCompare(right.sceneId));
  const runtime = candidateRuntimeFacts(candidate);
  return {
    source: {
      content: candidate.manifest === undefined ? 'manifest-unavailable' : 'sealed-composition-manifest',
      evidence: candidate.manifest === undefined ? 'evidence-unavailable' : 'sealed-capsule-evidence',
      runtime: runtime.status === 'verified' ? 'sealed-runtime-trace' : 'runtime-unavailable',
    },
    units: [...units]
      .sort((left, right) => left.primaryObject.localeCompare(right.primaryObject) || left.unitId.localeCompare(right.unitId))
      .map((unit) => projectUnitOutcome(unit, manifests, 'full')),
    content,
    runtime,
  };
}

function summarizeSafeGroupEvidence(sources: readonly ReviewUnitOutcome[]): ReviewSafeGroup['evidence'] {
  const evidence = sources.map((source) => source.evidence);
  return {
    warningCount: evidence.reduce((total, item) => total + item.warnings, 0),
    missing: evidence.some((item) => item.validation === 'missing'
      || item.simulation === 'missing'
      || item.runtime === 'missing'),
    stale: evidence.some((item) => item.validation === 'stale'
      || item.simulation === 'stale'
      || item.runtime === 'stale'),
    failed: evidence.some((item) => item.validation === 'failed'
      || item.simulation === 'failed'
      || item.runtime === 'failed'),
    incomplete: evidence.some((item) => item.simulation === 'incomplete'),
    manualReviewRequired: sortedStrings(evidence.flatMap((item) => item.manualReviewRequired)),
  };
}

function invalid(message: string): AuthoringOperationError {
  return new AuthoringOperationError('INVALID_REQUEST', message);
}

function resolutionOrder(value: ReviewConflict['allowedResolutions'][number]): number {
  return { 'choose-unit': 0, 'exclude-all': 1, 'regenerate-candidate': 2 }[value];
}

function canonicalCandidateInputs(
  comparison: CompositionComparison,
  inputs: BuildComparisonReviewProjectionInput['candidates'],
): BuildComparisonReviewProjectionInput['candidates'] {
  const byRef = new Map<string, BuildComparisonReviewProjectionInput['candidates'][number]>();
  for (const item of inputs) {
    const key = candidateRefKey(item.ref);
    if (byRef.has(key)) throw invalid('候选引用重复：' + item.candidateId);
    byRef.set(key, item);
  }
  const ordered: BuildComparisonReviewProjectionInput['candidates'] = [];
  for (const ref of [...comparison.candidates].sort(compareRefs)) {
    const item = byRef.get(candidateRefKey(ref));
    if (item === undefined) throw invalid('comparison 缺少候选的 intent/evidence：' + candidateRefKey(ref));
    ordered.push(item);
  }
  return ordered;
}

function candidateRank(candidates: readonly ReviewCandidate[]): Map<string, number> {
  return new Map(candidates.map((item, index) => [item.candidateId, index]));
}

function compareCandidateIds(ranks: Map<string, number>, left: string, right: string): number {
  return (ranks.get(left) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(right) ?? Number.MAX_SAFE_INTEGER)
    || left.localeCompare(right);
}

function projectObjects(
  objects: readonly AuthoringObject[],
  comparison: CompositionComparison,
): ReviewObjectSummary[] {
  const impacts = new Map<string, { potentialImpact: unknown[]; observedImpact: unknown[] }>();
  const units = [...comparison.units].sort((left, right) =>
    left.primaryObject.localeCompare(right.primaryObject)
    || left.candidateId.localeCompare(right.candidateId)
    || left.unitId.localeCompare(right.unitId));
  for (const unit of units) {
    const current = impacts.get(unit.primaryObject) ?? { potentialImpact: [], observedImpact: [] };
    current.potentialImpact.push(...unit.potentialImpact);
    current.observedImpact.push(...unit.observedImpact);
    impacts.set(unit.primaryObject, current);
  }
  const objectsByRef = new Map<string, AuthoringObject | undefined>(
    objects.map((object) => [object.objectRef, object]),
  );
  for (const unit of units) {
    for (const produced of unit.producedObjects) {
      if (!objectsByRef.has(produced.objectRef)) objectsByRef.set(produced.objectRef, undefined);
    }
  }
  return [...objectsByRef.keys()]
    .sort((left, right) => left.localeCompare(right))
    .map((objectRef) => {
      const object = objectsByRef.get(objectRef);
      const separator = objectRef.indexOf(':');
      const impact = impacts.get(objectRef) ?? { potentialImpact: [], observedImpact: [] };
      return {
        objectRef,
        kind: object?.kind ?? (separator > 0 ? objectRef.slice(0, separator) : 'unknown'),
        ...(object?.semanticId !== undefined
          ? { semanticId: object.semanticId }
          : separator > 0 && separator < objectRef.length - 1
            ? { semanticId: objectRef.slice(separator + 1) }
            : {}),
        ...(object?.source === undefined ? {} : {
          source: { path: object.source.path, line: object.source.line, col: object.source.col },
        }),
        references: sortedStrings(object?.references ?? []),
        referencedBy: sortedStrings(object?.referencedBy ?? []),
        potentialImpact: sortedFacts(impact.potentialImpact),
        observedImpact: sortedFacts(impact.observedImpact),
      };
    });
}

function projectSafeGroups(
  comparison: CompositionComparison,
  ranks: Map<string, number>,
  manifests: ReadonlyMap<string, CompositionManifest | undefined>,
): ReviewSafeGroup[] {
  const unitsById = new Map(comparison.units.map((unit) => [unit.unitId, unit]));
  return [...comparison.identicalGroups]
    .sort((left, right) => left.primaryObject.localeCompare(right.primaryObject) || left.groupId.localeCompare(right.groupId))
    .map((group) => {
      const unitIds = sortedStrings(group.unitIds);
      const groupUnits = unitIds
        .map((unitId) => unitsById.get(unitId))
        .filter((unit): unit is ObjectChangeUnit => unit !== undefined)
        .sort((left, right) => compareCandidateIds(ranks, left.candidateId, right.candidateId)
          || left.unitId.localeCompare(right.unitId));
      const sources = groupUnits.map((unit) => projectUnitOutcome(unit, manifests));
      const candidateIds = [...new Set(groupUnits.map((unit) => unit.candidateId))]
        .sort((left, right) => compareCandidateIds(ranks, left, right));
      const groupUnitIds = new Set(unitIds);
      const dependencyObjectRefs = sortedStrings([
        ...groupUnits.flatMap((unit) => unit.requiredBaseObjects.map((required) => required.objectRef)),
        ...groupUnits.flatMap((unit) => unit.requiredUnitIds
          .map((requiredUnitId) => unitsById.get(requiredUnitId)?.primaryObject)
          .filter((objectRef): objectRef is string => objectRef !== undefined)),
        ...comparison.dependencyEdges
          .filter((edge) => groupUnitIds.has(edge.fromUnitId))
          .map((edge) => edge.objectRef),
      ]);
      return {
        groupId: group.groupId,
        primaryObject: group.primaryObject,
        finalFingerprint: group.finalFingerprint,
        unitIds,
        candidateIds,
        sourceCount: candidateIds.length,
        includedByDefault: true,
        collapsedByDefault: true,
        sources,
        dependencyObjectRefs,
        potentialImpact: sortedFacts(groupUnits.flatMap((unit) => unit.potentialImpact)),
        observedImpact: sortedFacts(groupUnits.flatMap((unit) => unit.observedImpact)),
        evidence: summarizeSafeGroupEvidence(sources),
      };
    });
}

function projectConflicts(
  comparison: CompositionComparison,
  ranks: Map<string, number>,
  manifests: ReadonlyMap<string, CompositionManifest | undefined>,
): ReviewConflict[] {
  const unitsById = new Map(comparison.units.map((unit) => [unit.unitId, unit]));
  return [...comparison.conflicts]
    .sort((left, right) => left.conflictId.localeCompare(right.conflictId))
    .map((conflict) => {
      const unitIds = sortedStrings(conflict.unitIds);
      const options = unitIds
        .map((unitId) => unitsById.get(unitId))
        .filter((unit): unit is ObjectChangeUnit => unit !== undefined)
        .sort((left, right) => compareCandidateIds(ranks, left.candidateId, right.candidateId)
          || left.unitId.localeCompare(right.unitId))
        .map((unit) => projectUnitOutcome(unit, manifests));
      return {
        conflictId: conflict.conflictId,
        severity: conflict.severity,
        code: conflict.code,
        unitIds,
        candidateIds: sortedStrings(conflict.candidateIds)
          .sort((left, right) => compareCandidateIds(ranks, left, right)),
        objectRefs: sortedStrings(conflict.objectRefs),
        allowedResolutions: [...new Set(conflict.allowedResolutions)]
          .sort((left, right) => resolutionOrder(left) - resolutionOrder(right)),
        repairActions: [...conflict.repairActions],
        options,
      };
    });
}

function projectDependencies(comparison: CompositionComparison): ReviewDependency[] {
  const unitsById = new Map(comparison.units.map((unit) => [unit.unitId, unit]));
  return [...comparison.dependencyEdges]
    .sort((left, right) =>
      left.fromUnitId.localeCompare(right.fromUnitId)
      || left.toUnitId.localeCompare(right.toUnitId)
      || left.objectRef.localeCompare(right.objectRef))
    .map((edge) => {
      const fromUnit = unitsById.get(edge.fromUnitId);
      if (fromUnit === undefined) {
        throw invalid(`dependency edge 引用了不存在的 fromUnitId：${edge.fromUnitId}`);
      }
      return {
        fromUnitId: edge.fromUnitId,
        fromObjectRef: fromUnit.primaryObject,
        toUnitId: edge.toUnitId,
        objectRef: edge.objectRef,
        inclusion: 'implicit',
      };
    });
}

/**
 * 比较审查的唯一默认选择规则。相同结果组是已确认安全事实，优先保留其全部来源；
 * 其余只直接选择没有 blocking/selection 冲突且不是依赖目标的根单元。
 */
function comparisonDefaultSelectedUnitIds(comparison: CompositionComparison): string[] {
  const identicalUnitIds = new Set(comparison.identicalGroups.flatMap((group) => group.unitIds));
  const dependencyTargetUnitIds = new Set(comparison.dependencyEdges.map((edge) => edge.toUnitId));
  const unresolvedUnitIds = new Set(comparison.conflicts
    .filter((conflict) => conflict.severity === 'blocking' || conflict.severity === 'selection-required')
    .flatMap((conflict) => conflict.unitIds));
  return sortedStrings(comparison.units
    .filter((unit) => identicalUnitIds.has(unit.unitId)
      || (!dependencyTargetUnitIds.has(unit.unitId) && !unresolvedUnitIds.has(unit.unitId)))
    .map((unit) => unit.unitId));
}

function projectEvidence(
  comparison: CompositionComparison,
  ranks: Map<string, number>,
  conflicts: readonly ReviewConflict[],
): ReviewEvidenceSummary {
  const candidateMatrix = [...comparison.evidenceMatrix]
    .sort((left, right) => compareCandidateIds(ranks, left.candidateId, right.candidateId))
    .map((item) => ({ candidateId: item.candidateId, summary: normalizedEvidence(item.summary) }));
  const blockingCount = conflicts.filter((item) => item.severity === 'blocking').length;
  const selectionRequiredCount = conflicts.filter((item) => item.severity === 'selection-required').length;
  const advisoryCount = conflicts.filter((item) => item.severity === 'advisory').length;
  return {
    candidateMatrix,
    blockingCount,
    selectionRequiredCount,
    advisoryCount,
    canCreateDecision: comparison.status !== 'blocked' && blockingCount === 0,
  };
}

function reviewCreativeBriefOf(input: CreativeBriefInput | undefined): ReviewCreativeBrief {
  if (input === undefined) {
    return {
      status: 'not-provided',
      source: 'review-preparation-input',
      acceptanceCriteria: [],
    };
  }
  if (input.request.trim().length === 0 || input.acceptanceCriteria?.some((criterion) => criterion.trim().length === 0)) {
    throw invalid('已提供的创作要求和验收条目不能为空。');
  }
  return {
    status: 'provided',
    source: 'review-preparation-input',
    ...(input.title === undefined ? {} : { title: input.title }),
    request: input.request,
    acceptanceCriteria: [...(input.acceptanceCriteria ?? [])],
  };
}

async function withBriefFingerprint(
  brief: ReviewCreativeBrief,
  hasher: TextHasher,
): Promise<ReviewCreativeBrief> {
  if (brief.status !== 'provided') return brief;
  const { fingerprint: _fingerprint, ...content } = brief;
  void _fingerprint;
  return {
    ...brief,
    fingerprint: await hasher.sha256(stableStringify(content)),
  };
}

function presetForCandidate(
  comparison: CompositionComparison,
  candidate: BuildComparisonReviewProjectionInput['candidates'][number],
  allCandidates: readonly ReviewDecisionCandidate[],
): CandidateAdoptionPreset {
  const selectedUnitIds = sortedStrings(comparison.units
    .filter((unit) => unit.candidateId === candidate.candidateId)
    .map((unit) => unit.unitId));
  const base = {
    candidateRef: { ...candidate.ref },
    candidateId: candidate.candidateId,
    selectedUnitIds,
  };
  if (comparison.status === 'blocked') {
    return {
      ...base,
      status: 'blocked',
      conflictResolutions: [],
      reasons: [{ code: 'COMPARISON_BLOCKED', message: '当前 comparison 含阻断事实，整案采用被阻止。' }],
    };
  }
  const blocking = comparison.conflicts.filter((conflict) => conflict.severity === 'blocking');
  if (blocking.length > 0) {
    return {
      ...base,
      status: 'blocked',
      conflictResolutions: [],
      reasons: blocking.map((conflict) => ({ code: conflict.code, message: `存在阻断冲突：${conflict.conflictId}` })),
    };
  }
  try {
    const derived = deriveWholeCandidateSelection({
      comparison,
      candidates: allCandidates,
      candidate: { candidateId: candidate.candidateId, ref: candidate.ref },
    });
    return {
      ...base,
      status: 'available',
      conflictResolutions: derived.conflictResolutions,
      reasons: [],
    };
  } catch (error) {
    return {
      ...base,
      status: 'blocked',
      conflictResolutions: [],
      reasons: [{
        code: error instanceof AuthoringOperationError ? error.code : 'WHOLE_CANDIDATE_BLOCKED',
        message: error instanceof Error ? error.message : '整案采用无法由当前低层组合合同表达。',
      }],
    };
  }
}

function candidateClaimsOf(
  candidate: BuildComparisonReviewProjectionInput['candidates'][number],
): ReviewCandidateClaim {
  return {
    source: 'candidate-change-intent',
    ...(candidate.intent === undefined ? {} : { statement: candidate.intent }),
    acceptanceCriteria: [...candidate.acceptanceCriteria],
  };
}

function candidateUnits(
  comparison: CompositionComparison,
  candidateId: string,
): ObjectChangeUnit[] {
  return comparison.units
    .filter((unit) => unit.candidateId === candidateId)
    .sort((left, right) => left.primaryObject.localeCompare(right.primaryObject) || left.unitId.localeCompare(right.unitId));
}

function legacyReviewFingerprintPayload(projection: HumanReviewProjectionV1): Record<string, unknown> {
  // Keep this field selection byte-for-byte compatible with the Wave 8 v1 identity.
  return {
    reviewVersion: projection.reviewVersion,
    kind: projection.kind,
    projectIdentity: projection.projectIdentity,
    expectedProjectRevision: projection.expectedProjectRevision,
    sourceIdentity: projection.sourceIdentity,
    candidates: projection.candidates.map(({ candidateId, ref, evidence }) => ({ candidateId, ref, evidence })),
    safeGroups: projection.safeGroups,
    conflicts: projection.conflicts.map(({
      conflictId,
      severity,
      code,
      unitIds,
      candidateIds,
      objectRefs,
      allowedResolutions,
      options,
    }) => ({
      conflictId,
      severity,
      code,
      unitIds,
      candidateIds,
      objectRefs,
      allowedResolutions,
      options,
    })),
    dependencies: projection.dependencies,
    defaultSelectedUnitIds: projection.defaultSelectedUnitIds,
    evidence: projection.evidence,
    objects: projection.objects.map(({ source, ...object }) => {
      void source;
      return object;
    }),
  };
}

function reviewFingerprintPayload(projection: HumanReviewProjection): Record<string, unknown> {
  if (projection.reviewVersion === '1.0.0') return legacyReviewFingerprintPayload(projection);
  return {
    reviewVersion: projection.reviewVersion,
    kind: projection.kind,
    projectIdentity: projection.projectIdentity,
    expectedProjectRevision: projection.expectedProjectRevision,
    task: projection.task,
    creativeBrief: projection.creativeBrief,
    candidates: projection.candidates,
    safeGroups: projection.safeGroups,
    conflicts: projection.conflicts,
    dependencies: projection.dependencies,
    defaultSelectedUnitIds: projection.defaultSelectedUnitIds,
    evidence: projection.evidence,
    objects: projection.objects.map(({ source, ...object }) => {
      void source;
      return object;
    }),
    sourceIdentity: projection.sourceIdentity,
  };
}

/** comparison review 的唯一 identity 投影；旧 payload 缺少可选 presentation 时字段保持缺席。 */
export async function comparisonReviewFingerprintOf(
  projection: HumanReviewProjection,
  hasher: TextHasher,
): Promise<string> {
  if (projection.kind !== 'comparison') throw invalid('comparison review fingerprint 只能用于 comparison projection');
  return hasher.sha256(stableStringify(reviewFingerprintPayload(projection)));
}

export async function buildComparisonReviewProjection(
  input: BuildComparisonReviewProjectionInput,
  hasher: TextHasher,
): Promise<HumanReviewProjection> {
  const orderedInputs = canonicalCandidateInputs(input.comparison, input.candidates);
  const candidates: ReviewCandidate[] = orderedInputs.map((item, index) => ({
    candidateId: item.candidateId,
    ref: item.ref,
    displayOrdinal: String.fromCharCode('A'.charCodeAt(0) + index),
    ...(item.intent === undefined ? {} : { declaredIntent: item.intent }),
    acceptanceCriteria: [...item.acceptanceCriteria],
    evidence: normalizedEvidence(item.evidenceSummary),
  }));
  const ranks = candidateRank(candidates);
  const manifests = new Map(orderedInputs.map((item) => [item.candidateId, item.manifest]));
  const safeGroups = projectSafeGroups(input.comparison, ranks, manifests);
  const conflicts = projectConflicts(input.comparison, ranks, manifests);
  const dependencies = projectDependencies(input.comparison);
  const defaultSelectedUnitIds = comparisonDefaultSelectedUnitIds(input.comparison);
  const evidence = projectEvidence(input.comparison, ranks, conflicts);
  const objects = projectObjects(input.objects, input.comparison);
  const objectCount = new Set([
    ...objects.map((item) => item.objectRef),
    ...input.comparison.units.map((item) => item.primaryObject),
    ...input.comparison.dependencyEdges.map((item) => item.objectRef),
    ...input.comparison.conflicts.flatMap((item) => item.objectRefs),
  ]).size;
  const declared = orderedInputs.find((item) => item.intent !== undefined && item.intent.trim().length > 0);
  const legacyTask = declared === undefined
    ? {
        title: '候选创作方案审阅',
        acceptanceCriteria: [],
        candidateCount: candidates.length,
        objectCount,
        conflictCount: conflicts.length,
        statementSource: 'generated-fallback' as const,
      }
    : {
        title: declared.intent!,
        acceptanceCriteria: [...declared.acceptanceCriteria],
        candidateCount: candidates.length,
        objectCount,
        conflictCount: conflicts.length,
        statementSource: 'candidate-intent' as const,
      };
  const sourceIdentity = {
    projectIdentity: input.comparison.projectIdentity,
    expectedProjectRevision: input.comparison.expectedProjectRevision,
    comparisonFingerprint: input.comparison.comparisonFingerprint,
  };
  if (input.reviewVersion === '2.0.0') {
    const creativeBrief = await withBriefFingerprint(reviewCreativeBriefOf(input.creativeBrief), hasher);
    const decisionCandidates: ReviewDecisionCandidate[] = orderedInputs.map((item) => ({
      candidateId: item.candidateId,
      ref: item.ref,
    }));
    const v2Candidates: ReviewCandidateV2[] = orderedInputs.map((item, index) => {
      const candidate = candidates[index]!;
      return {
        ...candidate,
        claims: candidateClaimsOf(item),
        verifiedFacts: candidateVerifiedFacts(
          item,
          candidateUnits(input.comparison, item.candidateId),
          manifests,
        ),
        adoptionPreset: presetForCandidate(input.comparison, item, decisionCandidates),
      };
    });
    const task = creativeBrief.status === 'provided'
      ? {
          title: creativeBrief.title ?? '本次创作要求',
          goal: creativeBrief.request,
          acceptanceCriteria: [...creativeBrief.acceptanceCriteria],
          candidateCount: v2Candidates.length,
          objectCount,
          conflictCount: conflicts.length,
          statementSource: 'creative-brief' as const,
        }
      : {
          title: '本次创作要求',
          acceptanceCriteria: [],
          candidateCount: v2Candidates.length,
          objectCount,
          conflictCount: conflicts.length,
          statementSource: 'not-provided' as const,
        };
    const projection: HumanReviewProjectionV2 = {
      reviewVersion: '2.0.0',
      reviewId: input.reviewId,
      kind: 'comparison',
      state: 'COMPARISON_PREPARED',
      projectIdentity: input.comparison.projectIdentity,
      expectedProjectRevision: input.comparison.expectedProjectRevision,
      task,
      candidates: v2Candidates,
      creativeBrief,
      safeGroups,
      conflicts,
      dependencies,
      defaultSelectedUnitIds: [],
      evidence,
      objects,
      sourceIdentity,
      reviewFingerprint: '',
    };
    projection.reviewFingerprint = await comparisonReviewFingerprintOf(projection, hasher);
    return projection;
  }
  const projection: HumanReviewProjectionV1 = {
    reviewVersion: '1.0.0',
    reviewId: input.reviewId,
    kind: 'comparison',
    state: 'COMPARISON_PREPARED',
    projectIdentity: input.comparison.projectIdentity,
    expectedProjectRevision: input.comparison.expectedProjectRevision,
    task: legacyTask,
    candidates,
    safeGroups,
    conflicts,
    dependencies,
    defaultSelectedUnitIds,
    evidence,
    objects,
    sourceIdentity,
    reviewFingerprint: '',
  };
  projection.reviewFingerprint = await comparisonReviewFingerprintOf(projection, hasher);
  return projection;
}

export interface BuildResultReviewProjectionInput {
  reviewId: string;
  plan: IntegrationPlan;
  /** Sealed source object identities only; actual inclusion is derived from the executed plan. */
  sourceUnitObjects?: readonly (Pick<ReviewUnitOutcome, 'unitId' | 'primaryObject'> & { sourceCapsule: CandidateCapsuleRef })[];
  change: ChangeRecord;
  /** v2 result reviews carry the saved high-level decision explicitly. */
  reviewVersion?: '1.0.0' | '2.0.0';
  decisionIntent?: ReviewDecisionIntent;
  diffFingerprint: string;
  diff: ChangeDiff;
  freshness?: ReviewResultFreshness;
  runtimeTraceObservations: ReviewRuntimeTraceObservation[];
  /** Raw traces are supplied by the Node adapter after identity/evidence checks. */
  runtimeTraces?: readonly ReviewRuntimeTraceInput[];
  resultTreeSha256: string;
  changedObjects?: ReviewObjectSummary[];
  warnings?: ReviewWarning[];
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Formal trace 与浏览器观察共用的可比较事件身份，不使用一次性 traceId。 */
export function reviewTraceObservationKey(value: unknown): string | undefined {
  const event = recordOf(value);
  const source = recordOf(event?.['source']);
  const kind = event?.['kind'];
  const sceneId = source?.['sceneId'];
  const index = source?.['index'];
  const op = source?.['op'];
  const file = source?.['file'];
  const line = source?.['line'];
  const col = source?.['col'];
  if (typeof kind !== 'string' || kind.length === 0
    || typeof sceneId !== 'string' || sceneId.length === 0
    || typeof index !== 'number' || !Number.isInteger(index)
    || typeof op !== 'string' || op.length === 0
    || typeof file !== 'string' || file.length === 0
    || typeof line !== 'number' || !Number.isInteger(line)
    || typeof col !== 'number' || !Number.isInteger(col)) return undefined;
  return [kind, sceneId, index, op, file.replace(/\\/g, '/'), line, col].join('|');
}

function resultNotReady(message: string): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_RESULT_NOT_READY', message);
}

function resultRuntimeInputsOf(input: BuildResultReviewProjectionInput): ReviewRuntimeTraceInput[] {
  const values = [...(input.runtimeTraces ?? [])];
  const summaries = new Map((input.change.runtimeTraces ?? []).map((trace) => [trace.traceId, trace]));
  const byIdentity = new Map<string, ReviewRuntimeTraceInput>();
  for (const value of values) {
    const summary = summaries.get(value.traceId);
    if (!summary || summary.status !== 'passed' || summary.workingRevision !== input.change.workingRevision
      || value.sourceChangeId !== input.change.changeId
      || value.sourceWorkingRevision !== input.change.workingRevision
      || value.status === 'failed'
      || !Array.isArray(value.events)) continue;
    if (byIdentity.has(value.traceId)) continue;
    byIdentity.set(value.traceId, {
      sourceChangeId: value.sourceChangeId,
      sourceWorkingRevision: value.sourceWorkingRevision,
      traceId: value.traceId,
      events: value.events.map((event) => ({
        ...event,
        source: { ...event.source },
        ...(event.stateDelta === undefined ? {} : { stateDelta: event.stateDelta.map((delta) => ({ ...delta })) }),
        ...(event.condition === undefined ? {} : { condition: { ...event.condition } }),
        ...(event.controlFlow === undefined ? {} : { controlFlow: { ...event.controlFlow } }),
        ...(event.choice === undefined ? {} : { choice: { ...event.choice } }),
      })),
      status: 'passed',
    });
  }
  return [...byIdentity.values()].sort((left, right) => left.traceId.localeCompare(right.traceId));
}

function resultRuntimePathsOf(input: BuildResultReviewProjectionInput): ReviewRuntimePathFact[] {
  const expectedIds = new Set((input.change.runtimeTraces ?? [])
    .filter((trace) => trace.status === 'passed' && trace.workingRevision === input.change.workingRevision)
    .map((trace) => trace.traceId));
  const raw = resultRuntimeInputsOf(input)
    .map(runtimePathOf)
    .filter((path): path is ReviewRuntimePathFact => path !== undefined && expectedIds.has(path.traceId));
  const byTraceId = new Map<string, ReviewRuntimePathFact>();
  for (const path of raw) {
    if (!byTraceId.has(path.traceId)) byTraceId.set(path.traceId, path);
  }
  return [...byTraceId.values()].sort((left, right) => left.traceId.localeCompare(right.traceId));
}

function resultUnitDescriptions(plan: IntegrationPlan, sourceUnits: BuildResultReviewProjectionInput['sourceUnitObjects'] = []): Map<string, { objectRef?: string; sourceCapsule?: CandidateCapsuleRef }> {
  const byUnit = new Map<string, { objectRef?: string; sourceCapsule?: CandidateCapsuleRef }>();
  for (const unit of sourceUnits) byUnit.set(unit.unitId, { objectRef: unit.primaryObject, sourceCapsule: unit.sourceCapsule });
  for (const operation of plan.replayOperations) {
    const current = byUnit.get(operation.sourceUnitId) ?? {};
    byUnit.set(operation.sourceUnitId, {
      objectRef: current.objectRef ?? operation.primaryObject,
      sourceCapsule: current.sourceCapsule ?? operation.sourceCapsule,
    });
  }
  for (const entry of plan.provenance) {
    const current = byUnit.get(entry.sourceUnitId) ?? {};
    byUnit.set(entry.sourceUnitId, {
      objectRef: current.objectRef ?? entry.targetObject,
      sourceCapsule: current.sourceCapsule ?? entry.sourceCapsule,
    });
  }
  return byUnit;
}

function sourceOrdinal(plan: IntegrationPlan, ref: CandidateCapsuleRef): string | undefined {
  const index = [...plan.sourceCapsules].sort(compareRefs)
    .findIndex((candidate) => candidateRefKey(candidate) === candidateRefKey(ref));
  return index < 0 ? undefined : String.fromCharCode('A'.charCodeAt(0) + index);
}

function resultUnitFact(
  kind: string,
  unitId: string,
  descriptions: ReadonlyMap<string, { objectRef?: string; sourceCapsule?: CandidateCapsuleRef }>,
  plan: IntegrationPlan,
): ReviewHumanFact {
  const description = descriptions.get(unitId);
  const objectRef = description?.objectRef;
  const ordinal = description?.sourceCapsule === undefined ? undefined : sourceOrdinal(plan, description.sourceCapsule);
  return {
    kind,
    label: objectRef === undefined ? unitId : `${ordinal === undefined ? '' : `方案 ${ordinal} 中的`}${objectRef}（${kind === 'automatic-dependency' ? '自动带入' : kind === 'excluded-unit' ? '未纳入' : '纳入'}）`,
    ...(objectRef === undefined ? {} : { objectRef }),
    unitId,
  };
}

function actualSourceFacts(plan: IntegrationPlan): ReviewHumanFact[] {
  const byRef = new Map<string, ReviewHumanFact>();
  const sourceRefs = [
    ...plan.replayOperations.map((operation) => operation.sourceCapsule),
    ...plan.provenance.map((entry) => entry.sourceCapsule),
  ];
  for (const sourceCapsule of sourceRefs) {
    const key = candidateRefKey(sourceCapsule);
    if (byRef.has(key)) continue;
    const ordinal = sourceOrdinal(plan, sourceCapsule);
    byRef.set(key, {
      kind: 'selected-source',
      label: ordinal === undefined ? `实际执行来源 ${sourceCapsule.changeId}` : `方案 ${ordinal} 的实际执行来源`,
      value: { ...sourceCapsule },
    });
  }
  return [...byRef.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function actualChangeFacts(
  changedObjects: readonly ReviewObjectSummary[],
  diff: ChangeDiff,
): ReviewHumanFact[] {
  const byRef = new Map<string, ReviewHumanFact>();
  for (const object of changedObjects) {
    byRef.set(object.objectRef, {
      kind: 'changed-object',
      label: `项目变化：${object.objectRef}`,
      objectRef: object.objectRef,
      value: {
        kind: object.kind,
        ...(object.semanticId === undefined ? {} : { semanticId: object.semanticId }),
      },
    });
  }
  for (const entry of diff.semantic) {
    const objectRef = entry.objectAfter ?? entry.objectBefore;
    if (objectRef === undefined || byRef.has(objectRef)) continue;
    byRef.set(objectRef, { kind: 'changed-object', label: `项目变化：${objectRef}`, objectRef });
  }
  return [...byRef.values()].sort((left, right) => (left.objectRef ?? '').localeCompare(right.objectRef ?? ''));
}

function actualExcludedFacts(plan: IntegrationPlan, descriptions: ReadonlyMap<string, { objectRef?: string; sourceCapsule?: CandidateCapsuleRef }>): ReviewHumanFact[] {
  const included = new Set(plan.replayOperations.map((operation) => operation.sourceUnitId));
  const requested = new Set([...plan.selectedUnitIds, ...plan.implicitInclusions]);
  for (const group of plan.deduplicatedUnits) {
    if (!included.has(group.retainedUnitId)) continue;
    for (const unitId of group.provenanceUnitIds) if (requested.has(unitId)) included.add(unitId);
  }
  const facts: ReviewHumanFact[] = sortedStrings([
    ...plan.excludedUnitIds,
    ...[...descriptions.keys()].filter((unitId) => !included.has(unitId)),
  ])
    .map((unitId) => resultUnitFact('excluded-unit', unitId, descriptions, plan));
  const actualSourceKeys = new Set([
    ...plan.replayOperations.map((operation) => candidateRefKey(operation.sourceCapsule)),
    ...plan.provenance.map((entry) => candidateRefKey(entry.sourceCapsule)),
  ]);
  for (const sourceCapsule of [...plan.sourceCapsules].sort(compareRefs)) {
    if (actualSourceKeys.has(candidateRefKey(sourceCapsule))) continue;
    const ordinal = sourceOrdinal(plan, sourceCapsule);
    facts.push({
      kind: 'excluded-candidate',
      label: ordinal === undefined ? `候选 ${sourceCapsule.changeId} 未纳入` : `方案 ${ordinal} 未纳入`,
      value: { ...sourceCapsule },
    });
  }
  return facts.sort((left, right) => left.label.localeCompare(right.label));
}

function actualExplanationFingerprintPayload(explanation: ReviewActualResultExplanation): Record<string, unknown> {
  const { explanationFingerprint: _fingerprint, ...payload } = explanation;
  void _fingerprint;
  return payload;
}

function resultReviewFingerprintPayload(projection: HumanReviewProjection): Record<string, unknown> {
  return {
    reviewVersion: projection.reviewVersion,
    kind: projection.kind,
    projectIdentity: projection.projectIdentity,
    expectedProjectRevision: projection.expectedProjectRevision,
    task: projection.task,
    objects: projection.objects,
    defaultSelectedUnitIds: projection.defaultSelectedUnitIds,
    evidence: projection.finalResult?.evidence,
    finalResult: projection.finalResult,
    sourceIdentity: projection.sourceIdentity,
  };
}

/** Result review 的可复算 identity；读取方可用它拒绝被篡改的实际结果说明。 */
export async function resultReviewFingerprintOf(
  projection: HumanReviewProjection,
  hasher: TextHasher,
): Promise<string> {
  if (projection.kind !== 'integration-result') throw invalid('result review fingerprint 只能用于 integration-result projection');
  return hasher.sha256(stableStringify(resultReviewFingerprintPayload(projection)));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function candidateRefShape(value: unknown): boolean {
  const ref = jsonRecord(value);
  return ref !== undefined
    && nonEmptyString(ref['changeId'])
    && nonEmptyString(ref['capsuleId'])
    && nonEmptyString(ref['artifactSha256']);
}

function runtimePathShape(value: unknown): boolean {
  const path = jsonRecord(value);
  if (path === undefined
    || !nonEmptyString(path['traceId'])
    || (path['status'] !== 'passed' && path['status'] !== 'failed')
    || !nonEmptyString(path['startSceneId'])
    || !stringArray(path['visitedSceneIds'])
    || !Array.isArray(path['choices'])
    || !path['choices'].every((choice) => {
      const item = jsonRecord(choice);
      return item !== undefined && nonEmptyString(item['sceneId'])
        && typeof item['optionIndex'] === 'number' && Number.isInteger(item['optionIndex'])
        && (item['label'] === undefined || typeof item['label'] === 'string');
    })
    || (path['endingSceneId'] !== undefined && !nonEmptyString(path['endingSceneId']))
    || !Array.isArray(path['finalVariables'])) return false;
  return path['finalVariables'].every((variable) => {
    const item = jsonRecord(variable);
    return item !== undefined && nonEmptyString(item['name']);
  });
}

function humanFactShape(value: unknown): boolean {
  const fact = jsonRecord(value);
  return fact !== undefined && nonEmptyString(fact['kind']) && nonEmptyString(fact['label'])
    && (fact['objectRef'] === undefined || nonEmptyString(fact['objectRef']))
    && (fact['unitId'] === undefined || nonEmptyString(fact['unitId']))
    && (fact['candidateId'] === undefined || nonEmptyString(fact['candidateId']));
}

function reviewUnitShape(value: unknown): boolean {
  const unit = jsonRecord(value);
  return unit !== undefined
    && nonEmptyString(unit['unitId'])
    && nonEmptyString(unit['candidateId'])
    && nonEmptyString(unit['primaryObject'])
    && Array.isArray(unit['outcomes'])
    && Array.isArray(unit['potentialImpact'])
    && Array.isArray(unit['observedImpact'])
    && jsonRecord(unit['evidence']) !== undefined;
}

function candidateVerifiedFactsShape(value: unknown): boolean {
  const facts = jsonRecord(value);
  const source = jsonRecord(facts?.['source']);
  const content = jsonRecord(facts?.['content']);
  const runtime = jsonRecord(facts?.['runtime']);
  return facts !== undefined
    && source !== undefined
    && (source['content'] === 'sealed-composition-manifest' || source['content'] === 'manifest-unavailable')
    && (source['evidence'] === 'sealed-capsule-evidence' || source['evidence'] === 'evidence-unavailable')
    && (source['runtime'] === 'sealed-runtime-trace' || source['runtime'] === 'runtime-unavailable')
    && Array.isArray(facts['units']) && facts['units'].every(reviewUnitShape)
    && content !== undefined
    && Array.isArray(content['changedObjects'])
    && content['changedObjects'].every((value) => { const item = jsonRecord(value); return item !== undefined && nonEmptyString(item['objectRef']) && nonEmptyString(item['unitId']); })
    && Array.isArray(content['scenes'])
    && content['scenes'].every((value) => { const item = jsonRecord(value); return item !== undefined && nonEmptyString(item['sceneId']) && nonEmptyString(item['unitId']) && nonEmptyString(item['action']) && Number.isInteger(item['operationSequence']) && stringArray(item['highlights']); })
    && Array.isArray(content['choices'])
    && Array.isArray(content['variables'])
    && Array.isArray(content['timelines'])
    && content['timelines'].every((value) => { const item = jsonRecord(value); return item !== undefined && nonEmptyString(item['timelineId']) && stringArray(item['trackKinds']); })
    && Array.isArray(content['assets'])
    && stringArray(content['excerpts'])
    && typeof content['omittedFactCount'] === 'number'
    && Number.isInteger(content['omittedFactCount'])
    && (content['finalSceneStatus'] === 'verified' || content['finalSceneStatus'] === 'unavailable')
    && stringArray(content['finalSceneLimitations'])
    && Array.isArray(content['finalScenes'])
    && (content['finalSceneStatus'] !== 'unavailable' || (content['finalScenes'].length === 0 && content['finalSceneLimitations'].length > 0))
    && content['finalScenes'].every((value) => {
      const item = jsonRecord(value);
      return item !== undefined && nonEmptyString(item['sceneId']) && stringArray(item['producerUnitIds'])
        && item['producerUnitIds'].length > 0 && item['producerUnitIds'].every(nonEmptyString)
        && stableStringify(item['producerUnitIds']) === stableStringify(sortedStrings(item['producerUnitIds']))
        && item['producerUnitIds'].every((unitId) => (facts['units'] as unknown[]).some((unit) => jsonRecord(unit)?.['unitId'] === unitId))
        && item['source'] === 'sealed-current-object-diff' && stringArray(item['paragraphs']);
    })
    && runtime !== undefined
    && (runtime['status'] === 'verified' || runtime['status'] === 'unavailable')
    && (runtime['workingRevision'] === undefined
      || (typeof runtime['workingRevision'] === 'number' && Number.isInteger(runtime['workingRevision'])))
    && Array.isArray(runtime['paths']) && runtime['paths'].every(runtimePathShape)
    && stringArray(runtime['limitations']);
}

function candidateClaimShape(value: unknown): boolean {
  const claim = jsonRecord(value);
  return claim !== undefined
    && claim['source'] === 'candidate-change-intent'
    && (claim['statement'] === undefined || typeof claim['statement'] === 'string')
    && stringArray(claim['acceptanceCriteria']);
}

function adoptionPresetShape(value: unknown): boolean {
  const preset = jsonRecord(value);
  return preset !== undefined
    && candidateRefShape(preset['candidateRef'])
    && nonEmptyString(preset['candidateId'])
    && (preset['status'] === 'available' || preset['status'] === 'blocked')
    && stringArray(preset['selectedUnitIds'])
    && Array.isArray(preset['conflictResolutions'])
    && preset['conflictResolutions'].every((resolution) => {
      const item = jsonRecord(resolution);
      return item !== undefined && nonEmptyString(item['conflictId'])
        && (item['resolution'] === 'choose-unit' || item['resolution'] === 'exclude-all'
          || item['resolution'] === 'regenerate-candidate')
        && (item['actor'] === 'human' || item['actor'] === 'review-agent');
    })
    && Array.isArray(preset['reasons'])
    && preset['reasons'].every((reason) => {
      const item = jsonRecord(reason);
      return item !== undefined && nonEmptyString(item['code']) && nonEmptyString(item['message']);
    });
}

function candidateV2Shape(value: unknown): boolean {
  const candidate = jsonRecord(value);
  return candidate !== undefined
    && nonEmptyString(candidate['candidateId'])
    && candidateRefShape(candidate['ref'])
    && nonEmptyString(candidate['displayOrdinal'])
    && candidateClaimShape(candidate['claims'])
    && candidateVerifiedFactsShape(candidate['verifiedFacts'])
    && adoptionPresetShape(candidate['adoptionPreset'])
    && jsonRecord(candidate['evidence']) !== undefined;
}

function actualExplanationShape(value: unknown, finalResult: Record<string, unknown>, sourceIdentity: Record<string, unknown>): boolean {
  const explanation = jsonRecord(value);
  const evidence = jsonRecord(finalResult['evidence']);
  const sourceDecisionFingerprint = sourceIdentity['decisionFingerprint'];
  return explanation !== undefined
    && explanation['source'] === 'integration-result'
    && isReviewDecisionIntent(explanation['decisionIntent'])
    && nonEmptyString(explanation['decisionFingerprint'])
    && explanation['decisionFingerprint'] === sourceDecisionFingerprint
    && nonEmptyString(explanation['planId'])
    && explanation['planId'] === finalResult['planId']
    && nonEmptyString(explanation['planFingerprint'])
    && explanation['planFingerprint'] === finalResult['planFingerprint']
    && nonEmptyString(explanation['integrationChangeId'])
    && explanation['integrationChangeId'] === finalResult['integrationChangeId']
    && typeof explanation['workingRevision'] === 'number'
    && Number.isInteger(explanation['workingRevision'])
    && explanation['workingRevision'] === finalResult['workingRevision']
    && stringArray(explanation['runtimeTraceIds'])
    && evidence !== undefined
    && stringArray(evidence['runtimeTraceIds'])
    && stableStringify(explanation['runtimeTraceIds']) === stableStringify(evidence['runtimeTraceIds'])
    && Array.isArray(explanation['selectedSources']) && explanation['selectedSources'].every(humanFactShape)
    && Array.isArray(explanation['actualIncluded']) && explanation['actualIncluded'].every(humanFactShape)
    && Array.isArray(explanation['actualDependencies']) && explanation['actualDependencies'].every(humanFactShape)
    && Array.isArray(explanation['actualExcluded']) && explanation['actualExcluded'].every(humanFactShape)
    && Array.isArray(explanation['actualChanges']) && explanation['actualChanges'].every(humanFactShape)
    && Array.isArray(explanation['actualRuntimeOutcomes']) && explanation['actualRuntimeOutcomes'].every(runtimePathShape)
    && stringArray(explanation['warnings'])
    && nonEmptyString(explanation['explanationFingerprint']);
}

/**
 * Validates only the fields introduced by Review Projection v2. The legacy
 * projection parser remains responsible for the shared v1 fields.
 */
export function isReviewProjectionV2Fields(value: unknown): value is HumanReviewProjectionV2 {
  const projection = jsonRecord(value);
  if (projection === undefined || projection['reviewVersion'] !== '2.0.0') return false;
  const brief = jsonRecord(projection['creativeBrief']);
  const sourceIdentity = jsonRecord(projection['sourceIdentity']);
  const finalResult = projection['finalResult'];
  const finalResultRecord = finalResult === undefined ? undefined : jsonRecord(finalResult);
  return brief !== undefined
    && (brief['status'] === 'provided' || brief['status'] === 'not-provided')
    && brief['source'] === 'review-preparation-input'
    && stringArray(brief['acceptanceCriteria'])
    && (brief['status'] === 'provided'
      ? nonEmptyString(brief['request'])
      : brief['request'] === undefined)
    && (brief['title'] === undefined || typeof brief['title'] === 'string')
    && (brief['fingerprint'] === undefined || nonEmptyString(brief['fingerprint']))
    && Array.isArray(projection['candidates']) && projection['candidates'].every(candidateV2Shape)
    && Array.isArray(projection['defaultSelectedUnitIds'])
    && projection['defaultSelectedUnitIds'].length === 0
    && sourceIdentity !== undefined
    && (projection['kind'] !== 'integration-result'
      ? !finalResultRecord || actualExplanationShape(finalResultRecord['actualExplanation'], finalResultRecord, sourceIdentity)
      : finalResultRecord !== undefined && actualExplanationShape(finalResultRecord['actualExplanation'], finalResultRecord, sourceIdentity));
}

function resultEvidenceOf(change: ChangeRecord): {
  evidence: ReviewFinalResult['evidence'];
  freshness: ReviewResultFreshness;
  runtimeWorkingRevision: number;
} {
  const workingRevision = change.workingRevision;
  const diff = evidenceFreshness(change.latestDiff, workingRevision);
  const validation = evidenceFreshness(change.latestValidation, workingRevision);
  const simulation = evidenceFreshness(change.latestSimulation, workingRevision);
  const runtime = change.runtimeTraces ?? [];
  if (diff.status !== 'fresh' || validation.status !== 'fresh' || simulation.status !== 'fresh') {
    throw resultNotReady('diff、validation 或 simulation evidence 不是当前 workingRevision 的 fresh/passed 事实');
  }
  if (change.latestValidation?.errors !== 0) {
    throw resultNotReady('validation evidence 仍有 error');
  }
  if (change.latestSimulation?.status !== 'passed') {
    throw resultNotReady('simulation evidence 未通过');
  }
  if (runtime.length === 0 || runtime.some((trace) =>
    trace.status !== 'passed' || trace.workingRevision !== workingRevision)) {
    throw resultNotReady('runtime trace 缺失、失败或不是当前 workingRevision 的 fresh 事实');
  }
  const runtimeTraceIds = runtime.map((trace) => trace.traceId).sort((left, right) => left.localeCompare(right));
  if (runtimeTraceIds.some((traceId) => traceId.length === 0)
    || new Set(runtimeTraceIds).size !== runtimeTraceIds.length) {
    throw resultNotReady('runtime trace identity 缺失或重复');
  }
  const diffEvidenceId = change.latestDiff?.evidenceId;
  const validationEvidenceId = change.latestValidation?.evidenceId;
  const simulationEvidenceId = change.latestSimulation?.evidenceId;
  if (diffEvidenceId === undefined || validationEvidenceId === undefined || simulationEvidenceId === undefined
    || diffEvidenceId.length === 0 || validationEvidenceId.length === 0 || simulationEvidenceId.length === 0) {
    throw resultNotReady('result evidence 缺少稳定 evidenceId');
  }
  return {
    evidence: {
      diffEvidenceId,
      validationEvidenceId,
      simulationEvidenceId,
      runtimeTraceIds,
    },
    freshness: { diff: 'fresh', validation: 'fresh', simulation: 'fresh', runtime: 'fresh' },
    runtimeWorkingRevision: workingRevision,
  };
}

function normalizedRuntimeTraceObservations(
  observations: readonly ReviewRuntimeTraceObservation[],
  expectedTraceIds: readonly string[],
): ReviewRuntimeTraceObservation[] {
  if (!Array.isArray(observations)) throw resultNotReady('runtime trace observations 缺失');
  const byTraceId = new Map<string, ReviewRuntimeTraceObservation>();
  for (const observation of observations) {
    if (typeof observation?.traceId !== 'string' || observation.traceId.length === 0
      || !Array.isArray(observation.observationKeys)
      || observation.observationKeys.some((key: unknown) => typeof key !== 'string' || key.length === 0)
      || byTraceId.has(observation.traceId)) {
      throw resultNotReady('runtime trace observations identity 无效或重复');
    }
    byTraceId.set(observation.traceId, {
      traceId: observation.traceId,
      observationKeys: sortedStrings(observation.observationKeys),
    });
  }
  const actualTraceIds = [...byTraceId.keys()].sort((left, right) => left.localeCompare(right));
  if (stableStringify(actualTraceIds) !== stableStringify(expectedTraceIds)) {
    throw resultNotReady('runtime trace observations 与 fresh runtime evidence 不匹配');
  }
  return actualTraceIds.map((traceId) => byTraceId.get(traceId)!);
}

export async function buildResultReviewProjection(
  input: BuildResultReviewProjectionInput,
  hasher: TextHasher,
): Promise<HumanReviewProjection> {
  const { plan, change } = input;
  const review = plan.review;
  if (review?.reviewState !== 'human-reviewed') {
    throw resultNotReady('只有 human-reviewed integration plan 才能生成结果审阅包');
  }
  const integration = change.integration;
  if (integration === undefined
    || integration.planId !== plan.planId
    || integration.planFingerprint !== plan.planFingerprint) {
    throw resultNotReady('integration change 与 reviewed plan identity 不匹配');
  }
  if (integration.status !== 'READY') {
    throw resultNotReady('integration change 尚未 READY');
  }
  // projectIdentity 是上层对真实 root identity 的稳定投影；authoring core 不知道
  // Node 的映射规则，CLI 在进入本函数前负责核对两者。这里仅校验 core 能看见的
  // change base revision，避免把两个不同层次的 identity 误作同一字符串。
  if (change.baseRevision !== plan.expectedProjectRevision) {
    throw resultNotReady('integration change 的基线 revision 已变化');
  }
  if (integration.review?.binding === undefined
    || stableStringify(integration.review.binding) !== stableStringify(review)) {
    throw resultNotReady('integration change 缺少匹配的 human review binding');
  }
  if (input.diffFingerprint.length === 0 || input.diff === undefined || input.resultTreeSha256.length === 0) {
    throw resultNotReady('result diff 或 preview tree 缺少稳定 identity');
  }

  const resultEvidence = resultEvidenceOf(change);
  if (input.freshness !== undefined
    && stableStringify(input.freshness) !== stableStringify(resultEvidence.freshness)) {
    throw resultNotReady('caller freshness 与 Authoring fresh evidence 不匹配');
  }
  const runtimeTraceObservations = normalizedRuntimeTraceObservations(
    input.runtimeTraceObservations,
    resultEvidence.evidence.runtimeTraceIds,
  );
  const orderedSourceCapsules = [...plan.sourceCapsules].sort(compareRefs);
  if (new Set(orderedSourceCapsules.map(candidateRefKey)).size !== orderedSourceCapsules.length) {
    throw resultNotReady('reviewed plan 含重复 source capsule identity');
  }
  const changedObjects = [...(input.changedObjects ?? [])]
    .sort((left, right) => left.objectRef.localeCompare(right.objectRef));
  const warnings = [...(input.warnings ?? [])];
  const finalResult: ReviewFinalResult = {
    planId: plan.planId,
    planFingerprint: plan.planFingerprint,
    integrationChangeId: change.changeId,
    workingRevision: resultEvidence.runtimeWorkingRevision,
    diffFingerprint: input.diffFingerprint,
    changedObjects,
    evidence: resultEvidence.evidence,
    plan: {
      review,
      sourceCapsules: [...plan.sourceCapsules],
      sourceCandidates: orderedSourceCapsules.map((ref, index) => ({
        ref: { ...ref },
        displayOrdinal: String.fromCharCode('A'.charCodeAt(0) + index),
      })),
      selectedUnitIds: [...plan.selectedUnitIds],
      includedUnitIds: [...integration.includedUnitIds],
      implicitInclusions: [...plan.implicitInclusions],
      excludedUnitIds: [...plan.excludedUnitIds],
      conflictResolutions: [...plan.conflictResolutions],
      deduplicatedUnits: [...plan.deduplicatedUnits],
      replayOperations: [...plan.replayOperations],
      provenance: [...plan.provenance],
      finalObjectFingerprints: { ...plan.dryRun.finalObjectFingerprints },
    },
    diff: input.diff,
    freshness: resultEvidence.freshness,
    runtimeTraceObservations,
    resultTreeSha256: input.resultTreeSha256,
    warnings,
  };
  if (input.reviewVersion === '2.0.0') {
    if (input.decisionIntent === undefined) {
      throw resultNotReady('v2 result review 缺少已保存的 decisionIntent');
    }
    const runtimePaths = resultRuntimePathsOf(input);
    const runtimePathIds = new Set(runtimePaths.map((path) => path.traceId));
    const runtimePathWarnings = resultEvidence.evidence.runtimeTraceIds
      .filter((traceId) => !runtimePathIds.has(traceId))
      .map((traceId) => `运行结果轨迹 ${traceId} 未提供可读路径，仅保留 fresh runtime evidence identity。`);
    const descriptions = resultUnitDescriptions(plan, input.sourceUnitObjects);
    const explanation: ReviewActualResultExplanation = {
      source: 'integration-result',
      decisionIntent: input.decisionIntent,
      decisionFingerprint: review.decisionFingerprint,
      planId: finalResult.planId,
      planFingerprint: finalResult.planFingerprint,
      integrationChangeId: finalResult.integrationChangeId,
      workingRevision: finalResult.workingRevision,
      runtimeTraceIds: [...finalResult.evidence.runtimeTraceIds],
      selectedSources: actualSourceFacts(plan),
      actualIncluded: sortedStrings(integration.includedUnitIds)
        .map((unitId) => resultUnitFact('included-unit', unitId, descriptions, plan)),
      actualDependencies: sortedStrings(plan.implicitInclusions)
        .map((unitId) => resultUnitFact('automatic-dependency', unitId, descriptions, plan)),
      actualExcluded: actualExcludedFacts(plan, descriptions),
      actualChanges: actualChangeFacts(changedObjects, input.diff),
      actualRuntimeOutcomes: runtimePaths,
      warnings: sortedStrings([
        ...warnings.map((warning) => warning.message),
        ...input.diff.summary.warnings,
        ...runtimePathWarnings,
      ]),
      explanationFingerprint: '',
    };
    explanation.explanationFingerprint = await hasher.sha256(
      stableStringify(actualExplanationFingerprintPayload(explanation)),
    );
    finalResult.actualExplanation = explanation;
  }
  const resultSourceIdentity = {
    projectIdentity: plan.projectIdentity,
    expectedProjectRevision: plan.expectedProjectRevision,
    comparisonFingerprint: plan.comparisonFingerprint,
    planFingerprint: plan.planFingerprint,
    integrationChangeId: change.changeId,
    workingRevision: change.workingRevision,
    decisionReviewId: review.reviewId,
    decisionId: review.decisionId,
    decisionFingerprint: review.decisionFingerprint,
  };
  if (input.reviewVersion === '2.0.0') {
    const projection: HumanReviewProjectionV2 = {
      reviewVersion: '2.0.0',
      reviewId: input.reviewId,
      kind: 'integration-result',
      state: 'STAGE_READY',
      projectIdentity: plan.projectIdentity,
      expectedProjectRevision: plan.expectedProjectRevision,
      task: {
        title: '正式创作结果',
        acceptanceCriteria: [],
        candidateCount: 0,
        objectCount: changedObjects.length,
        conflictCount: 0,
        statementSource: 'not-provided',
      },
      candidates: [],
      creativeBrief: {
        status: 'not-provided',
        source: 'review-preparation-input',
        acceptanceCriteria: [],
      },
      safeGroups: [],
      conflicts: [],
      dependencies: [],
      defaultSelectedUnitIds: [],
      evidence: {
        candidateMatrix: [],
        blockingCount: 0,
        selectionRequiredCount: 0,
        advisoryCount: warnings.length,
        canCreateDecision: false,
      },
      objects: changedObjects,
      finalResult,
      sourceIdentity: resultSourceIdentity,
      reviewFingerprint: '',
    };
    projection.reviewFingerprint = await resultReviewFingerprintOf(projection, hasher);
    return projection;
  }
  const projection: HumanReviewProjectionV1 = {
    reviewVersion: '1.0.0',
    reviewId: input.reviewId,
    kind: 'integration-result',
    state: 'STAGE_READY',
    projectIdentity: plan.projectIdentity,
    expectedProjectRevision: plan.expectedProjectRevision,
    task: {
      title: 'Integration result review',
      acceptanceCriteria: [],
      candidateCount: 0,
      objectCount: changedObjects.length,
      conflictCount: 0,
      statementSource: 'generated-fallback',
    },
    candidates: [],
    safeGroups: [],
    conflicts: [],
    dependencies: [],
    defaultSelectedUnitIds: [],
    evidence: {
      candidateMatrix: [],
      blockingCount: 0,
      selectionRequiredCount: 0,
      advisoryCount: warnings.length,
      canCreateDecision: false,
    },
    objects: changedObjects,
    finalResult,
    sourceIdentity: resultSourceIdentity,
    reviewFingerprint: '',
  };
  projection.reviewFingerprint = await resultReviewFingerprintOf(projection, hasher);
  return projection;
}

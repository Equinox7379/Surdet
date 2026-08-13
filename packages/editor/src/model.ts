export {
  parseSceneLine as parseLine,
  parseSceneDocument as parseScript,
  serializeSceneDocument as serializeScript,
  rebuildTextRaw,
  rebuildLabelRaw,
  splitInstruction as splitInstr,
  rebuildInstructionRaw as rebuildInstrRaw,
} from '@surdet/authoring';
export type { SceneDocumentLine as LineModel } from '@surdet/authoring';

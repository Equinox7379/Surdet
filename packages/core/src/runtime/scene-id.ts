export const SCENE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function isValidSceneId(value: string): boolean {
  return SCENE_ID_PATTERN.test(value);
}

/** Windows file stems rejected at creation/rename, without narrowing in-memory scene IDs. */
export function isReservedSceneFileId(value: string): boolean {
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value);
}

export function assertValidSceneId(value: string): void {
  if (!isValidSceneId(value)) {
    throw new Error(`Invalid scene ID '${value}': scene IDs must start with a letter or digit and contain only letters, digits, '_' or '-'`);
  }
}

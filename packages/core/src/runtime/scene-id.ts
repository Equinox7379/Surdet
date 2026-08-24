export const SCENE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function isValidSceneId(value: string): boolean {
  return SCENE_ID_PATTERN.test(value);
}

export function assertValidSceneId(value: string): void {
  if (!isValidSceneId(value)) {
    throw new Error(`Invalid scene ID '${value}': scene IDs must start with a letter or digit and contain only letters, digits, '_' or '-'`);
  }
}

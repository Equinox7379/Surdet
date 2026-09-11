import { AuthoringOperationError } from './change-session.js';

/** Runtime scene identity is the filename stem, independent of scenario subdirectories. */
export function sceneIdFromScenarioPath(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1, -'.gal'.length);
}

/** Missing scenes remain absent; multiple files for one semantic ID are never guessed. */
export function resolveUniqueScenarioPath(workingFiles: Readonly<Record<string, string>>, sceneId: string): string | undefined {
  const paths = Object.keys(workingFiles).filter((path) => path.startsWith('content/scenario/')
    && path.toLowerCase().endsWith('.gal') && sceneIdFromScenarioPath(path) === sceneId);
  if (paths.length > 1) {
    throw new AuthoringOperationError('OBJECT_AMBIGUOUS', `场景身份 scene:${sceneId} 对应多个文件：${paths.sort().join('、')}`);
  }
  return paths[0];
}

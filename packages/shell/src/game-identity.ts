import path from 'node:path';

/** The display title and executable name never determine save ownership. */
export function gameIdentity(packageName: unknown, appData: string) {
  if (typeof packageName !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,119}$/.test(packageName)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(packageName)) throw new Error('作品缺少合法的稳定保存身份。');
  return { name: packageName, appId: `surdet.${packageName}`, userData: path.join(appData, 'Surdet Games', packageName) };
}

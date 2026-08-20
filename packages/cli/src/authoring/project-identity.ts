import * as crypto from 'node:crypto';

export function projectIdentityFromRoot(rootIdentity: string): string {
  return crypto.createHash('sha256').update(rootIdentity).digest('hex').slice(0, 32);
}

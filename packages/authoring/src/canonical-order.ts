/** Content identities must use the same UTF-16 ordering on every locale. */
export function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

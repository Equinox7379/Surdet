/** Existing Core identifier decoding used by dossiers, endings and system commands.
 * Inventory, CG/music/text unlocks and growth retain their literal-token contracts. */
export function dequoteInstrArg(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first !== '"' && first !== "'") || first !== last) return value;
  return value.slice(1, -1).replace(/\\(.)/g, '$1');
}

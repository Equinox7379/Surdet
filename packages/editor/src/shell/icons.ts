/** Small, bundled line icons for the workbench chrome. Labels remain real text. */
const paths: Record<string, string> = {
  editor: '<path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6"/>',
  assets: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/>',
  flow: '<rect x="8" y="2" width="8" height="5" rx="1"/><rect x="2" y="17" width="7" height="5" rx="1"/><rect x="15" y="17" width="7" height="5" rx="1"/><path d="M12 7v5M5.5 17v-5h13v5"/>',
  timeline: '<path d="M3 5h18M3 12h18M3 19h18M8 2v20"/><rect x="11" y="9" width="6" height="6" rx="1"/>',
  config: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  preview: '<path d="m9 6 10 6-10 6z"/><path d="M4 4v16"/>',
  review: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 11 3 3 5-6M8 18h8"/>',
  stats: '<path d="M4 3v18h17M8 16v-5M13 16V7M18 16V4"/>',
  audit: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10l2 2 4-5"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4M12 8v4l3 2"/>',
  blank: '<path d="M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  'open-project': '<path d="M3 7V4h7l2 3h9v3M3 7h7l2 3h9l-3 10H3z"/>',
  'open-review': '<path d="M7 3h10v18H4V6h3zM7 3v4h10M8 12h5M8 16h5"/>',
  undo: '<path d="m8 5-5 5 5 5M3 10h11a6 6 0 0 1 0 12" transform="translate(0 -2)"/>',
  redo: '<path d="m16 5 5 5-5 5M21 10H10a6 6 0 0 0 0 12" transform="translate(0 -2)"/>',
  'save-project': '<path d="M4 3h13l4 4v14H3V3zM7 3v6h9V3M7 21v-8h10v8"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
};

export function workbenchIcon(name: string): HTMLElement {
  const icon = document.createElement('span');
  icon.className = 'workbench-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? paths.editor}</svg>`;
  return icon;
}

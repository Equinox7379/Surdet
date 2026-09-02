import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEditorFile(relativePath: string): string {
  const absolutePath = path.resolve(editorRoot, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
}

const indexHtml = readEditorFile('index.html');
const mainSource = readEditorFile('src/main.ts');
const statsSource = readEditorFile('src/panels/stats-panel.ts');
const auditSource = readEditorFile('src/panels/audit-panel.ts');
const issueSource = readEditorFile('src/panels/issues.ts');
const configSource = readEditorFile('src/panels/config.ts');
const projectIoSource = readEditorFile('src/project-io.ts');
const workspaceStyles = readEditorFile('src/styles/project-health-workspace.css');
const legacyStyles = readEditorFile('src/styles.css');

describe('Frontend Pass 7 project health workspace layout', () => {
  it('loads one scoped stylesheet and mounts stable Stats/Audit identities', () => {
    expect(indexHtml).toContain('/src/styles/project-health-workspace.css');
    expect(mainSource).toContain("stEl.dataset['editorPanel'] = 'stats'");
    expect(mainSource).toContain("auEl.dataset['editorPanel'] = 'audit'");
    expect(statsSource).toContain("setAttribute('data-editor-region', 'project-overview')");
    expect(auditSource).toContain("setAttribute('data-editor-region', 'text-audit')");
  });

  it('retires KPI cards, mouse-only issue rows, and default technical noise', () => {
    expect(statsSource).not.toContain('stats-card');
    expect(statsSource).toContain('项目概览');
    expect(statsSource).toContain('计算说明');
    expect(statsSource).toContain("h('h2', undefined, '按场景查看')");
    expect(auditSource).not.toContain("h('div', `issue");
    expect(auditSource).toContain('文字一致性检查');
    expect(auditSource).toContain('查看技术信息');
    expect(auditSource).toContain('检查不完整');
    expect(auditSource).toContain("h('h2', undefined, titleText)");
    expect(legacyStyles).not.toMatch(/#stats-view\s*\{/);
    expect(legacyStyles).not.toMatch(/#audit-view\s*\{/);
    expect(legacyStyles).not.toMatch(/\.stats-card\s*\{/);
  });

  it('uses continuous token-based hierarchy without AI-styled rails or floating actions', () => {
    expect(workspaceStyles).toContain('[data-editor-panel="stats"]');
    expect(workspaceStyles).toContain('[data-editor-panel="audit"]');
    expect(workspaceStyles).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(workspaceStyles).not.toMatch(/border-(?:left|inline-start)\s*:\s*[2-9]px/i);
    expect(workspaceStyles).not.toMatch(/(?:linear|radial)-gradient\s*\(/i);
    expect(workspaceStyles).not.toMatch(/box-shadow/i);
    expect(workspaceStyles).not.toMatch(/position\s*:\s*(?:fixed|sticky)/i);
    expect(workspaceStyles).not.toMatch(/border-radius\s*:\s*999px/i);
  });

  it('protects long scene names, keyboard focus, and narrow layouts', () => {
    expect(workspaceStyles).toMatch(/\.project-health-table-scroll\s*\{[^}]*overflow-x:\s*auto/s);
    expect(workspaceStyles).toContain('overflow-wrap: anywhere');
    expect(workspaceStyles).toContain(':focus-visible');
    expect(workspaceStyles).toContain('@media (max-width: 1024px)');
    expect(workspaceStyles).toContain('@media (max-width: 720px)');
    expect(workspaceStyles).toContain('@media (max-width: 480px)');
    expect(workspaceStyles).toContain('prefers-reduced-motion');
  });

  it('invalidates project-scoped validation and configuration state before a project replacement', () => {
    expect(issueSource).toContain('export function invalidatePendingValidation');
    expect(issueSource).toContain('validateSeq += 1');
    expect(configSource).toContain('export function resetConfigSession');
    expect(configSource).toContain('configSessionRevision += 1');
    expect(configSource).toContain('if (revision !== configSessionRevision) return false');
    expect(projectIoSource).toContain('onProjectStateReset();');
    expect(mainSource).toContain('invalidatePendingValidation();');
    expect(mainSource).toContain('resetConfigSession();');
    expect(mainSource).toContain("if (state.mainTab !== 'audit') return;");
  });
});

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEditorFile(relativePath: string): string {
  const absolutePath = path.resolve(editorRoot, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function ruleBodiesMatching(css: string, selectorPattern: RegExp): string[] {
  return [...stripCssComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => selectorPattern.test(match[1] ?? ''))
    .map((match) => match[2] ?? '');
}

const flowSource = readEditorFile('src/panels/flow.ts');
const flowCss = readEditorFile('src/styles/flow-workspace.css');
const legacyCss = readEditorFile('src/styles.css');
const indexHtml = readEditorFile('index.html');

function expectsRegion(region: string): void {
  expect(
    flowSource,
    `flow.ts must expose data-editor-region=${region}`,
  ).toMatch(new RegExp(
    `(?:setAttribute\\(\\s*['\"]data-editor-region['\"]\\s*,\\s*['\"]${region}['\"]|dataset\\.editorRegion\\s*=\\s*['\"]${region}['\"])`,
  ));
}

describe('Flow Canvas semantic workspace contract', () => {
  it('mounts one named workbench with real status, commands, graph, legend, and minimap regions', () => {
    for (const region of ['flow-workbench', 'flow-status', 'flow-toolbar', 'flow-canvas', 'flow-legend', 'flow-minimap']) {
      expectsRegion(region);
    }

    expect(flowSource).toMatch(/剧情路径地图/);
    expect(flowSource).toMatch(/graph\.nodes\.length/);
    expect(flowSource).toMatch(/graph\.edges\.length/);
    expect(flowSource).toMatch(/sceneIssueStats\(\)/);
    expect(flowSource).toMatch(/(?:errors|errorCount)[\s\S]*?(?:warnings|warningCount)/);
    expect(flowSource).toMatch(/尚未校验/);
    expect(flowSource).toMatch(/当前项目没有可显示的剧情连接/);
  });

  it('offers Chinese-first focus and overview modes with an explicit pressed-state contract', () => {
    expect(flowSource).toMatch(/let\s+flowViewMode\s*:\s*FlowMapMode\s*=\s*['"]focus['"]/);
    expect(flowSource).toMatch(/h\(\s*['"]button['"]\s*,\s*['"]flow-view-switch-button['"]\s*,\s*['"]聚焦路径['"]\s*\)/);
    expect(flowSource).toMatch(/setAttribute\(\s*['"]data-flow-action['"]\s*,\s*['"]view-focus['"]\s*\)/);
    expect(flowSource).toMatch(/h\(\s*['"]button['"]\s*,\s*['"]flow-view-switch-button['"]\s*,\s*['"]全局概览['"]\s*\)/);
    expect(flowSource).toMatch(/setAttribute\(\s*['"]data-flow-action['"]\s*,\s*['"]view-overview['"]\s*\)/);
    expect(flowSource).toMatch(/focusView\.setAttribute\(\s*['"]aria-pressed['"]\s*,\s*String\(flowViewMode\s*===\s*['"]focus['"]/);
    expect(flowSource).toMatch(/overviewView\.setAttribute\(\s*['"]aria-pressed['"]\s*,\s*String\(flowViewMode\s*===\s*['"]overview['"]/);
  });

  it('keeps the scope explanation in normal document flow and exposes overflow through a real action', () => {
    expectsRegion('flow-scope-note');
    expect(flowSource).toMatch(/当前仅显示聚焦场景和直接前后场景/);
    expect(flowSource).toMatch(/在全局概览中查看/);
    expect(flowSource).toMatch(/setAttribute\(\s*['"]data-flow-action['"]\s*,\s*['"]view-overview-overflow['"]\s*\)/);

    const scopeRules = ruleBodiesMatching(flowCss, /^\s*\.flow-scope-note\s*$/i).join('\n');
    expect(scopeRules).not.toMatch(/position\s*:\s*(?:absolute|fixed)\b/i);
    expect(scopeRules).toMatch(/grid-column\s*:\s*1\s*\/\s*-1/i);
  });

  it('loads the dedicated flow layer after every shared and script workspace layer', () => {
    expect(flowCss.length, 'Wave 3A flow workspace stylesheet must exist').toBeGreaterThan(0);
    const hrefs = [...indexHtml.matchAll(/<link\b[^>]*>/gi)]
      .map((match) => match[0])
      .filter((tag) => /\brel=["']stylesheet["']/i.test(tag))
      .map((tag) => tag.match(/\bhref=["']([^"']+)["']/i)?.[1])
      .filter((href): href is string => href !== undefined);
    const flowIndex = hrefs.indexOf('/src/styles/flow-workspace.css');

    expect(flowIndex).toBeGreaterThan(hrefs.indexOf('/src/styles/tokens.css'));
    expect(flowIndex).toBeGreaterThan(hrefs.indexOf('/src/styles/components.css'));
    expect(flowIndex).toBeGreaterThan(hrefs.indexOf('/src/styles/app-shell.css'));
    expect(flowIndex).toBeGreaterThan(hrefs.indexOf('/src/styles/script-workspace.css'));
  });

  it('moves legacy flow rules into a token-driven, non-AI decorative layer', () => {
    expect(legacyCss).not.toMatch(/(?:^|\n)\s*(?:#flow-view|\.flow-menu|\.flow-minimap)\b/);

    const cleaned = stripCssComments(flowCss);
    expect(cleaned).not.toMatch(/(?:linear|radial|conic)-gradient\s*\(/i);
    expect(cleaned).not.toMatch(/(?:text-shadow|filter\s*:\s*(?:blur|drop-shadow))/i);
    expect(cleaned).not.toMatch(/border-(?:left|inline-start)(?:-color)?\s*:/i);
    expect(cleaned).not.toMatch(/inset\s+[1-9]\d*px\s+0/i);
    expect(cleaned).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(cleaned).not.toMatch(/var\(\s*--(?:bg|panel[a-z0-9-]*|accent[a-z0-9-]*|gold[a-z0-9-]*|shadow-(?:1|2))\b/i);
    expect(cleaned).toMatch(/var\(--surdet-(?:surface|text|border|action|state|focus)-/i);
  });

  it('uses a complete selected surface and explicit focus without a colored selection rail', () => {
    const selectedRules = [
      ...ruleBodiesMatching(flowCss, /\[aria-current\s*=\s*["']true["']\]/i),
      ...ruleBodiesMatching(flowCss, /\[aria-selected\s*=\s*["']true["']\]/i),
    ];
    const focusRules = ruleBodiesMatching(flowCss, /:focus-visible/i);

    expect(selectedRules.length).toBeGreaterThan(0);
    expect(selectedRules.join('\n')).toMatch(/(?:background|fill)\s*:\s*var\(--surdet-surface-selected\)/i);
    expect(selectedRules.join('\n')).toMatch(/(?:border|stroke)(?:-color)?\s*:\s*var\(--surdet-border-strong\)/i);
    expect(focusRules.length).toBeGreaterThan(0);
    expect(focusRules.join('\n')).toMatch(/(?:outline|stroke)\s*:/i);
    expect(focusRules.join('\n')).toMatch(/var\(--surdet-focus-ring\)/i);
  });

  it('keeps validation, edge kind, and legend meaning available without color alone', () => {
    expect(flowSource).toMatch(/flowValidationStateLabel/);
    expect(flowSource).toMatch(/flowEdgeKindLabel/);
    expect(flowSource).toMatch(/(?:错误|警告)/);
    expect(flowSource).toMatch(/(?:data-flow-validation|dataset\.flowValidation|aria-description)/);
    expect(flowSource).toMatch(/(?:stroke-dasharray|data-flow-edge-kind|dataset\.flowEdgeKind)/);
    expect(flowSource).toMatch(/技术信息/);

    const errorStatusRules = ruleBodiesMatching(flowCss, /\.flow-scene-frame\.has-error\s+\.flow-scene-frame-status/i);
    const warningStatusRules = ruleBodiesMatching(flowCss, /\.flow-scene-frame\.has-warning\s+\.flow-scene-frame-status/i);
    expect(errorStatusRules.join('\n')).toMatch(/fill\s*:\s*var\(--surdet-state-danger\)/i);
    expect(warningStatusRules.join('\n')).toMatch(/fill\s*:\s*var\(--surdet-state-warning\)/i);
    expect(flowSource).toMatch(/statusParts\.push\(`警告/);

    const edgeLabelRules = ruleBodiesMatching(flowCss, /\.flow-route-chip-(?:surface|text)\b/i);
    expect(edgeLabelRules.join('\n')).toMatch(/pointer-events\s*:\s*none/i);
    const legendRules = ruleBodiesMatching(flowCss, /^\s*\.flow-legend\s*$/i);
    expect(legendRules.join('\n')).toMatch(/position\s*:\s*relative/i);
  });

  it('closes the technical overlay when technical routes return to the readable default', () => {
    expect(flowSource).toMatch(
      /technicalEdgesVisible\s*=\s*!technicalEdgesVisible[\s\S]{0,240}?technicalDetailsExpanded\s*=\s*technicalEdgesVisible/,
    );
    expect(flowSource).not.toMatch(
      /technicalEdgesVisible\s*=\s*!technicalEdgesVisible[\s\S]{0,240}?technicalDetailsExpanded\s*=\s*true/,
    );
    expect(flowSource).toMatch(
      /technical\.addEventListener\(\s*['"]toggle['"][\s\S]{0,180}?if\s*\(\s*!technical\.isConnected\s*\)\s*return/,
    );
    expect(flowSource).toMatch(
      /renderFlow\([\s\S]{0,220}?if\s*\(\s*!technicalEdgesVisible\s*\)\s*technicalDetailsExpanded\s*=\s*false/,
    );
    const technicalPanelRules = ruleBodiesMatching(flowCss, /\.flow-technical-panel\b/i);
    expect(technicalPanelRules.join('\n')).toMatch(/position\s*:\s*static/i);
    expect(technicalPanelRules.join('\n')).not.toMatch(/position\s*:\s*(?:absolute|fixed|sticky)/i);
  });

  it('removes the inline rainbow palette and presentation colors from the SVG renderer', () => {
    expect(flowSource).not.toMatch(/\bEDGE_COLORS\b/);
    expect(flowSource).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(flowSource).not.toMatch(/svg\.style\.background\s*=/);
    expect(flowSource).toMatch(/classList\.add\(\s*['"]flow-/);
  });
});

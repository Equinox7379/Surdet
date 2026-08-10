/** 可由 JSON 持久化的窗口状态。Electron 之外的纯逻辑也使用这组类型。 */
export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  fullScreen?: boolean;
}

/** Electron Display.workArea 的最小纯数据投影。 */
export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const MIN_WIDTH = 640;
const MIN_HEIGHT = 360;
const MIN_VISIBLE_AXIS = 64;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isWorkArea(value: WorkArea): boolean {
  return isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
    && isFiniteNumber(value.width)
    && isFiniteNumber(value.height)
    && value.width > 0
    && value.height > 0;
}

function positiveFinite(value: unknown, fallback: number): number {
  return isFiniteNumber(value) && value > 0 ? value : fallback;
}

function clampDimension(requested: number, areaSize: number | undefined, minimum: number): number {
  const safeMinimum = areaSize === undefined
    ? minimum
    : Math.min(minimum, Math.max(1, Math.floor(areaSize)));
  const safeMaximum = areaSize === undefined
    ? Number.MAX_SAFE_INTEGER
    : Math.max(safeMinimum, Math.floor(areaSize));
  return Math.min(safeMaximum, Math.max(safeMinimum, Math.floor(requested)));
}

function intersectionSize(start: number, size: number, areaStart: number, areaSize: number): number {
  return Math.max(0, Math.min(start + size, areaStart + areaSize) - Math.max(start, areaStart));
}

function visibleArea(windowState: Pick<WindowState, 'x' | 'y' | 'width' | 'height'>, area: WorkArea): number {
  if (windowState.x === undefined || windowState.y === undefined) return 0;
  const width = intersectionSize(windowState.x, windowState.width, area.x, area.width);
  const height = intersectionSize(windowState.y, windowState.height, area.y, area.height);
  return width * height;
}

function hasEnoughVisible(windowState: Pick<WindowState, 'x' | 'y' | 'width' | 'height'>, area: WorkArea): boolean {
  if (windowState.x === undefined || windowState.y === undefined) return false;
  const width = intersectionSize(windowState.x, windowState.width, area.x, area.width);
  const height = intersectionSize(windowState.y, windowState.height, area.y, area.height);
  return width >= Math.min(MIN_VISIBLE_AXIS, windowState.width)
    && height >= Math.min(MIN_VISIBLE_AXIS, windowState.height);
}

function areaWithLargestIntersection(
  windowState: Pick<WindowState, 'x' | 'y' | 'width' | 'height'>,
  areas: readonly WorkArea[],
): WorkArea | undefined {
  let best: WorkArea | undefined;
  let bestVisible = 0;
  for (const area of areas) {
    const visible = visibleArea(windowState, area);
    if (visible > bestVisible) {
      bestVisible = visible;
      best = area;
    }
  }
  return best;
}

function centeredPosition(area: WorkArea, width: number, height: number): Pick<WindowState, 'x' | 'y'> {
  return {
    x: area.x + Math.max(0, Math.floor((area.width - width) / 2)),
    y: area.y + Math.max(0, Math.floor((area.height - height) / 2)),
  };
}

/**
 * 校验并修复持久化窗口状态。
 *
 * 规则保持纯函数：不读取文件、不调用 Electron、不改变输入对象。有效位置只要在任一
 * workArea 中保留至少 64×64（或窗口自身尺寸）的可见交集就继续使用；完全离屏或只
 * 露出微小角落时，回到主屏安全区域中央。超大尺寸按目标屏幕工作区收缩，但保留可用
 * 的最小尺寸，避免把窗口压成无法操作的细条。
 */
export function resolveWindowState(raw: unknown, workAreas: readonly WorkArea[]): WindowState {
  const input = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const areas = workAreas.filter(isWorkArea);
  const primary = areas[0];
  const requestedWidth = positiveFinite(input.width, DEFAULT_WIDTH);
  const requestedHeight = positiveFinite(input.height, DEFAULT_HEIGHT);
  const requestedX = isFiniteNumber(input.x) ? input.x : undefined;
  const requestedY = isFiniteNumber(input.y) ? input.y : undefined;
  const requestedPosition = requestedX !== undefined && requestedY !== undefined
    ? { x: requestedX, y: requestedY }
    : undefined;
  const requestedBox: WindowState = {
    ...requestedPosition,
    width: requestedWidth,
    height: requestedHeight,
  };
  const positionArea = requestedPosition === undefined
    ? undefined
    : areaWithLargestIntersection(requestedBox, areas);
  const sizingArea = positionArea ?? primary;
  const width = clampDimension(requestedWidth, sizingArea?.width, MIN_WIDTH);
  const height = clampDimension(requestedHeight, sizingArea?.height, MIN_HEIGHT);
  const fullScreen = typeof input.fullScreen === 'boolean' ? input.fullScreen : undefined;
  const flags = fullScreen === undefined ? {} : { fullScreen };

  if (requestedPosition !== undefined) {
    const positioned: WindowState = { ...requestedPosition, width, height, ...flags };
    if (areas.some((area) => hasEnoughVisible(positioned, area))) return positioned;
  }

  if (primary !== undefined) {
    const safeWidth = clampDimension(requestedWidth, primary.width, MIN_WIDTH);
    const safeHeight = clampDimension(requestedHeight, primary.height, MIN_HEIGHT);
    return {
      ...centeredPosition(primary, safeWidth, safeHeight),
      width: safeWidth,
      height: safeHeight,
      ...flags,
    };
  }

  return { width, height, ...flags };
}

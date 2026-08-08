import type { CoreEventMap, EventBus } from '@surdet/core';

export function connectSystemRouter(
  bus: EventBus<CoreEventMap>,
  host: { routeSystem(id: string, payload: unknown): Promise<boolean> },
  onError?: (error: unknown) => void,
): () => void {
  return bus.on('system', (payload) => {
    void host.routeSystem(payload.type, payload).catch((error) => onError?.(error));
  });
}

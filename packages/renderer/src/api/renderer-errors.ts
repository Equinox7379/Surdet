/** Stable error codes exposed by the Renderer v2 boundary. */
export type RendererErrorCode =
  | 'RENDERER_NOT_INITIALIZED'
  | 'RENDERER_DISPOSED'
  | 'INVALID_COMMAND_PAYLOAD'
  | 'ASSET_NOT_REGISTERED'
  | 'LAYER_INITIALIZATION_FAILED'
  | 'COMMAND_COMMIT_FAILED'
  | 'PRESENTATION_SNAPSHOT_INVALID'
  | 'LEGACY_CONTRACT_VIOLATION';

export interface RendererErrorOptions {
  code: RendererErrorCode;
  domain: string;
  command?: string;
  cause?: unknown;
}

/**
 * Error crossing the renderer boundary.
 * The original cause is deliberately retained for host diagnostics.
 */
export class RendererError extends Error {
  override readonly name: string = 'RendererError';
  readonly code: RendererErrorCode;
  readonly domain: string;
  readonly command?: string;
  override readonly cause?: unknown;

  constructor(message: string, options: RendererErrorOptions) {
    super(message);
    this.code = options.code;
    this.domain = options.domain;
    this.command = options.command;
    this.cause = options.cause;
  }
}

/** Synchronous command validation/commit failure with command context. */
export class RendererCommandError extends RendererError {
  override readonly name: string = 'RendererCommandError';

  constructor(message: string, options: Omit<RendererErrorOptions, 'command'> & { command: string }) {
    super(message, options);
  }
}

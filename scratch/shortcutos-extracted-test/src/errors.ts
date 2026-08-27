export type ShortcutError = {
  code: string;
  message: string;
  scope: string;
  details?: unknown;
  blockedBy?: string[];
  retryable: boolean;
  safeNextAction?: string;
};

export class ShortcutOSError extends Error {
  readonly shortcut: ShortcutError;
  constructor(shortcut: ShortcutError) {
    super(`${shortcut.code}: ${shortcut.message}`);
    this.name = 'ShortcutOSError';
    this.shortcut = shortcut;
  }
}

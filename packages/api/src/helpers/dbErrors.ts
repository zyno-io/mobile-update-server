/**
 * Detects MySQL duplicate-key (1062) errors. The mysql2 driver tags errors with
 * `errno` and `code: 'ER_DUP_ENTRY'`; deepkit-orm passes them through.
 */
export function isDuplicateKeyError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { errno?: number; code?: string; cause?: unknown };
    if (e.errno === 1062 || e.code === 'ER_DUP_ENTRY') return true;
    if (e.cause) return isDuplicateKeyError(e.cause);
    return false;
}

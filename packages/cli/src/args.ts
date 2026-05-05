/**
 * Tiny zero-dep flag parser. Supports `--key=value` and `--key value`.
 * Returns the parsed flags plus the leftover positional args.
 */
export function parseFlags(argv: string[]): { flags: Record<string, string>; positional: string[] } {
    const flags: Record<string, string> = {};
    const positional: string[] = [];

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const eqIdx = arg.indexOf('=');
            if (eqIdx >= 0) {
                flags[arg.substring(2, eqIdx)] = arg.substring(eqIdx + 1);
            } else {
                const key = arg.substring(2);
                const next = argv[i + 1];
                if (next !== undefined && !next.startsWith('--')) {
                    flags[key] = next;
                    i++;
                } else {
                    flags[key] = 'true';
                }
            }
        } else {
            positional.push(arg);
        }
    }

    return { flags, positional };
}

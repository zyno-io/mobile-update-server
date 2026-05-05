import assert from 'node:assert';
import { test } from 'node:test';

import { parseFlags } from './args.js';

test('parseFlags --key=value form', () => {
    const { flags, positional } = parseFlags(['--binary-version=1.2.3', '--fingerprint=abc']);
    assert.strictEqual(flags['binary-version'], '1.2.3');
    assert.strictEqual(flags.fingerprint, 'abc');
    assert.deepStrictEqual(positional, []);
});

test('parseFlags --key value form', () => {
    const { flags, positional } = parseFlags(['--binary-version', '1.2.3', '--fingerprint', 'abc']);
    assert.strictEqual(flags['binary-version'], '1.2.3');
    assert.strictEqual(flags.fingerprint, 'abc');
    assert.deepStrictEqual(positional, []);
});

test('parseFlags mixes flags + positional', () => {
    const { flags, positional } = parseFlags(['./dist', '--key=v']);
    assert.strictEqual(flags.key, 'v');
    assert.deepStrictEqual(positional, ['./dist']);
});

test('parseFlags bare --flag becomes "true"', () => {
    const { flags } = parseFlags(['--verbose']);
    assert.strictEqual(flags.verbose, 'true');
});

test('parseFlags does NOT consume next arg if it starts with --', () => {
    const { flags } = parseFlags(['--first', '--second=v']);
    assert.strictEqual(flags.first, 'true');
    assert.strictEqual(flags.second, 'v');
});

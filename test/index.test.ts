import test from 'node:test';
import assert from 'node:assert/strict';
import { standardTool, type StandardTool, type CombinedSchema } from '../dist/index.js';

// ---------------------------------------------------------------------------
// Compile-time exact-type assertions. These are erased at runtime; they are
// enforced by `npm run typecheck` (tsconfig.test.json), which CI runs via
// `npm test`. A wrong type makes `Expect<false>` fail to compile.
// `ExecOut<T>` is what `await tool.execute(...)` yields — the 3rd generic.
// ---------------------------------------------------------------------------
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type ExecOut<T extends { execute: (input: never) => unknown }> = Awaited<ReturnType<T['execute']>>;

// A minimal inline CombinedSchema (validate + jsonSchema), like Zod/ArkType/Valibot provide.
const makeSchema = <T>(
  check: (value: unknown) => string | null,
  jsonIn: Record<string, unknown>
): CombinedSchema<T> => ({
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) => {
      const error = check(value);
      return error ? { issues: [{ message: error }] } : { value: value as T };
    },
    jsonSchema: { input: () => jsonIn, output: () => ({}) },
  },
});

const inputSchema = makeSchema<{ city: string }>(
  (v) => (typeof (v as { city?: unknown })?.city === 'string' ? null : 'city must be a string'),
  { type: 'object', properties: { city: { type: 'string' } }, required: ['city'], additionalProperties: false }
);
const outputSchema = makeSchema<{ tempC: number }>(
  (v) => (typeof (v as { tempC?: unknown })?.tempC === 'number' ? null : 'tempC must be a number'),
  {}
);

// ---------------------------------------------------------------------------
// Tools at module scope, one per `formatOutput` variant, so we can assert the
// type of `execute` (and reuse them in the runtime tests below).
// ---------------------------------------------------------------------------

// (1) default formatOutput, with schemas → FormattedOutput = Output | { error }
const weather = standardTool({
  name: 'get_weather',
  description: 'Current temperature for a city',
  inputSchema,
  outputSchema,
  execute: async () => ({ tempC: 21 }),
});
type _Weather = Expect<Equals<ExecOut<typeof weather>, { tempC: number } | { error: string }>>;
weather satisfies StandardTool<{ city: string }, { tempC: number }>;
weather satisfies StandardTool<{ city: string }, { tempC: number }, { tempC: number } | { error: string }>;

// (2) default formatOutput, no schemas → Input/Output inferred from execute; FormattedOutput = Output | { error }
const echo = standardTool({
  name: 'echo',
  description: 'adds one',
  execute: (input: { x: number }) => ({ y: input.x + 1 }),
});
type _Echo = Expect<Equals<ExecOut<typeof echo>, { y: number } | { error: string }>>;
echo satisfies StandardTool<{ x: number }, { y: number }>;

// (3) sync custom formatOutput returning string → FormattedOutput = string
const stringFmt = standardTool({
  name: 'string_fmt',
  description: 'formats to a string',
  inputSchema,
  outputSchema,
  formatOutput: (result) => (result instanceof Error ? `error: ${result.message}` : `ok: ${result.tempC}`),
  execute: async () => ({ tempC: 9 }),
});
type _StringFmt = Expect<Equals<ExecOut<typeof stringFmt>, string>>;
stringFmt satisfies StandardTool<{ city: string }, { tempC: number }, string>;

// (4) async custom formatOutput returning Promise<{ status }> → FormattedOutput = { status } (awaited, not a Promise)
const asyncFmt = standardTool({
  name: 'async_fmt',
  description: 'async formatter',
  inputSchema,
  outputSchema,
  formatOutput: async (result) => ({ status: result instanceof Error ? result.message : 'ok' }),
  execute: async () => ({ tempC: 5 }),
});
type _AsyncAwaited = Expect<Equals<ExecOut<typeof asyncFmt>, { status: string }>>;
type _AsyncRaw = Expect<Equals<ReturnType<typeof asyncFmt.execute>, { status: string } | Promise<{ status: string }>>>;

// (5) passthrough formatOutput returning the raw result → FormattedOutput = Output | Error
const passthrough = standardTool({
  name: 'passthrough',
  description: 'returns the raw result/error',
  inputSchema,
  outputSchema,
  formatOutput: (result) => result,
  execute: async () => ({ tempC: 1 }),
});
type _Passthrough = Expect<Equals<ExecOut<typeof passthrough>, { tempC: number } | Error>>;

// (6) throwing formatOutput (escape hatch) → FormattedOutput = Output
const strict = standardTool({
  name: 'strict',
  description: 'throws on error',
  inputSchema,
  outputSchema,
  formatOutput: (result) => {
    if (result instanceof Error) throw result;
    return result;
  },
  execute: async () => ({ tempC: 1 }),
});
type _Strict = Expect<Equals<ExecOut<typeof strict>, { tempC: number }>>;

// ---------------------------------------------------------------------------
// Runtime behavior
// ---------------------------------------------------------------------------

test('exposes exactly name, description, inputSchema, outputSchema, execute (no formatOutput member)', () => {
  assert.deepEqual(Object.keys(weather).sort(), ['description', 'execute', 'inputSchema', 'name', 'outputSchema']);
});

test('default formatOutput returns the validated value on success', async () => {
  assert.deepEqual(await weather.execute({ city: 'Paris' }), { tempC: 21 });
});

test('exposes JSON Schema via Standard JSON Schema', () => {
  const { inputSchema } = weather;
  assert.ok(inputSchema); // optional on the type; present here
  const schema = inputSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.required, ['city']);
});

test('default formatOutput: invalid input → { error } envelope (no throw)', async () => {
  assert.deepEqual(await weather.execute({ city: 123 } as unknown as { city: string }), {
    error: 'input validation failed: city must be a string',
  });
});

test('default formatOutput: invalid output → { error } envelope (no throw)', async () => {
  const bad = standardTool({
    name: 'bad',
    description: 'wrong shape',
    inputSchema,
    outputSchema,
    execute: async () => ({ tempC: 'hot' }) as unknown as { tempC: number },
  });
  assert.deepEqual(await bad.execute({ city: 'Paris' }), { error: 'output validation failed: tempC must be a number' });
});

test('default formatOutput: errors thrown in execute → { error } envelope', async () => {
  const boom = standardTool({
    name: 'boom',
    description: 'throws',
    inputSchema,
    outputSchema,
    execute: async () => {
      throw new Error('kaboom');
    },
  });
  assert.deepEqual(await boom.execute({ city: 'Paris' }), { error: 'kaboom' });
});

test('optional schemas: validation skipped when omitted', async () => {
  assert.equal(echo.inputSchema, undefined);
  assert.equal(echo.outputSchema, undefined);
  assert.deepEqual(await echo.execute({ x: 1 }), { y: 2 });
});

test('sync custom formatOutput reshapes the result', async () => {
  assert.equal(await stringFmt.execute({ city: 'Paris' }), 'ok: 9');
  assert.equal(
    await stringFmt.execute({ city: 123 } as unknown as { city: string }),
    'error: input validation failed: city must be a string'
  );
});

test('async custom formatOutput is awaited', async () => {
  assert.deepEqual(await asyncFmt.execute({ city: 'Paris' }), { status: 'ok' });
  assert.deepEqual(await asyncFmt.execute({ city: 123 } as unknown as { city: string }), {
    status: 'input validation failed: city must be a string',
  });
});

test('passthrough formatOutput exposes the raw Error carrying issues', async () => {
  assert.deepEqual(await passthrough.execute({ city: 'Paris' }), { tempC: 1 });
  const err = await passthrough.execute({ city: 123 } as unknown as { city: string });
  assert.ok(err instanceof Error);
  assert.match(err.message, /city must be a string/);
  const issues = (err as Error & { issues: { message: string }[] }).issues;
  assert.equal(issues[0].message, 'city must be a string');
});

test('throwing formatOutput restores throwing (escape hatch)', async () => {
  assert.deepEqual(await strict.execute({ city: 'Paris' }), { tempC: 1 });
  await assert.rejects(
    () => Promise.resolve(strict.execute({ city: 123 } as unknown as { city: string })),
    /city must be a string/
  );
});

test('supports async validators', async () => {
  const num: CombinedSchema<number> = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: async (value) =>
        typeof value === 'number' ? { value } : { issues: [{ message: 'must be a number' }] },
      jsonSchema: { input: () => ({ type: 'number' }), output: () => ({ type: 'number' }) },
    },
  };
  const double = standardTool({
    name: 'double',
    description: 'doubles a number',
    inputSchema: num,
    outputSchema: num,
    execute: async (n) => n * 2,
  });
  type _Double = Expect<Equals<ExecOut<typeof double>, number | { error: string }>>;
  assert.equal(await double.execute(21), 42);
});

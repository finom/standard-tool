import test from 'node:test';
import assert from 'node:assert/strict';
import { standardTool, type StandardTool, type CombinedSchema } from '../dist/index.js';

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

const weather = standardTool({
  name: 'get_weather',
  description: 'Current temperature for a city',
  inputSchema,
  outputSchema,
  execute: async ({ city }) => ({ tempC: 21 }),
});

// the returned tool conforms to the exported StandardTool type (data types, not schema types).
// Without a custom formatOutput, the model-facing output is the default `{ tempC } | { error }`:
weather satisfies StandardTool<{ city: string }, { tempC: number }>;
weather satisfies StandardTool<{ city: string }, { tempC: number }, { tempC: number } | { error: string }>;

test('exposes exactly name, description, inputSchema, outputSchema, execute', () => {
  assert.deepEqual(Object.keys(weather).sort(), ['description', 'execute', 'inputSchema', 'name', 'outputSchema']);
  assert.equal(weather.name, 'get_weather');
  assert.equal(weather.description, 'Current temperature for a city');
});

test('validates input and output, returning the validated value on success', async () => {
  assert.deepEqual(await weather.execute({ city: 'Paris' }), { tempC: 21 });
});

test('exposes JSON Schema via Standard JSON Schema', () => {
  const schema = weather.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.required, ['city']);
});

test('does NOT throw on invalid input — returns the default { error } envelope', async () => {
  const result = await weather.execute({ city: 123 } as unknown as { city: string });
  assert.deepEqual(result, { error: 'input validation failed: city must be a string' });
});

test('does NOT throw on invalid output — returns the default { error } envelope', async () => {
  const bad = standardTool({
    name: 'bad',
    description: 'returns a wrong shape',
    inputSchema,
    outputSchema,
    execute: async () => ({ tempC: 'hot' }) as unknown as { tempC: number },
  });
  assert.deepEqual(await bad.execute({ city: 'Paris' }), { error: 'output validation failed: tempC must be a number' });
});

test('catches errors thrown inside execute and returns the { error } envelope', async () => {
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

test('inputSchema and outputSchema are optional — when omitted, validation is skipped', async () => {
  const echo = standardTool({
    name: 'echo',
    description: 'adds one',
    execute: (input: { x: number }) => ({ y: input.x + 1 }),
  });
  echo satisfies StandardTool<{ x: number }, { y: number }>;
  assert.equal(echo.inputSchema, undefined);
  assert.equal(echo.outputSchema, undefined);
  assert.deepEqual(await echo.execute({ x: 1 }), { y: 2 });
});

test('custom formatOutput reshapes the result (its return type is the tool output)', async () => {
  const tool = standardTool({
    name: 'custom',
    description: 'custom formatter',
    inputSchema,
    outputSchema,
    formatOutput: (result) => (result instanceof Error ? `error: ${result.message}` : `ok: ${result.tempC}`),
    execute: async () => ({ tempC: 9 }),
  });
  tool satisfies StandardTool<{ city: string }, { tempC: number }, string>;
  assert.equal(await tool.execute({ city: 'Paris' }), 'ok: 9');
  assert.equal(
    await tool.execute({ city: 123 } as unknown as { city: string }),
    'error: input validation failed: city must be a string'
  );
});

test('a throwing formatOutput restores throwing behavior (the escape hatch)', async () => {
  const tool = standardTool({
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
  await assert.rejects(
    () => Promise.resolve(tool.execute({ city: 123 } as unknown as { city: string })),
    /city must be a string/
  );
});

test('validation failures are plain Errors carrying an issues array (no dedicated error type)', async () => {
  const tool = standardTool({
    name: 'raw',
    description: 'returns the raw error',
    inputSchema,
    outputSchema,
    formatOutput: (result) => result, // pass through so we can inspect the Error
    execute: async () => ({ tempC: 1 }),
  });
  const result = await tool.execute({ city: 123 } as unknown as { city: string });
  assert.ok(result instanceof Error);
  assert.match(result.message, /city must be a string/);
  const issues = (result as Error & { issues: { message: string }[] }).issues;
  assert.ok(Array.isArray(issues));
  assert.equal(issues[0].message, 'city must be a string');
});

test('supports async validators', async () => {
  const num: CombinedSchema<number> = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: async (value) => (typeof value === 'number' ? { value } : { issues: [{ message: 'must be a number' }] }),
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
  assert.equal(await double.execute(21), 42);
});

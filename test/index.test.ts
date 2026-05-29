import test from 'node:test';
import assert from 'node:assert/strict';
import {
  standardTool,
  ToolValidationError,
  type StandardTool,
  type CombinedSchema,
} from '../dist/index.js';

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
// Without a custom toModelOutput, the model-facing output is the default `{ tempC } | { error }`:
weather satisfies StandardTool<{ city: string }, { tempC: number }>;
weather satisfies StandardTool<{ city: string }, { tempC: number }, { tempC: number } | { error: string }>;

test('exposes exactly name, description, inputSchema, outputSchema, toModelOutput, execute', () => {
  assert.deepEqual(Object.keys(weather).sort(), [
    'description',
    'execute',
    'inputSchema',
    'name',
    'outputSchema',
    'toModelOutput',
  ]);
  assert.equal(weather.name, 'get_weather');
  assert.equal(weather.description, 'Current temperature for a city');
});

test('validates input and output, returning the validated value on success', async () => {
  assert.deepEqual(await weather.execute({ city: 'Paris' }), { tempC: 21 });
});

test('exposes JSON Schema via Standard JSON Schema', () => {
  const schema = weather.inputSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
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
  const result = await bad.execute({ city: 'Paris' });
  assert.deepEqual(result, { error: 'output validation failed: tempC must be a number' });
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

test('exposes toModelOutput on the object; default maps Error → { error } and passes data through', () => {
  assert.equal(typeof weather.toModelOutput, 'function');
  assert.deepEqual(weather.toModelOutput(new Error('nope')), { error: 'nope' });
  assert.deepEqual(weather.toModelOutput({ tempC: 7 }), { tempC: 7 });
});

test('custom toModelOutput reshapes the result (its return type is the tool output)', async () => {
  const tool = standardTool({
    name: 'custom',
    description: 'custom formatter',
    inputSchema,
    outputSchema,
    toModelOutput: (result) => (result instanceof Error ? `error: ${result.message}` : `ok: ${result.tempC}`),
    execute: async () => ({ tempC: 9 }),
  });
  tool satisfies StandardTool<{ city: string }, { tempC: number }, string>;
  assert.equal(await tool.execute({ city: 'Paris' }), 'ok: 9');
  assert.equal(await tool.execute({ city: 123 } as unknown as { city: string }), 'error: input validation failed: city must be a string');
});

test('a re-throwing toModelOutput restores throwing behavior (the escape hatch)', async () => {
  const tool = standardTool({
    name: 'strict',
    description: 'throws on error',
    inputSchema,
    outputSchema,
    toModelOutput: (result) => {
      if (result instanceof Error) throw result;
      return result;
    },
    execute: async () => ({ tempC: 1 }),
  });
  await assert.rejects(
    () => Promise.resolve(tool.execute({ city: 123 } as unknown as { city: string })),
    (err) => {
      assert.ok(err instanceof ToolValidationError);
      assert.equal(err.target, 'input');
      assert.match(err.message, /city must be a string/);
      return true;
    }
  );
});

test('toModelOutput receives a ToolValidationError that is JSON-serializable via toJSON', async () => {
  const tool = standardTool({
    name: 'raw',
    description: 'returns the raw error',
    inputSchema,
    outputSchema,
    // return the error itself so we can inspect it
    toModelOutput: (result) => result,
    execute: async () => ({ tempC: 1 }),
  });
  const result = await tool.execute({ city: 123 } as unknown as { city: string });
  assert.ok(result instanceof ToolValidationError);
  assert.equal(result.target, 'input');
  const json = JSON.parse(JSON.stringify(result)) as {
    name: string;
    target: string;
    message: string;
    issues: unknown[];
  };
  assert.equal(json.name, 'ToolValidationError');
  assert.equal(json.target, 'input');
  assert.ok(Array.isArray(json.issues));
  assert.match(json.message, /city must be a string/);
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

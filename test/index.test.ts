import test from 'node:test';
import assert from 'node:assert/strict';
import { standardTool, ToolValidationError, type StandardTool, type CombinedSchema } from '../dist/index.js';

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

// the returned tool conforms to the exported StandardTool type (data types, not schema types):
weather satisfies StandardTool<{ city: string }, { tempC: number }>;

test('exposes exactly name, description, inputSchema, outputSchema, execute', () => {
  assert.deepEqual(Object.keys(weather).sort(), ['description', 'execute', 'inputSchema', 'name', 'outputSchema']);
  assert.equal(weather.name, 'get_weather');
  assert.equal(weather.description, 'Current temperature for a city');
});

test('validates input and output, returning the validated value', async () => {
  assert.deepEqual(await weather.execute({ city: 'Paris' }), { tempC: 21 });
});

test('exposes JSON Schema via Standard JSON Schema', () => {
  const schema = weather.inputSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.required, ['city']);
});

test('throws ToolValidationError on invalid input', async () => {
  await assert.rejects(
    () => weather.execute({ city: 123 } as unknown as { city: string }),
    (err) => {
      assert.ok(err instanceof ToolValidationError);
      assert.equal(err.target, 'input');
      assert.match(err.message, /city must be a string/);
      return true;
    }
  );
});

test('ToolValidationError is JSON-serializable via toJSON', async () => {
  await assert.rejects(
    () => weather.execute({ city: 123 } as unknown as { city: string }),
    (err) => {
      assert.ok(err instanceof ToolValidationError);
      const json = JSON.parse(JSON.stringify(err)) as {
        name: string;
        target: string;
        message: string;
        issues: unknown[];
      };
      assert.equal(json.name, 'ToolValidationError');
      assert.equal(json.target, 'input');
      assert.ok(Array.isArray(json.issues));
      assert.match(json.message, /city must be a string/);
      return true;
    }
  );
});

test('throws ToolValidationError on invalid output', async () => {
  const bad = standardTool({
    name: 'bad',
    description: 'returns a wrong shape',
    inputSchema,
    outputSchema,
    execute: async () => ({ tempC: 'hot' }) as unknown as { tempC: number },
  });
  await assert.rejects(
    () => bad.execute({ city: 'Paris' }),
    (err) => {
      assert.ok(err instanceof ToolValidationError);
      assert.equal(err.target, 'output');
      return true;
    }
  );
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

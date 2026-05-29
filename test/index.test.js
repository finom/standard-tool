import test from 'node:test';
import assert from 'node:assert/strict';
import { standardTool, ToolValidationError } from '../dist/index.js';

// A minimal inline CombinedSchema (validate + jsonSchema), like Zod/ArkType/Valibot provide.
const makeSchema = (check, jsonIn) => ({
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (v) => {
      const err = check(v);
      return err ? { issues: [{ message: err }] } : { value: v };
    },
    jsonSchema: { input: () => jsonIn, output: () => ({}) },
  },
});

const inputSchema = makeSchema(
  (v) => (v && typeof v.city === 'string' ? null : 'city must be a string'),
  { type: 'object', properties: { city: { type: 'string' } }, required: ['city'], additionalProperties: false }
);
const outputSchema = makeSchema((v) => (v && typeof v.tempC === 'number' ? null : 'tempC must be a number'), {});

const weather = standardTool({
  name: 'get_weather',
  description: 'Current temperature for a city',
  inputSchema,
  outputSchema,
  execute: async ({ city }) => ({ tempC: 21 }),
});

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
    () => weather.execute({ city: 123 }),
    (err) => {
      assert.ok(err instanceof ToolValidationError);
      assert.equal(err.target, 'input');
      assert.match(err.message, /city must be a string/);
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
    execute: async () => ({ tempC: 'hot' }),
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
  const num = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: async (v) => (typeof v === 'number' ? { value: v } : { issues: [{ message: 'must be a number' }] }),
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

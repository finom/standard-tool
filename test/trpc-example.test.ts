import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { type StandardToolV0, StandardToolValidationError, standardTool, withFormattedOutput } from '../dist/index.js';

// The WHY.md "From procedures you already have" example, against real @trpc/server.

// Compile-time helpers, mirroring index.test.ts.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type ExecOut<T extends { execute: (input: never) => unknown }> = Awaited<ReturnType<T['execute']>>;
type ContextParam<T extends { execute: (input: never) => unknown }> = Parameters<T['execute']>[1];
const expectType = <_Pass extends true>(): void => {};

// The "existing tRPC app" WHY.md imports as `./trpc`, inlined here.
const t = initTRPC.create();
const cityInput = z.object({ city: z.string() });
const weatherOutput = z.object({ tempC: z.number() });
const appRouter = t.router({
  getWeather: t.procedure
    .input(cityInput)
    .output(weatherOutput)
    .query(() => ({ tempC: 21 })),
});

// The same adapter through the reference builder (WHY.md's inferring alternative).
const caller = appRouter.createCaller({}); // {} is the tRPC context
const getWeather = standardTool({
  name: 'get_weather',
  description: 'Current temperature for a city',
  inputSchema: cityInput,
  execute: (input) => caller.getWeather(input),
});

// standardTool infers Input, Output, and a clean (unknown) Context.
expectType<Equals<ExecOut<typeof getWeather>, { tempC: number }>>();
expectType<Equals<ContextParam<typeof getWeather>, unknown>>();
getWeather satisfies StandardToolV0<{ city: string }, { tempC: number }>;

// The WHY.md block: the interface alone, reusing both procedure schemas.
const getWeatherTyped: StandardToolV0<z.infer<typeof cityInput>, z.infer<typeof weatherOutput>> = {
  name: 'get_weather',
  description: 'Current temperature for a city',
  inputSchema: cityInput,
  outputSchema: weatherOutput,
  execute: caller.getWeather,
};

expectType<Equals<ExecOut<typeof getWeatherTyped>, { tempC: number }>>();
getWeatherTyped satisfies StandardToolV0<{ city: string }, { tempC: number }>;

test('the typed form reuses both procedure schemas and routes through the caller', async () => {
  assert.deepEqual(await getWeatherTyped.execute({ city: 'Paris' }), { tempC: 21 });
  const json = getWeatherTyped.outputSchema?.['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
  assert.deepEqual(json?.properties, { tempC: { type: 'number' } });
});

test('execute routes through the tRPC caller and returns the procedure result', async () => {
  assert.deepEqual(await getWeather.execute({ city: 'Paris' }), { tempC: 21 });
});

test('the reused schema emits JSON Schema for the model (no OpenAPI addon)', () => {
  const schema = getWeather.inputSchema;
  assert.ok(schema); // optional on the type; present here
  const json = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
  assert.equal(json.type, 'object');
  assert.deepEqual(json.required, ['city']);
  const props = json.properties as Record<string, { type?: string }> | undefined;
  assert.equal(props?.city?.type, 'string');
});

test('invalid input is rejected before the caller runs (standardTool validates input)', async () => {
  await assert.rejects(
    () => Promise.resolve(getWeather.execute({ city: 123 } as never)),
    (err: unknown) => err instanceof StandardToolValidationError && err.target === 'input'
  );
  // withFormattedOutput turns that throw into data.
  const asData = await withFormattedOutput(getWeather).execute({ city: 123 } as never);
  assert.ok('error' in (asData as object));
});

test('tRPC re-validates too — the raw caller rejects bad input independently', async () => {
  await assert.rejects(() => caller.getWeather({ city: 123 } as never));
});

test('name and description propagate to the descriptor', () => {
  assert.equal(getWeather.name, 'get_weather');
  assert.equal(getWeather.description, 'Current temperature for a city');
});

// Bare `execute: caller.getWeather` is equivalent: the caller method is single-arg and detachable.
test('bare `execute: caller.getWeather` behaves identically to the wrapped form', async () => {
  const bare = standardTool({
    name: 'get_weather',
    description: 'Current temperature for a city',
    inputSchema: cityInput,
    execute: caller.getWeather,
  });
  expectType<Equals<ExecOut<typeof bare>, { tempC: number }>>();
  expectType<Equals<ContextParam<typeof bare>, unknown>>(); // no Context pollution from the method
  assert.deepEqual(await bare.execute({ city: 'Paris' }), { tempC: 21 });
});

// Drift guard: the WHY.md example must still use the mechanism this test proves.
test('WHY.md "From procedures you already have" stays in sync with this test', () => {
  const why = readFileSync(fileURLToPath(new URL('../WHY.md', import.meta.url)), 'utf8');
  const heading = '## From procedures you already have';
  const start = why.indexOf(heading);
  assert.ok(start >= 0, 'WHY.md heading "From procedures you already have" not found');
  const fenceStart = why.indexOf('```ts', start);
  const fenceEnd = why.indexOf('```', fenceStart + 5);
  assert.ok(fenceStart >= 0 && fenceEnd > fenceStart, 'tRPC code block not found after the heading');
  const block = why.slice(fenceStart, fenceEnd);
  for (const needle of [
    'createCaller', // the caller comes from the existing router
    'inputSchema: cityInput', // the procedure's schema is reused as inputSchema
    'caller.getWeather', // execute routes through the caller
    'z.infer<typeof cityInput>', // generics derived from the schemas, not restated by hand
    'outputSchema: weatherOutput', // the procedure's .output() schema is reused too
  ]) {
    assert.ok(block.includes(needle), `WHY.md tRPC example no longer contains \`${needle}\``);
  }
});

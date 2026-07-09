import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { standardTool, withFormattedOutput, StandardToolValidationError, type StandardToolV0 } from '../dist/index.js';

// Proves the README "From procedures you already have." example: a tRPC procedure
// becomes a StandardTool by reusing its input schema and routing execute through a
// server-side caller. Verified against real @trpc/server (a devDependency only —
// the published package still has zero runtime dependencies).

// Compile-time helpers (checked by `npm run typecheck`), mirroring index.test.ts.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type ExecOut<T extends { execute: (input: never) => unknown }> = Awaited<ReturnType<T['execute']>>;
type MetaParam<T extends { execute: (input: never) => unknown }> = Parameters<T['execute']>[1];
const expectType = <_Pass extends true>(): void => {};

// ── The "existing tRPC app" the README imports as `./trpc`. In a real project
//    this lives in your tRPC module; inlined here so the test is self-contained.
const t = initTRPC.create();
const cityInput = z.object({ city: z.string() });
const appRouter = t.router({
  getWeather: t.procedure.input(cityInput).query(() => ({ tempC: 21 })),
});

// ── The README adapter, verbatim (keep in sync with the README block; the
//    drift-guard test at the bottom enforces the load-bearing lines).
const caller = appRouter.createCaller({}); // {} is the tRPC context
const getWeather = standardTool({
  name: 'get_weather',
  description: 'Current temperature for a city',
  inputSchema: cityInput,
  execute: (input) => caller.getWeather(input),
});

// No manual generics: standardTool infers Input, Output, and a clean (unknown) Meta.
expectType<Equals<ExecOut<typeof getWeather>, { tempC: number }>>();
expectType<Equals<MetaParam<typeof getWeather>, unknown>>();
getWeather satisfies StandardToolV0<{ city: string }, { tempC: number }>;

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
  // A consumer turns that throw into data for the model with withFormattedOutput.
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

// The README notes `execute: caller.getWeather` (bare) is equivalent for tRPC — the
// caller method is single-arg and detachable. Pinned here so that claim stays true.
test('bare `execute: caller.getWeather` behaves identically to the wrapped form', async () => {
  const bare = standardTool({
    name: 'get_weather',
    description: 'Current temperature for a city',
    inputSchema: cityInput,
    execute: caller.getWeather,
  });
  expectType<Equals<ExecOut<typeof bare>, { tempC: number }>>();
  expectType<Equals<MetaParam<typeof bare>, unknown>>(); // no Meta pollution from the method
  assert.deepEqual(await bare.execute({ city: 'Paris' }), { tempC: 21 });
});

// ── Drift guard: the README example must still use the mechanism this test proves.
test('README "From procedures you already have" stays in sync with this test', () => {
  const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
  const heading = '**From procedures you already have.**';
  const start = readme.indexOf(heading);
  assert.ok(start >= 0, 'README heading "From procedures you already have" not found');
  const fenceStart = readme.indexOf('```ts', start);
  const fenceEnd = readme.indexOf('```', fenceStart + 5);
  assert.ok(fenceStart >= 0 && fenceEnd > fenceStart, 'tRPC code block not found after the heading');
  const block = readme.slice(fenceStart, fenceEnd);
  for (const needle of [
    'createCaller', // the caller comes from the existing router
    'inputSchema: cityInput', // the procedure's schema is reused as inputSchema
    'caller.getWeather', // execute routes through the caller
    'standardTool({', // built via the reference builder, so types are inferred
  ]) {
    assert.ok(block.includes(needle), `README tRPC example no longer contains \`${needle}\``);
  }
});

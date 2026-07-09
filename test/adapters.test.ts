import test from 'node:test';
import assert from 'node:assert/strict';
import { initTRPC } from '@trpc/server';
import { createRouterClient, os } from '@orpc/server';
import { z } from 'zod';
import { type } from 'arktype';
import * as v from 'valibot';
import { toStandardJsonSchema } from '@valibot/to-json-schema';
import { standardTool, type StandardToolV0 } from '../dist/index.js';

// Extends trpc-example.test.ts beyond Zod + tRPC to the other schema libraries and RPC
// framework the README names: the "reuse the schema, route execute through a caller"
// recipe holds for ArkType and Valibot, and for oRPC. All are devDependencies only —
// the published package keeps zero runtime dependencies.

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type ExecOut<T extends { execute: (input: never) => unknown }> = Awaited<ReturnType<T['execute']>>;
const expectType = <_Pass extends true>(): void => {};

// Every library emits the same JSON Schema for the model — the point of Standard JSON Schema.
const assertCityJsonSchema = (json: { type?: unknown; required?: unknown }): void => {
  assert.equal(json.type, 'object');
  assert.deepEqual(json.required, ['city']);
};

test('ArkType: one schema reused for tRPC .input() and the tool inputSchema', async () => {
  const t = initTRPC.create();
  const cityInput = type({ city: 'string' });
  const appRouter = t.router({ getWeather: t.procedure.input(cityInput).query(() => ({ tempC: 21 })) });
  const caller = appRouter.createCaller({});

  const getWeather = standardTool({
    name: 'get_weather',
    description: 'Current temperature for a city',
    inputSchema: cityInput,
    execute: (input) => caller.getWeather(input),
  });

  expectType<Equals<ExecOut<typeof getWeather>, { tempC: number }>>();
  getWeather satisfies StandardToolV0<{ city: string }, { tempC: number }>;
  assert.deepEqual(await getWeather.execute({ city: 'Paris' }), { tempC: 21 });
  const schema = getWeather.inputSchema;
  assert.ok(schema);
  assertCityJsonSchema(schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }));
});

test('Valibot: one toStandardJsonSchema() wrapper serves both .input() and inputSchema', async () => {
  const t = initTRPC.create();
  // Valibot needs the wrapper to add Standard JSON Schema; the wrapped object still
  // validates (Standard Schema), so the one value works for .input() and inputSchema alike.
  const cityInput = toStandardJsonSchema(v.object({ city: v.string() }));
  const appRouter = t.router({ getWeather: t.procedure.input(cityInput).query(() => ({ tempC: 21 })) });
  const caller = appRouter.createCaller({});

  const getWeather = standardTool({
    name: 'get_weather',
    description: 'Current temperature for a city',
    inputSchema: cityInput,
    execute: (input) => caller.getWeather(input),
  });

  assert.deepEqual(await getWeather.execute({ city: 'Paris' }), { tempC: 21 });
  const schema = getWeather.inputSchema;
  assert.ok(schema);
  assertCityJsonSchema(schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }));
});

test('oRPC: createRouterClient gives the same reuse-the-schema, route-execute recipe', async () => {
  const cityInput = z.object({ city: z.string() });
  const router = { getWeather: os.input(cityInput).handler(() => ({ tempC: 21 })) };
  const client = createRouterClient(router, { context: {} });

  const getWeather = standardTool({
    name: 'get_weather',
    description: 'Current temperature for a city',
    inputSchema: cityInput,
    execute: (input) => client.getWeather(input),
  });

  expectType<Equals<ExecOut<typeof getWeather>, { tempC: number }>>();
  getWeather satisfies StandardToolV0<{ city: string }, { tempC: number }>;
  assert.deepEqual(await getWeather.execute({ city: 'Paris' }), { tempC: 21 });
});

test('a no-input procedure becomes a tool whose execute() needs no argument', async () => {
  const t = initTRPC.create();
  const appRouter = t.router({ now: t.procedure.query(() => ({ iso: '2026-01-01T00:00:00Z' })) });
  const caller = appRouter.createCaller({});

  const now = standardTool({
    name: 'now',
    description: 'current timestamp',
    execute: () => caller.now(),
  });

  expectType<Equals<ExecOut<typeof now>, { iso: string }>>();
  assert.equal(now.inputSchema, undefined);
  // no inputSchema + a no-arg handler → Input is void, so execute() takes no argument…
  assert.deepEqual(await now.execute(), { iso: '2026-01-01T00:00:00Z' });
  // …and undefined is still accepted.
  assert.deepEqual(await now.execute(undefined), { iso: '2026-01-01T00:00:00Z' });

  // Contrast: a tool with a schema keeps a required argument (not void).
  const typed = standardTool({
    name: 'typed',
    description: 'd',
    inputSchema: z.object({ x: z.number() }),
    execute: () => 1,
  });
  expectType<Equals<Parameters<typeof typed.execute>[0], { x: number }>>();
});

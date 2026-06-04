import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { standardTool, StandardToolValidationError, type StandardTool } from '../dist/index.js';

// Compile-time type assertions (checked by `npm run typecheck`). expectType<T> accepts
// only `true`, so a wrong type fails to compile. ExecOut<T> = the awaited execute() return;
// RawOut<T> = the awaited executeRaw() return.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type ExecOut<T extends { execute: (input: never) => unknown }> = Awaited<ReturnType<T['execute']>>;
type RawOut<T extends { executeRaw: (input: never) => unknown }> = Awaited<ReturnType<T['executeRaw']>>;
const expectType = <_Pass extends true>(): void => {};

// Real Zod schemas (Zod 4.2+ implements both Standard Schema and Standard JSON Schema).
const inputSchema = z.object({ city: z.string() });
const outputSchema = z.object({ tempC: z.number() });

// A neutral tool: execute validates in & out and returns the raw Output, throwing on a violation.
const weather = standardTool({
  name: 'get_weather',
  description: 'Current temperature for a city',
  inputSchema,
  outputSchema,
  execute: async () => ({ tempC: 21 }),
});
// Neutral form: FormattedOutput defaults to Output, so execute returns the raw Output (no envelope).
expectType<Equals<ExecOut<typeof weather>, { tempC: number }>>();
expectType<Equals<RawOut<typeof weather>, { tempC: number }>>();
weather satisfies StandardTool<{ city: string }, { tempC: number }>;
weather satisfies StandardTool<{ city: string }, { tempC: number }, { tempC: number }>;

// No schemas → Input/Output inferred from execute; still neutral.
const echo = standardTool({
  name: 'echo',
  description: 'adds one',
  execute: (input: { x: number }) => ({ y: input.x + 1 }),
});
expectType<Equals<ExecOut<typeof echo>, { y: number }>>();
echo satisfies StandardTool<{ x: number }, { y: number }>;

// .formatted() with no formatter → the default { error } envelope.
const weatherEnvelope = weather.formatted();
expectType<Equals<ExecOut<typeof weatherEnvelope>, { tempC: number } | { error: string }>>();
weatherEnvelope satisfies StandardTool<{ city: string }, { tempC: number }, { tempC: number } | { error: string }>;

// .formatted(fmt) swaps only the 3rd generic; the raw Output is unchanged and still reachable.
const toStr = (r: { tempC: number } | Error): string => (r instanceof Error ? `error: ${r.message}` : `ok: ${r.tempC}`);
const weatherStr = weather.formatted(toStr);
expectType<Equals<ExecOut<typeof weatherStr>, string>>();
expectType<Equals<RawOut<typeof weatherStr>, { tempC: number }>>();
weatherStr satisfies StandardTool<{ city: string }, { tempC: number }, string>;

// async formatter is awaited.
const weatherAsync = weather.formatted(async (r) => ({ status: r instanceof Error ? r.message : 'ok' }));
expectType<Equals<ExecOut<typeof weatherAsync>, { status: string }>>();

// per-call meta, narrowed to `{ locale: string }` on the handler (`execute` is a method, so params are
// bivariant); reading `meta.locale` compiles only because TS keeps that annotation instead of `unknown`.
const greet = standardTool({
  name: 'greet',
  description: 'greets a person in the caller-supplied locale',
  inputSchema: z.object({ name: z.string() }),
  execute: ({ name }, meta: { locale: string }) => (meta.locale === 'fr' ? `bonjour ${name}` : `hi ${name}`),
});
expectType<Equals<ExecOut<typeof greet>, string>>();

// The MCP text-only formatter recipe from the README, verified here.
type McpToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};
const toMcpResult = (result: unknown): McpToolResult => {
  if (result instanceof Error) {
    return { content: [{ type: 'text', text: result.message }], isError: true };
  }
  if (typeof result === 'string') {
    return { content: [{ type: 'text', text: result }] };
  }
  const text = JSON.stringify(result);
  if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
    return { content: [{ type: 'text', text }], structuredContent: result as Record<string, unknown> };
  }
  return { content: [{ type: 'text', text }] };
};
const mcpWeather = weather.formatted(toMcpResult);
expectType<Equals<ExecOut<typeof mcpWeather>, McpToolResult>>();
expectType<Equals<RawOut<typeof mcpWeather>, { tempC: number }>>();

// Re-formatting replaces, it does not compose: the 3rd generic is the latest formatter's output.
const reformatted = weather.formatted(toMcpResult).formatted(toStr);
expectType<Equals<ExecOut<typeof reformatted>, string>>();

// Runtime behavior. Error assertions check standardTool's prefix and the Standard
// Schema issue path, not Zod's wording, so they hold across Zod versions.

test('FormattableStandardTool exposes the neutral shape plus executeRaw + formatted', () => {
  // weather declares no title, so the optional key is absent (not set to undefined).
  assert.deepEqual(Object.keys(weather).sort(), [
    'description',
    'execute',
    'executeRaw',
    'formatted',
    'inputSchema',
    'name',
    'outputSchema',
  ]);
  // A FormattableStandardTool still IS a StandardTool — the extra members are additive.
  weather satisfies StandardTool<{ city: string }, { tempC: number }>;
});

test('executeRaw is the bare handler, distinct from the validating execute', () => {
  assert.notEqual(weather.execute, weather.executeRaw);
});

test('passes the optional title through (omitted, not set to undefined, when absent)', () => {
  assert.equal(weather.title, undefined);
  assert.equal('title' in weather, false); // absent, not a `title: undefined` key
  const titled = standardTool({ name: 'titled', title: 'Titled Tool', description: 'd', execute: () => 1 });
  assert.equal(titled.title, 'Titled Tool');
});

test('neutral execute returns the validated value on success', async () => {
  assert.deepEqual(await weather.execute({ city: 'Paris' }), { tempC: 21 });
});

test('exposes JSON Schema via Standard JSON Schema', () => {
  const { inputSchema: schema } = weather;
  assert.ok(schema); // optional on the type; present here
  const json = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
  assert.equal(json.type, 'object');
  assert.deepEqual(json.required, ['city']);
});

test('neutral execute throws StandardToolValidationError on invalid input', async () => {
  await assert.rejects(
    () => Promise.resolve(weather.execute({ city: 123 } as unknown as { city: string })),
    (err: unknown) => {
      assert.ok(err instanceof StandardToolValidationError);
      assert.equal(err.target, 'input');
      assert.match(err.message, /^input validation failed:/);
      assert.deepEqual(err.issues[0].path, ['city']);
      return true;
    }
  );
});

test('neutral execute throws StandardToolValidationError on invalid output', async () => {
  const bad = standardTool({
    name: 'bad',
    description: 'wrong shape',
    inputSchema,
    outputSchema,
    execute: async () => ({ tempC: 'hot' }) as unknown as { tempC: number },
  });
  await assert.rejects(
    () => Promise.resolve(bad.execute({ city: 'Paris' })),
    (err: unknown) => {
      assert.ok(err instanceof StandardToolValidationError);
      assert.equal(err.target, 'output');
      return true;
    }
  );
});

test('executeRaw skips input and output validation (execute does both)', async () => {
  const bad = standardTool({
    name: 'bad',
    description: 'returns the wrong shape',
    inputSchema,
    outputSchema,
    execute: async () => ({ tempC: 'hot' }) as unknown as { tempC: number },
  });
  // execute validates the output → throws.
  await assert.rejects(() => Promise.resolve(bad.execute({ city: 'Paris' })), StandardToolValidationError);
  // executeRaw runs the handler verbatim → no throw, returns the unvalidated value (input validation skipped too).
  assert.deepEqual(await bad.executeRaw({ city: 123 } as unknown as { city: string }), { tempC: 'hot' });
});

test('neutral execute rethrows what the handler threw (not wrapped)', async () => {
  const boom = standardTool({
    name: 'boom',
    description: 'throws',
    inputSchema,
    outputSchema,
    execute: async () => {
      throw new Error('kaboom');
    },
  });
  await assert.rejects(
    () => Promise.resolve(boom.execute({ city: 'Paris' })),
    (err: unknown) => {
      assert.ok(err instanceof Error && !(err instanceof StandardToolValidationError));
      assert.equal(err.message, 'kaboom');
      return true;
    }
  );
});

test('optional schemas: validation skipped when omitted', async () => {
  assert.equal(echo.inputSchema, undefined);
  assert.equal(echo.outputSchema, undefined);
  assert.deepEqual(await echo.execute({ x: 1 }), { y: 2 });
});

test('forwards the per-call meta argument verbatim to the handler', async () => {
  assert.equal(await greet.execute({ name: 'Ada' }, { locale: 'en' }), 'hi Ada');
  // meta still reaches the handler after formatting, and through the bare handler.
  assert.equal(await greet.formatted().execute({ name: 'Bob' }, { locale: 'fr' }), 'bonjour Bob');
  assert.equal(await greet.executeRaw({ name: 'Cy' }, { locale: 'fr' }), 'bonjour Cy');
});

test('default generics: bare StandardTool needs no type args and holds heterogeneous tools', () => {
  const toolArray: StandardTool[] = [weather, echo, greet, weatherStr];
  assert.equal(toolArray.length, 4);
});

test('supports async validators', async () => {
  const finiteNumber = z.number().refine(async (n) => Number.isFinite(n), 'must be finite');
  const double = standardTool({
    name: 'double',
    description: 'doubles a number',
    inputSchema: finiteNumber,
    outputSchema: finiteNumber,
    execute: async (n) => n * 2,
  });
  expectType<Equals<ExecOut<typeof double>, number>>();
  assert.equal(await double.execute(21), 42);
});

test('.formatted() with no formatter: success → Output, failure → { error } (no throw)', async () => {
  const t = weather.formatted();
  assert.deepEqual(await t.execute({ city: 'Paris' }), { tempC: 21 });
  const out = await t.execute({ city: 123 } as unknown as { city: string });
  assert.deepEqual(Object.keys(out), ['error']);
  assert.match((out as { error: string }).error, /^input validation failed:/);
});

test('.formatted(fmt) reshapes the result; failures are passed to the formatter, not thrown', async () => {
  assert.equal(await weatherStr.execute({ city: 'Paris' }), 'ok: 21');
  assert.match(
    await weatherStr.execute({ city: 123 } as unknown as { city: string }),
    /^error: input validation failed:/
  );
});

test('async formatter is awaited', async () => {
  assert.deepEqual(await weatherAsync.execute({ city: 'Paris' }), { status: 'ok' });
  const out = await weatherAsync.execute({ city: 123 } as unknown as { city: string });
  assert.match(out.status, /^input validation failed:/);
});

test('executeRaw stays the bare, unvalidated handler even after formatting', async () => {
  // formatted() changes execute (→ MCP envelope), but executeRaw is still the raw handler.
  assert.deepEqual(await mcpWeather.execute({ city: 'Paris' }), {
    content: [{ type: 'text', text: '{"tempC":21}' }],
    structuredContent: { tempC: 21 },
  });
  assert.deepEqual(await mcpWeather.executeRaw({ city: 'Paris' }), { tempC: 21 });
  // no validation: bad input does not throw — the handler just runs.
  assert.deepEqual(await mcpWeather.executeRaw({ city: 123 } as unknown as { city: string }), { tempC: 21 });
});

test('re-formatting replaces and re-derives from the validated execute, never the previous formatting', async () => {
  // Format to MCP, then to string. The string formatter sees { tempC }, NOT the MCP envelope.
  const out = await weather.formatted(toMcpResult).formatted(toStr).execute({ city: 'Paris' });
  assert.equal(out, 'ok: 21'); // 'ok: 21' (from the validated Output), not 'ok: undefined' (a composed envelope)
});

test('the headline case: a framework ships a pre-formatted tool, a consumer re-targets it', async () => {
  // A framework hands out an MCP-shaped tool.
  const shipped = weather.formatted(toMcpResult);
  assert.equal((await shipped.execute({ city: 'Paris' })).content[0].text, '{"tempC":21}');
  // The consumer re-formats it for a different consumer — derived from the validated Output, not the MCP shape.
  const retargeted = shipped.formatted(toStr);
  assert.equal(await retargeted.execute({ city: 'Paris' }), 'ok: 21');
  // …or just runs the bare, unvalidated handler.
  assert.deepEqual(await shipped.executeRaw({ city: 'Paris' }), { tempC: 21 });
});

test('MCP formatter: object output → JSON text block + structuredContent', async () => {
  assert.deepEqual(await weather.formatted(toMcpResult).execute({ city: 'Paris' }), {
    content: [{ type: 'text', text: '{"tempC":21}' }],
    structuredContent: { tempC: 21 },
  });
});

test('MCP formatter: validation error → text block + isError (no structuredContent)', async () => {
  const out = await weather.formatted(toMcpResult).execute({ city: 123 } as unknown as { city: string });
  assert.equal(out.isError, true);
  assert.equal(out.content[0].type, 'text');
  assert.match(out.content[0].text, /^input validation failed:/);
  assert.equal('structuredContent' in out, false);
});

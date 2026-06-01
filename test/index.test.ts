import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { standardTool, type StandardTool, type FormatOutputFn } from '../dist/index.js';

// ---------------------------------------------------------------------------
// Compile-time exact-type assertions, enforced by `npm run typecheck`
// (tsconfig.test.json, run in CI via `npm test`). `expectType<…>()` accepts only
// `true`, so a wrong type fails to compile. `ExecOut<T>` is what
// `await tool.execute(...)` yields — the 3rd generic (the formatted output).
// ---------------------------------------------------------------------------
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type ExecOut<T extends { execute: (input: never) => unknown }> = Awaited<ReturnType<T['execute']>>;
const expectType = <_Pass extends true>(): void => {};

// Real Zod schemas — Zod 4.2+ implements both Standard Schema (validation) and
// Standard JSON Schema (`~standard.jsonSchema`), so it plugs into standardTool as-is.
const inputSchema = z.object({ city: z.string() });
const outputSchema = z.object({ tempC: z.number() });

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
expectType<Equals<ExecOut<typeof weather>, { tempC: number } | { error: string }>>();
weather satisfies StandardTool<{ city: string }, { tempC: number }>;
weather satisfies StandardTool<{ city: string }, { tempC: number }, { tempC: number } | { error: string }>;

// (2) default formatOutput, no schemas → Input/Output inferred from execute; FormattedOutput = Output | { error }
const echo = standardTool({
  name: 'echo',
  description: 'adds one',
  execute: (input: { x: number }) => ({ y: input.x + 1 }),
});
expectType<Equals<ExecOut<typeof echo>, { y: number } | { error: string }>>();
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
expectType<Equals<ExecOut<typeof stringFmt>, string>>();
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
expectType<Equals<ExecOut<typeof asyncFmt>, { status: string }>>();
expectType<Equals<ReturnType<typeof asyncFmt.execute>, { status: string } | Promise<{ status: string }>>>();

// (5) passthrough formatOutput returning the raw result → FormattedOutput = Output | Error
const passthrough = standardTool({
  name: 'passthrough',
  description: 'returns the raw result/error',
  inputSchema,
  outputSchema,
  formatOutput: (result) => result,
  execute: async () => ({ tempC: 1 }),
});
expectType<Equals<ExecOut<typeof passthrough>, { tempC: number } | Error>>();

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
expectType<Equals<ExecOut<typeof strict>, { tempC: number }>>();

// (7) per-call `meta` — forwarded verbatim to the handler, which annotates its own type.
// No outputSchema + default formatOutput → FormattedOutput = Output | { error }.
const greet = standardTool({
  name: 'greet',
  description: 'greets with per-call punctuation',
  inputSchema: z.object({ name: z.string() }),
  execute: ({ name }, meta: { punct: string }) => `hi ${name}${meta.punct}`,
});
expectType<Equals<ExecOut<typeof greet>, string | { error: string }>>();

// (8) MCP text-only formatter — the README "With an MCP server" recipe, verified end to end.
// Output | Error → MCP CallToolResult: object → JSON text + structuredContent; string → text; error → text + isError.
type McpToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};
const toMcpResult: FormatOutputFn<unknown, McpToolResult> = (result) => {
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
const mcpWeather = standardTool({
  name: 'get_weather',
  description: 'Current temperature for a city',
  inputSchema,
  outputSchema,
  formatOutput: toMcpResult,
  execute: async () => ({ tempC: 21 }),
});
expectType<Equals<ExecOut<typeof mcpWeather>, McpToolResult>>();

// ---------------------------------------------------------------------------
// Runtime behavior. Error assertions check standardTool's own prefix
// (`input/output validation failed:`) and the Standard Schema issue `path`,
// not Zod's exact wording — robust across Zod versions.
// ---------------------------------------------------------------------------

test('exposes exactly name, title, description, inputSchema, outputSchema, execute (no formatOutput member)', () => {
  assert.deepEqual(Object.keys(weather).sort(), [
    'description',
    'execute',
    'inputSchema',
    'name',
    'outputSchema',
    'title',
  ]);
});

test('passes the optional title through (undefined when omitted)', () => {
  assert.equal(weather.title, undefined); // weather declares no title
  const titled = standardTool({ name: 'titled', title: 'Titled Tool', description: 'd', execute: () => 1 });
  assert.equal(titled.title, 'Titled Tool');
});

test('default formatOutput returns the validated value on success', async () => {
  assert.deepEqual(await weather.execute({ city: 'Paris' }), { tempC: 21 });
});

test('exposes JSON Schema via Standard JSON Schema', () => {
  const { inputSchema: schema } = weather;
  assert.ok(schema); // optional on the type; present here
  const json = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
  assert.equal(json.type, 'object');
  assert.deepEqual(json.required, ['city']);
});

test('default formatOutput: invalid input → { error } envelope (no throw)', async () => {
  const out = await weather.execute({ city: 123 } as unknown as { city: string });
  assert.deepEqual(Object.keys(out), ['error']);
  assert.match((out as { error: string }).error, /^input validation failed:/);
});

test('default formatOutput: invalid output → { error } envelope (no throw)', async () => {
  const bad = standardTool({
    name: 'bad',
    description: 'wrong shape',
    inputSchema,
    outputSchema,
    execute: async () => ({ tempC: 'hot' }) as unknown as { tempC: number },
  });
  const out = await bad.execute({ city: 'Paris' });
  assert.deepEqual(Object.keys(out), ['error']);
  assert.match((out as { error: string }).error, /^output validation failed:/);
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
  assert.match(
    await stringFmt.execute({ city: 123 } as unknown as { city: string }),
    /^error: input validation failed:/
  );
});

test('async custom formatOutput is awaited', async () => {
  assert.deepEqual(await asyncFmt.execute({ city: 'Paris' }), { status: 'ok' });
  const out = await asyncFmt.execute({ city: 123 } as unknown as { city: string });
  assert.match(out.status, /^input validation failed:/);
});

test('passthrough formatOutput exposes the raw Error carrying issues', async () => {
  assert.deepEqual(await passthrough.execute({ city: 'Paris' }), { tempC: 1 });
  const err = await passthrough.execute({ city: 123 } as unknown as { city: string });
  assert.ok(err instanceof Error);
  assert.match(err.message, /^input validation failed:/);
  const issues = (err as Error & { issues: { path?: PropertyKey[] }[] }).issues;
  assert.ok(Array.isArray(issues) && issues.length > 0);
  assert.deepEqual(issues[0].path, ['city']);
});

test('throwing formatOutput restores throwing (escape hatch)', async () => {
  assert.deepEqual(await strict.execute({ city: 'Paris' }), { tempC: 1 });
  await assert.rejects(
    () => Promise.resolve(strict.execute({ city: 123 } as unknown as { city: string })),
    /input validation failed:/
  );
});

test('forwards the per-call meta argument verbatim to the handler', async () => {
  assert.equal(await greet.execute({ name: 'Ada' }, { punct: '!' }), 'hi Ada!');
  assert.equal(await greet.execute({ name: 'Bob' }, { punct: '?' }), 'hi Bob?');
});

test('default generics: bare StandardTool needs no type args and holds heterogeneous tools', () => {
  // Input/Output default to `unknown`, so `StandardTool[]` requires no args; execute is a
  // method (bivariant), so specific tools assign in. This is the README OpenAI-loop case.
  const toolArray: StandardTool[] = [weather, echo, stringFmt, greet];
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
  expectType<Equals<ExecOut<typeof double>, number | { error: string }>>();
  assert.equal(await double.execute(21), 42);
});

test('MCP formatter: object output → JSON text block + structuredContent', async () => {
  assert.deepEqual(await mcpWeather.execute({ city: 'Paris' }), {
    content: [{ type: 'text', text: '{"tempC":21}' }],
    structuredContent: { tempC: 21 },
  });
});

test('MCP formatter: validation error → text block + isError (no structuredContent)', async () => {
  const out = await mcpWeather.execute({ city: 123 } as unknown as { city: string });
  assert.equal(out.isError, true);
  assert.equal(out.content[0].type, 'text');
  assert.match(out.content[0].text, /^input validation failed:/);
  assert.equal('structuredContent' in out, false);
});

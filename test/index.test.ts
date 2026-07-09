import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { standardTool, withFormattedOutput, StandardToolValidationError, type StandardToolV0 } from '../dist/index.js';

// Compile-time type assertions (checked by `npm run typecheck`). expectType<T> accepts
// only `true`, so a wrong type fails to compile. ExecOut<T> = the awaited execute() return;
// MetaParam<T> = execute()'s meta parameter type.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type ExecOut<T extends { execute: (input: never) => unknown }> = Awaited<ReturnType<T['execute']>>;
type MetaParam<T extends { execute: (input: never) => unknown }> = Parameters<T['execute']>[1];
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
weather satisfies StandardToolV0<{ city: string }, { tempC: number }>;
weather satisfies StandardToolV0<{ city: string }, { tempC: number }, { tempC: number }>;

// No schemas → Input/Output inferred from execute; still neutral.
const echo = standardTool({
  name: 'echo',
  description: 'adds one',
  execute: (input: { x: number }) => ({ y: input.x + 1 }),
});
expectType<Equals<ExecOut<typeof echo>, { y: number }>>();
echo satisfies StandardToolV0<{ x: number }, { y: number }>;

// withFormattedOutput() with no formatter → the default { error } envelope.
const weatherEnvelope = withFormattedOutput(weather);
expectType<Equals<ExecOut<typeof weatherEnvelope>, { tempC: number } | { error: string }>>();
weatherEnvelope satisfies StandardToolV0<{ city: string }, { tempC: number }, { tempC: number } | { error: string }>;

// withFormattedOutput(tool, fmt) swaps only the 3rd generic; the underlying Output is unchanged.
const toStr = (r: { tempC: number } | Error): string => (r instanceof Error ? `error: ${r.message}` : `ok: ${r.tempC}`);
const weatherStr = withFormattedOutput(weather, toStr);
expectType<Equals<ExecOut<typeof weatherStr>, string>>();
weatherStr satisfies StandardToolV0<{ city: string }, { tempC: number }, string>;

// async formatter is awaited.
const weatherAsync = withFormattedOutput(weather, async (r) => ({ status: r instanceof Error ? r.message : 'ok' }));
expectType<Equals<ExecOut<typeof weatherAsync>, { status: string }>>();

// Only neutral tools (FormattedOutput = Output) are accepted: re-formatting an already-formatted tool is a type error.
// @ts-expect-error weatherStr's execute returns string, not its Output { tempC: number }
withFormattedOutput(weatherStr, toStr);
// @ts-expect-error the default { error } envelope is already formatted — a bare double wrap is rejected too
withFormattedOutput(withFormattedOutput(weather));
// @ts-expect-error an enveloped tool cannot be re-wrapped with a new formatter either
withFormattedOutput(withFormattedOutput(weather), toStr);

// An explicit FormattedOutput without a formatter cannot fabricate a type: the no-format
// overload has no FormattedOutput slot, so the result is still honestly Output | { error: string }.
const fabricated = withFormattedOutput<{ city: string }, { tempC: number }, string>(weather);
expectType<Equals<ExecOut<typeof fabricated>, { tempC: number } | { error: string }>>();

// per-call meta: annotating it on the handler sets the tool's `Meta` generic, which propagates to every caller.
const greet = standardTool({
  name: 'greet',
  description: 'greets a person in the caller-supplied locale',
  inputSchema: z.object({ name: z.string() }),
  execute: ({ name }, meta: { locale: string }) => (meta.locale === 'fr' ? `bonjour ${name}` : `hi ${name}`),
});
expectType<Equals<ExecOut<typeof greet>, string>>();
// Meta propagated from the handler annotation to the call site (optional param → `| undefined`).
expectType<Equals<MetaParam<typeof greet>, { locale: string } | undefined>>();
// A tool that ignores meta leaves Meta at its `unknown` default.
expectType<Equals<MetaParam<typeof weather>, unknown>>();

// No inputSchema → Input infers from the handler; a parameterless handler leaves it unknown.
const now = standardTool({
  name: 'now',
  description: 'current timestamp',
  execute: () => ({ iso: '2026-01-01T00:00:00Z' }),
});
expectType<Equals<ExecOut<typeof now>, { iso: string }>>();
now satisfies StandardToolV0<unknown, { iso: string }>;

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
const mcpWeather = withFormattedOutput(weather, toMcpResult);
expectType<Equals<ExecOut<typeof mcpWeather>, McpToolResult>>();

// Runtime behavior. Error assertions check standardTool's prefix and the Standard
// Schema issue path, not Zod's wording, so they hold across Zod versions.

test('a built StandardTool exposes exactly the neutral shape', () => {
  // weather declares no title, so the optional key is absent (not set to undefined).
  assert.deepEqual(Object.keys(weather).sort(), ['description', 'execute', 'inputSchema', 'name', 'outputSchema']);
  // A built tool satisfies StandardToolV0 — nothing beyond the normative fields.
  weather satisfies StandardToolV0<{ city: string }, { tempC: number }>;
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
      assert.match(err.message, /city: /); // the failing field's path is inlined into the message
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

test('no inputSchema: input passes through unvalidated', async () => {
  assert.deepEqual(await now.execute(undefined), { iso: '2026-01-01T00:00:00Z' });
  assert.deepEqual(await withFormattedOutput(now).execute(undefined), { iso: '2026-01-01T00:00:00Z' });
});

test('forwards the per-call meta argument verbatim to the handler', async () => {
  assert.equal(await greet.execute({ name: 'Ada' }, { locale: 'en' }), 'hi Ada');
  // meta still reaches the handler after formatting.
  assert.equal(await withFormattedOutput(greet).execute({ name: 'Bob' }, { locale: 'fr' }), 'bonjour Bob');
});

test('default generics: bare StandardTool needs no type args and holds heterogeneous tools', () => {
  const toolArray: StandardToolV0[] = [weather, echo, greet, weatherStr];
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

test('withFormattedOutput() with no formatter: success → Output, failure → { error } (no throw)', async () => {
  const t = withFormattedOutput(weather);
  assert.deepEqual(await t.execute({ city: 'Paris' }), { tempC: 21 });
  const out = await t.execute({ city: 123 } as unknown as { city: string });
  assert.deepEqual(Object.keys(out), ['error']);
  assert.match((out as { error: string }).error, /^input validation failed:/);
});

test('withFormattedOutput(tool, fmt) reshapes the result; failures are passed to the formatter, not thrown', async () => {
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

test('the formatter runs exactly once; what it throws propagates unformatted', async () => {
  let calls = 0;
  const rethrowing = withFormattedOutput(weather, (r) => {
    calls++;
    if (!(r instanceof Error)) throw new Error('formatter rejected the success value');
    return `formatted: ${r.message}`;
  });
  await assert.rejects(
    () => Promise.resolve(rethrowing.execute({ city: 'Paris' })),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, 'formatter rejected the success value');
      return true;
    }
  );
  assert.equal(calls, 1); // never re-invoked with its own error
});

test('an async formatter rejection propagates the same as a sync throw', async () => {
  const rejecting = withFormattedOutput(weather, async (r) => {
    if (!(r instanceof Error)) throw new Error('async formatter rejected');
    return 'never';
  });
  await assert.rejects(() => Promise.resolve(rejecting.execute({ city: 'Paris' })), /async formatter rejected/);
});

test('a formatter can rethrow errors it does not want to turn into data', async () => {
  const boom = standardTool({
    name: 'boom',
    description: 'throws an infra error',
    inputSchema,
    execute: async (): Promise<{ tempC: number }> => {
      throw new Error('ECONNREFUSED');
    },
  });
  const onlyValidationAsData = withFormattedOutput(boom, (r) => {
    if (r instanceof StandardToolValidationError) return { error: r.message };
    if (r instanceof Error) throw r; // infra errors are the app's problem, not the model's
    return r;
  });
  // validation failure → data for the model
  const out = await onlyValidationAsData.execute({ city: 123 } as unknown as { city: string });
  assert.match((out as { error: string }).error, /^input validation failed:/);
  // infra failure → propagates to the app
  await assert.rejects(() => Promise.resolve(onlyValidationAsData.execute({ city: 'Paris' })), /ECONNREFUSED/);
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

test('the headline case: one neutral tool, each consumer formats at its own boundary', async () => {
  // The same shipped tool re-targeted independently — neither formatting affects the other.
  assert.equal((await mcpWeather.execute({ city: 'Paris' })).content[0].text, '{"tempC":21}');
  assert.equal(await withFormattedOutput(weather, toStr).execute({ city: 'Paris' }), 'ok: 21');
  // The original stays neutral.
  assert.deepEqual(await weather.execute({ city: 'Paris' }), { tempC: 21 });
});

test('method-style execute keeps `this` bound to the definition', async () => {
  const selfNamed = standardTool({
    name: 'self',
    description: 'reads this.name',
    execute(input: string) {
      return `${this.name}: ${input}`;
    },
  });
  assert.equal(await selfNamed.execute('hi'), 'self: hi');
  assert.equal(await withFormattedOutput(selfNamed).execute('hi'), 'self: hi');
});

test('execute returns the validated values, not the raw ones', async () => {
  let received: unknown;
  const strict = standardTool({
    name: 'strict',
    description: 'echoes through schemas',
    inputSchema,
    outputSchema,
    execute: async (input) => {
      received = input;
      return { tempC: 21, extra: 'junk' } as unknown as { tempC: number };
    },
  });
  // Zod strips unknown keys, so both sides prove substitution: the handler sees the
  // validated input, the caller sees the validated output.
  const out = await strict.execute({ city: 'Paris', junk: 1 } as unknown as { city: string });
  assert.deepEqual(received, { city: 'Paris' });
  assert.deepEqual(out, { tempC: 21 });
});

test('validation-error messages render nested and {key} path segments and join multiple issues', async () => {
  const failing = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: () => ({
        issues: [
          { message: 'bad leaf', path: ['a', { key: 'b' }, 0] },
          { message: 'top-level' }, // no path
        ],
      }),
    },
  } as unknown as NonNullable<StandardToolV0<{ a: string }>['inputSchema']>;
  const t = standardTool({ name: 'paths', description: 'd', inputSchema: failing, execute: () => 'never' });
  await assert.rejects(
    () => Promise.resolve(t.execute({ a: 'x' })),
    (err: unknown) => {
      assert.ok(err instanceof StandardToolValidationError);
      assert.equal(err.name, 'StandardToolValidationError');
      assert.equal(err.message, 'input validation failed: a.b.0: bad leaf; top-level');
      return true;
    }
  );
});

test('output validation failure becomes { error } data through withFormattedOutput', async () => {
  const bad = standardTool({
    name: 'bad',
    description: 'wrong shape',
    inputSchema,
    outputSchema,
    execute: async () => ({ tempC: 'hot' }) as unknown as { tempC: number },
  });
  const out = await withFormattedOutput(bad).execute({ city: 'Paris' });
  assert.match((out as { error: string }).error, /^output validation failed:/);
});

test('a handler throw becomes { error } through the default envelope', async () => {
  const boom = standardTool({
    name: 'boom',
    description: 'throws an infra error',
    execute: (): number => {
      throw new Error('ECONNREFUSED');
    },
  });
  assert.deepEqual(await withFormattedOutput(boom).execute(undefined), { error: 'ECONNREFUSED' });
});

test('non-Error throws are normalized to an Error carrying the original on `cause`', async () => {
  const throwsString = standardTool({
    name: 't',
    description: 'd',
    execute: (): number => {
      throw 'plain string';
    },
  });
  assert.deepEqual(await withFormattedOutput(throwsString).execute(undefined), { error: 'plain string' });

  const payload = { code: 42, message: 'object-err' };
  const throwsObject = standardTool({
    name: 't',
    description: 'd',
    execute: (): number => {
      throw payload;
    },
  });
  const causes: unknown[] = [];
  const out = await withFormattedOutput(throwsObject, (r) => {
    if (r instanceof Error) {
      causes.push(r.cause);
      return { error: r.message };
    }
    return r;
  }).execute(undefined);
  assert.deepEqual(out, { error: '[object Object]' }); // String(payload); the payload itself lives on cause
  assert.equal(causes[0], payload);
});

test('async validator failure throws, and becomes data through withFormattedOutput', async () => {
  const finiteNumber = z.number().refine(async (n) => Number.isFinite(n), 'must be finite');
  const double = standardTool({
    name: 'double',
    description: 'doubles a number',
    inputSchema: finiteNumber,
    execute: async (n) => n * 2,
  });
  await assert.rejects(
    () => Promise.resolve(double.execute(Number.POSITIVE_INFINITY)),
    (err: unknown) => err instanceof StandardToolValidationError && err.target === 'input'
  );
  const out = await withFormattedOutput(double).execute(Number.POSITIVE_INFINITY);
  assert.match((out as { error: string }).error, /^input validation failed:/);
});

test('withFormattedOutput preserves every field by identity; only execute is replaced', () => {
  const wrapped = withFormattedOutput(weather);
  assert.equal(wrapped.name, weather.name);
  assert.equal(wrapped.description, weather.description);
  assert.equal(wrapped.inputSchema, weather.inputSchema);
  assert.equal(wrapped.outputSchema, weather.outputSchema);
  assert.notEqual(wrapped.execute, weather.execute);
});

test('meta is forwarded by identity, through the builder and the envelope alike', async () => {
  let seen: unknown;
  const spy = standardTool({
    name: 'spy',
    description: 'records meta',
    execute: (_input: unknown, meta?: { k: number }) => {
      seen = meta;
      return 0;
    },
  });
  const m = { k: 1 };
  await spy.execute(undefined, m);
  assert.equal(seen, m); // same reference, not a copy
  await withFormattedOutput(spy).execute(undefined, m);
  assert.equal(seen, m);
});

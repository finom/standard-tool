import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import { z } from 'zod';
import { StandardToolValidationError, standardTool, withFormattedOutput } from '../dist/index.js';

// Property-based tests over the validation boundary: whatever the schema accepts, `execute` accepts.
const inputSchema = z.object({ city: z.string(), days: z.number().int().min(1).max(14) });
const outputSchema = z.object({ tempC: z.number() });

const forecast = standardTool({
  name: 'forecast',
  description: 'Forecast for a city',
  inputSchema,
  outputSchema,
  execute: ({ days }) => ({ tempC: days }),
});

const isInputError = (e: unknown) => e instanceof StandardToolValidationError && e.target === 'input';
const isOutputError = (e: unknown) => e instanceof StandardToolValidationError && e.target === 'output';

test('passes through every input the schema accepts', async () => {
  await fc.assert(
    fc.asyncProperty(fc.string(), fc.integer({ min: 1, max: 14 }), async (city, days) => {
      assert.deepEqual(await forecast.execute({ city, days }), { tempC: days });
    })
  );
});

test('rejects every input the schema rejects', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.anything().filter((v) => !inputSchema.safeParse(v).success),
      async (input) => {
        await assert.rejects(async () => await forecast.execute(input as never), isInputError);
      }
    )
  );
});

test('rejects every handler result the output schema rejects', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.anything().filter((v) => !outputSchema.safeParse(v).success),
      async (result) => {
        const tool = standardTool({
          name: 'bad_output',
          description: 'Returns an unvalidated result',
          outputSchema,
          execute: () => result as z.infer<typeof outputSchema>,
        });
        await assert.rejects(async () => await tool.execute(undefined as never), isOutputError);
      }
    )
  );
});

test('withFormattedOutput turns any failure into data', async () => {
  const wrapped = withFormattedOutput(forecast);
  await fc.assert(
    fc.asyncProperty(fc.anything(), async (input) => {
      const result = await wrapped.execute(input as never);
      if (!inputSchema.safeParse(input).success) assert.ok('error' in result);
    })
  );
});

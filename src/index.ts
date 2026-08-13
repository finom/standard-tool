import type { StandardSchemaV1, StandardJSONSchemaV1 } from './standard-schema.js';

/** Portable LLM tool. The type fixes the shape, not where validation runs; ship it neutral, format at the consumer boundary. */
export interface StandardToolV0<Input = unknown, Output = unknown, FormattedOutput = Output, Context = unknown> {
  name: string;
  title?: string;
  description: string;
  inputSchema?: StandardSchemaV1<Input> & StandardJSONSchemaV1<Input>;
  outputSchema?: StandardSchemaV1<Output> & StandardJSONSchemaV1<Output>;
  meta?: Record<string, unknown>;
  execute(input: Input, context?: Context): FormattedOutput | Promise<FormattedOutput>;
}

/** Wraps a raw handler so `execute` validates input and output. */
export function standardTool<Input = void, Output = unknown, Context = unknown>(
  def: StandardToolV0<Input, Output, Output, Context>
): StandardToolV0<Input, Output, Output, Context> {
  return {
    ...def,
    execute: async (input: Input, context?: Context): Promise<Output> => {
      const value = def.inputSchema ? await validate('input', def.inputSchema, input) : input;
      const output = await def.execute(value, context);
      return def.outputSchema ? await validate('output', def.outputSchema, output) : output;
    },
  };
}

/** Wrap a neutral tool so failures return as data, not throws. Apply once, at the consumer boundary. */
export function withFormattedOutput<Input, Output, FormattedOutput = Output | { error: string }, Context = unknown>(
  tool: StandardToolV0<Input, Output, NoInfer<Output>, Context>,
  format?: (result: Output | Error) => FormattedOutput | Promise<FormattedOutput>
): StandardToolV0<Input, Output, FormattedOutput, Context> {
  const fmt = (format ?? ((r: Output | Error) => (r instanceof Error ? { error: r.message } : r))) as (
    result: Output | Error
  ) => FormattedOutput | Promise<FormattedOutput>;
  return {
    ...tool,
    execute: async (input: Input, context?: Context): Promise<FormattedOutput> => {
      let result: Output | Error;
      try {
        result = await tool.execute(input, context);
      } catch (error) {
        result = error instanceof Error ? error : new Error(String(error), { cause: error });
      }
      return fmt(result);
    },
  };
}

export class StandardToolValidationError extends Error {
  readonly name = 'StandardToolValidationError';
  constructor(
    readonly target: 'input' | 'output',
    readonly issues: readonly StandardSchemaV1.Issue[]
  ) {
    super(
      `${target} validation failed: ${issues
        .map((i) => {
          const at = (i.path ?? []).map((s) => String(typeof s === 'object' ? s.key : s)).join('.');
          return at ? `${at}: ${i.message}` : i.message;
        })
        .join('; ')}`
    );
  }
}

async function validate<S extends StandardSchemaV1>(
  target: 'input' | 'output',
  schema: S,
  value: unknown
): Promise<StandardSchemaV1.InferOutput<S>> {
  const result = await schema['~standard'].validate(value);
  if (result.issues) throw new StandardToolValidationError(target, result.issues);
  return result.value;
}

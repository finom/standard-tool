import type { StandardSchemaV1, StandardJSONSchemaV1 } from './standard-schema.js';

/** Portable LLM tool. The type fixes the shape, not where validation runs; ship it neutral, format at the consumer boundary. */
export interface StandardToolV0<Input = unknown, Output = unknown, FormattedOutput = Output, Meta = unknown> {
  name: string;
  title?: string;
  description: string;
  inputSchema?: StandardSchemaV1<Input> & StandardJSONSchemaV1<Input>;
  outputSchema?: StandardSchemaV1<Output> & StandardJSONSchemaV1<Output>;
  execute(input: Input, meta?: Meta): FormattedOutput | Promise<FormattedOutput>;
}

/** Takes a tool whose `execute` is the raw handler; returns one whose `execute` validates in & out. */
export function standardTool<Input = unknown, Output = unknown, Meta = unknown>(
  def: StandardToolV0<Input, Output, Output, Meta>
): StandardToolV0<Input, Output, Output, Meta> {
  return {
    ...def,
    execute: async (input: Input, meta?: Meta): Promise<Output> => {
      const value = def.inputSchema ? await validate('input', def.inputSchema, input) : input;
      const output = await def.execute(value, meta);
      return def.outputSchema ? await validate('output', def.outputSchema, output) : output;
    },
  };
}

/**
 * Wrap a neutral tool so failures come back as data instead of throws.
 * Apply once, at the consumer's boundary. The formatter runs exactly once; what it throws propagates unformatted.
 * Let `format` infer `FormattedOutput`; naming it explicitly without a matching `format` mistypes the result.
 */
export function withFormattedOutput<Input, Output, FormattedOutput = Output | { error: string }, Meta = unknown>(
  tool: StandardToolV0<Input, Output, NoInfer<Output>, Meta>,
  format?: (result: Output | Error) => FormattedOutput | Promise<FormattedOutput>
): StandardToolV0<Input, Output, FormattedOutput, Meta> {
  const fmt = (format ?? ((r: Output | Error) => (r instanceof Error ? { error: r.message } : r))) as (
    result: Output | Error
  ) => FormattedOutput | Promise<FormattedOutput>;
  return {
    ...tool,
    execute: async (input: Input, meta?: Meta): Promise<FormattedOutput> => {
      let result: Output | Error;
      try {
        result = await tool.execute(input, meta);
      } catch (error) {
        result = error instanceof Error ? error : new Error(String(error), { cause: error });
      }
      return fmt(result);
    },
  };
}

/** Thrown when input or output fails validation; carries the side and the Standard Schema issues. */
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

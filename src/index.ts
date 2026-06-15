import type { StandardSchemaV1, StandardJSONSchemaV1 } from './standard-schema.js';

/** Portable LLM tool: `execute` validates in & out and throws; `formatted()` re-targets the result. */
export interface StandardToolV0<Input = unknown, Output = unknown, FormattedOutput = Output, Meta = unknown> {
  name: string;
  title?: string;
  description: string;
  inputSchema?: StandardSchemaV1<Input> & StandardJSONSchemaV1<Input>;
  outputSchema?: StandardSchemaV1<Output> & StandardJSONSchemaV1<Output>;
  // `input` is optional only when no `inputSchema` fixes its type (`Input` stays `unknown`); a schema makes it required.
  execute(
    ...args: unknown extends Input ? [input?: Input, meta?: Meta] : [input: Input, meta?: Meta]
  ): FormattedOutput | Promise<FormattedOutput>;
  formatted<F = Output | { error: string }>(
    format?: (result: Output | Error) => F | Promise<F>
  ): StandardToolV0<Input, Output, F, Meta>;
}

/** A tool minus the synthesized `formatted` — what you pass to `standardTool()`. */
export type StandardToolV0Definition<
  Input = unknown,
  Output = unknown,
  FormattedOutput = Output,
  Meta = unknown,
> = Omit<StandardToolV0<Input, Output, FormattedOutput, Meta>, 'formatted'>;

export function standardTool<Input = unknown, Output = unknown, Meta = unknown>(def: {
  name: string;
  title?: string;
  description: string;
  inputSchema?: StandardSchemaV1<Input> & StandardJSONSchemaV1<Input>;
  outputSchema?: StandardSchemaV1<Output> & StandardJSONSchemaV1<Output>;
  // plain, required `input` so TS infers `Input`/`Meta` from your handler and the handler never sees `undefined`
  execute(input: Input, meta?: Meta): Output | Promise<Output>;
}): StandardToolV0<Input, Output, Output, Meta> {
  const { execute: handler, ...rest } = def;
  const execute = async (input?: Input, meta?: Meta): Promise<Output> => {
    const value = def.inputSchema ? await validate('input', def.inputSchema, input) : (input as Input);
    const output = await handler(value, meta);
    return def.outputSchema ? await validate('output', def.outputSchema, output) : output;
  };
  const tool: StandardToolV0<Input, Output, Output, Meta> = {
    ...rest,
    execute,
    formatted<F = Output | { error: string }>(
      format?: (result: Output | Error) => F | Promise<F>
    ): StandardToolV0<Input, Output, F, Meta> {
      const fmt = (format ?? ((r: Output | Error) => (r instanceof Error ? { error: r.message } : r))) as (
        result: Output | Error
      ) => F | Promise<F>;
      // re-derive from the validated execute, never the previous formatting, so formatting never stacks
      return {
        ...tool,
        execute: async (input?: Input, meta?: Meta): Promise<F> => {
          try {
            return fmt(await execute(input, meta));
          } catch (error) {
            return fmt(error instanceof Error ? error : new Error(String(error)));
          }
        },
      };
    },
  };
  return tool;
}

/** Thrown when input or output fails validation; carries the side and the Standard Schema issues. */
export class StandardToolV0ValidationError extends Error {
  readonly name = 'StandardToolV0ValidationError';
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
  if (result.issues) throw new StandardToolV0ValidationError(target, result.issues);
  return result.value;
}

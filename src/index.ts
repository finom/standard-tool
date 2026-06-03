import type { StandardSchemaV1, StandardJSONSchemaV1 } from './standard-schema.js';

type CombinedSpec<T> = StandardSchemaV1<T> & StandardJSONSchemaV1<T>;

/** Thrown when a tool's input or output fails validation; carries the side and the Standard Schema issues. */
export class StandardToolValidationError extends Error {
  readonly name = 'StandardToolValidationError';
  constructor(
    readonly target: 'input' | 'output',
    readonly issues: readonly StandardSchemaV1.Issue[]
  ) {
    super(`${target} validation failed: ${issues.map((i) => i.message).join('; ')}`);
  }
}

/** Portable LLM tool. Neutral (`FormattedOutput = Output`): `execute` validates in & out, returns `Output`, and throws. */
export interface StandardTool<Input = unknown, Output = unknown, FormattedOutput = Output> {
  name: string;
  title?: string;
  description: string;
  inputSchema?: CombinedSpec<Input>;
  outputSchema?: CombinedSpec<Output>;
  execute(input: Input, meta?: unknown): FormattedOutput | Promise<FormattedOutput>;
}

/** A `StandardTool` that keeps its raw, throwing `executeUnformatted`, so it can be formatted and re-formatted. */
export interface FormattableStandardTool<Input = unknown, Output = unknown, FormattedOutput = Output>
  extends StandardTool<Input, Output, FormattedOutput> {
  executeUnformatted(input: Input, meta?: unknown): Promise<Output>;
  formatted<F = Output | { error: string }>(
    format?: (result: Output | Error) => F | Promise<F>
  ): FormattableStandardTool<Input, Output, F>;
}

/** Reference implementation: validate input → run the handler → validate output. The result is re-formattable. */
export function standardTool<Input = unknown, Output = unknown>(
  def: StandardTool<Input, Output>
): FormattableStandardTool<Input, Output, Output> {
  const { execute: handler, ...rest } = def;
  const execute = async (input: Input, meta?: unknown): Promise<Output> => {
    const value = def.inputSchema ? await validate('input', def.inputSchema, input) : input;
    const output = await handler(value, meta);
    return def.outputSchema ? await validate('output', def.outputSchema, output) : output;
  };
  // `execute` (the raw, validating, throwing call) doubles as `executeUnformatted`; `.formatted()` wraps it.
  const tool: FormattableStandardTool<Input, Output, Output> = {
    ...rest,
    execute,
    executeUnformatted: execute,
    formatted<F = Output | { error: string }>(
      format?: (result: Output | Error) => F | Promise<F>
    ): FormattableStandardTool<Input, Output, F> {
      // Default formatter: pass a success through, turn a thrown Error into `{ error }`.
      const fmt = (format ?? ((r: Output | Error) => (r instanceof Error ? { error: r.message } : r))) as (
        result: Output | Error
      ) => F | Promise<F>;
      // Re-derive from the raw `execute`, never the previous formatting; `...tool` carries everything else
      // (including this method), so the result stays re-formattable.
      return {
        ...tool,
        async execute(input, meta) {
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

async function validate<S extends StandardSchemaV1>(
  target: 'input' | 'output',
  schema: S,
  value: unknown
): Promise<StandardSchemaV1.InferOutput<S>> {
  const result = await schema['~standard'].validate(value);
  if (result.issues) throw new StandardToolValidationError(target, result.issues);
  return result.value;
}

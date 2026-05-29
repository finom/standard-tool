import type { CombinedSchema, StandardSchemaV1 } from './standard-schema.js';

export type * from './standard-schema.js';

/** The default model-facing output: your `Output`, or an `{ error }` envelope when execution or validation failed. */
export type DefaultModelOutput<Output> = Output | { error: string };

/**
 * Maps a raw tool result — your `Output`, or an `Error` (carrying `issues` when a Standard Schema
 * validation failed) — to the model-facing output. Return an envelope to keep a model loop running,
 * or throw to surface the error.
 */
export type FormatOutputFn<Output, ModelOutput> = (result: Output | Error) => ModelOutput | Promise<ModelOutput>;

/**
 * A standard, DRY LLM tool over its **data** types `Input`/`Output`: `name` + `description` +
 * optional Standard-Schema/JSON-Schema `inputSchema`/`outputSchema` + `execute(input: Input)`.
 * `ModelOutput` is what `execute` returns to the model after formatting — by default
 * {@link DefaultModelOutput}, i.e. the data or an `{ error }` envelope.
 */
export interface StandardTool<Input, Output, ModelOutput = DefaultModelOutput<Output>> {
  name: string;
  description: string;
  /** Optional Standard Schema + Standard JSON Schema describing the input data. */
  inputSchema?: CombinedSchema<Input>;
  /** Optional Standard Schema + Standard JSON Schema describing the output data. */
  outputSchema?: CombinedSchema<Output>;
  /**
   * Validate input (when `inputSchema`) → run your logic → validate output (when `outputSchema`) →
   * format. **Never throws by default**: a validation failure or a thrown error becomes the formatted
   * output (`{ error: string }`), so a model-calling loop always gets a value back.
   */
  execute(input: Input): ModelOutput | Promise<ModelOutput>;
}

/**
 * Create a standard tool. `inputSchema`/`outputSchema` are optional; when present they must implement
 * both Standard Schema (validation) and Standard JSON Schema (JSON Schema emission) — e.g. Zod 4.2+,
 * ArkType 2.1.28+, or Valibot 1.2+ via `@valibot/to-json-schema`.
 *
 * Your `execute` receives the (validated) input and returns the output. The returned tool's `execute`
 * validates input, runs yours, validates the result, then formats it via `formatOutput` — which by
 * default turns any error into `{ error: message }` instead of throwing, so a model loop keeps going.
 * Pass your own `formatOutput` to reshape the output (its return type becomes the tool's `ModelOutput`)
 * or to throw and surface the error. Validation failures are plain `Error`s carrying an `issues` array.
 */
export function standardTool<Input, Output, ModelOutput = DefaultModelOutput<Output>>(def: {
  name: string;
  description: string;
  inputSchema?: CombinedSchema<Input>;
  outputSchema?: CombinedSchema<Output>;
  execute: (input: Input) => Output | Promise<Output>;
  formatOutput?: FormatOutputFn<Output, ModelOutput>;
}): StandardTool<Input, Output, ModelOutput> {
  const formatOutput: FormatOutputFn<Output, ModelOutput> =
    def.formatOutput ??
    ((result) => (result instanceof Error ? { error: result.message } : result) as unknown as ModelOutput);
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    outputSchema: def.outputSchema,
    async execute(input) {
      let result: Output | Error;
      try {
        const validInput = def.inputSchema ? await validate('input', def.inputSchema, input) : input;
        const output = await def.execute(validInput);
        result = def.outputSchema ? await validate('output', def.outputSchema, output) : output;
      } catch (error) {
        result = error instanceof Error ? error : new Error(String(error));
      }
      return formatOutput(result);
    },
  };
}

async function validate<S extends StandardSchemaV1>(
  target: 'input' | 'output',
  schema: S,
  value: unknown
): Promise<StandardSchemaV1.InferOutput<S>> {
  const result = await schema['~standard'].validate(value); // await covers sync + async
  if (result.issues) {
    // A plain Error carrying the Standard Schema issues — no dedicated error type needed.
    throw Object.assign(new Error(`${target} validation failed: ${result.issues.map((i) => i.message).join('; ')}`), {
      issues: result.issues,
    });
  }
  return result.value;
}

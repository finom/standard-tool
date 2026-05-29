import type { CombinedSchema, StandardSchemaV1 } from './standard-schema.js';

export type * from './standard-schema.js';

/**
 * Thrown internally when input or output fails Standard Schema validation. By default it is caught
 * by {@link StandardTool.execute} and handed to {@link StandardTool.toModelOutput}; it surfaces as
 * a real exception only if your `toModelOutput` re-throws it.
 */
export class ToolValidationError extends Error {
  constructor(
    readonly target: 'input' | 'output',
    readonly issues: readonly StandardSchemaV1.Issue[]
  ) {
    super(`${target} validation failed: ${issues.map((i) => i.message).join('; ')}`);
    this.name = 'ToolValidationError';
  }

  /** Serialize to a plain object so `JSON.stringify(err)` is useful — e.g. feeding the error back to a model. */
  toJSON() {
    return { name: this.name, target: this.target, message: this.message, issues: this.issues };
  }
}

/** The default model-facing output: your `Output`, or an `{ error }` envelope when execution or validation failed. */
export type DefaultModelOutput<Output> = Output | { error: string };

/**
 * Maps a raw tool result — your `Output`, or an `Error` (a {@link ToolValidationError} on validation
 * failure) — to the model-facing output. Return an envelope to keep a model loop running, or re-throw
 * to surface the error.
 */
export type ToModelOutputFn<Output, ModelOutput> = (result: Output | Error) => ModelOutput | Promise<ModelOutput>;

/**
 * A standard, DRY LLM tool over its **data** types `Input`/`Output`: `name` + `description` +
 * Standard-Schema/JSON-Schema `inputSchema`/`outputSchema` + `execute(input: Input)`, validating both
 * at runtime. `ModelOutput` is what `execute` actually returns to the model after `toModelOutput`
 * formats the result — by default {@link DefaultModelOutput}, i.e. the data or an `{ error }` envelope.
 */
export interface StandardTool<Input, Output, ModelOutput = DefaultModelOutput<Output>> {
  name: string;
  description: string;
  /** Standard Schema + Standard JSON Schema describing the input data. */
  inputSchema: CombinedSchema<Input>;
  /** Standard Schema + Standard JSON Schema describing the output data. */
  outputSchema: CombinedSchema<Output>;
  /**
   * Validate input → run your logic → validate output → format via {@link StandardTool.toModelOutput}.
   * **Never throws by default**: a validation failure or a thrown error becomes the formatted output
   * (`{ error: string }`), so a model-calling loop always gets a value back.
   */
  execute(input: Input): ModelOutput | Promise<ModelOutput>;
  /**
   * Maps the raw result (your `Output`, or an `Error`) to what the model receives. Default:
   * `result instanceof Error ? { error: result.message } : result`.
   */
  toModelOutput(result: Output | Error): ModelOutput | Promise<ModelOutput>;
}

/**
 * Create a standard tool. `inputSchema`/`outputSchema` must implement both Standard Schema
 * (validation) and Standard JSON Schema (JSON Schema emission) — e.g. Zod 4.2+, ArkType 2.1.28+,
 * or Valibot 1.2+ via `@valibot/to-json-schema`.
 *
 * Your `execute` receives the validated input and returns the output. The returned tool's `execute`
 * validates input, runs yours, validates the result, then formats it via `toModelOutput` — which by
 * default turns any error into `{ error: message }` instead of throwing, so a model loop keeps going.
 * Pass your own `toModelOutput` to reshape the output (its return type becomes the tool's output), or
 * to re-throw and restore throwing behavior.
 */
export function standardTool<Input, Output, ModelOutput>(def: {
  name: string;
  description: string;
  inputSchema: CombinedSchema<Input>;
  outputSchema: CombinedSchema<Output>;
  execute: (input: Input) => Output | Promise<Output>;
  toModelOutput: ToModelOutputFn<Output, ModelOutput>;
}): StandardTool<Input, Output, ModelOutput>;
export function standardTool<Input, Output>(def: {
  name: string;
  description: string;
  inputSchema: CombinedSchema<Input>;
  outputSchema: CombinedSchema<Output>;
  execute: (input: Input) => Output | Promise<Output>;
  toModelOutput?: undefined;
}): StandardTool<Input, Output, DefaultModelOutput<Output>>;
export function standardTool<Input, Output, ModelOutput>(def: {
  name: string;
  description: string;
  inputSchema: CombinedSchema<Input>;
  outputSchema: CombinedSchema<Output>;
  execute: (input: Input) => Output | Promise<Output>;
  toModelOutput?: ToModelOutputFn<Output, ModelOutput>;
}): StandardTool<Input, Output, ModelOutput> {
  const toModelOutput: ToModelOutputFn<Output, ModelOutput> =
    def.toModelOutput ??
    ((result) => (result instanceof Error ? { error: result.message } : result) as unknown as ModelOutput);
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    outputSchema: def.outputSchema,
    toModelOutput,
    async execute(input) {
      let result: Output | Error;
      try {
        const validInput = await validate('input', def.inputSchema, input);
        const output = await def.execute(validInput);
        result = await validate('output', def.outputSchema, output);
      } catch (error) {
        result = error instanceof Error ? error : new Error(String(error));
      }
      return toModelOutput(result);
    },
  };
}

async function validate<S extends StandardSchemaV1>(
  target: 'input' | 'output',
  schema: S,
  value: unknown
): Promise<StandardSchemaV1.InferOutput<S>> {
  const result = await schema['~standard'].validate(value); // await covers sync + async
  if (result.issues) throw new ToolValidationError(target, result.issues);
  return result.value;
}

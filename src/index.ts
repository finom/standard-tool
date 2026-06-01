import type { CombinedSpec, StandardSchemaV1 } from './standard-schema.js';

export type * from './standard-schema.js';

/** The default formatted output: your `Output`, or an `{ error }` envelope when execution or validation failed. */
export type DefaultFormattedOutput<Output> = Output | { error: string };

/**
 * Maps a raw tool result — your `Output`, or an `Error` (carrying `issues` when a Standard Schema
 * validation failed) — to the formatted output. Return an envelope to keep a model loop running,
 * or throw to surface the error.
 */
export type FormatOutputFn<Output, FormattedOutput> = (
  result: Output | Error
) => FormattedOutput | Promise<FormattedOutput>;

/**
 * A standard, DRY LLM tool over its **data** types `Input`/`Output`: `name` + `description` +
 * optional Standard-Schema/JSON-Schema `inputSchema`/`outputSchema` + `execute(input: Input)`.
 * `FormattedOutput` is what `execute` returns to the model after formatting — by default
 * {@link DefaultFormattedOutput}, i.e. the data or an `{ error }` envelope.
 */
export interface StandardTool<Input = unknown, Output = unknown, FormattedOutput = DefaultFormattedOutput<Output>> {
  name: string;
  /** Optional human-readable label for the tool, surfaced by MCP clients in tool-list UIs. Ignored by plain function-calling APIs. */
  title?: string;
  description: string;
  /** Optional Standard Schema + Standard JSON Schema describing the input data. */
  inputSchema?: CombinedSpec<Input>;
  /** Optional Standard Schema + Standard JSON Schema describing the output data. */
  outputSchema?: CombinedSpec<Output>;
  /**
   * Validate input (when `inputSchema`) → run your logic → validate output (when `outputSchema`) →
   * format. **By default it doesn't throw**: a validation failure or a thrown error becomes the
   * formatted output (`{ error: string }`) — unless your `formatOutput` throws — so a model loop
   * keeps running. `meta` is optional per-call runtime context (auth tokens, resolvers, request-scoped
   * data) forwarded verbatim to your handler — never validated, never in the JSON Schema.
   */
  // biome-ignore lint/suspicious/noExplicitAny: per-call runtime context, typed by the consumer's handler
  execute(input: Input, meta?: any): FormattedOutput | Promise<FormattedOutput>;
}

/**
 * Create a standard tool. `inputSchema`/`outputSchema` are optional; when present they must implement
 * both Standard Schema (validation) and Standard JSON Schema (JSON Schema emission) — e.g. Zod 4.2+,
 * ArkType 2.1.28+, or Valibot 1.2+ via `@valibot/to-json-schema`.
 *
 * Your `execute` receives the (validated) input and returns the output. The returned tool's `execute`
 * validates input, runs yours, validates the result, then formats it via `formatOutput` — which by
 * default turns any error into `{ error: message }` instead of throwing, so a model loop keeps going.
 * Pass your own `formatOutput` to reshape the output (its return type becomes the tool's `FormattedOutput`)
 * or to throw and surface the error. Validation failures are plain `Error`s carrying an `issues` array.
 */
export function standardTool<Input = unknown, Output = unknown, FormattedOutput = DefaultFormattedOutput<Output>>(def: {
  name: string;
  title?: string;
  description: string;
  inputSchema?: CombinedSpec<Input>;
  outputSchema?: CombinedSpec<Output>;
  // biome-ignore lint/suspicious/noExplicitAny: per-call runtime context, typed by the consumer's handler
  execute: (input: Input, meta: any) => Output | Promise<Output>;
  formatOutput?: FormatOutputFn<Output, FormattedOutput>;
}): StandardTool<Input, Output, FormattedOutput> {
  const formatOutput: FormatOutputFn<Output, FormattedOutput> =
    def.formatOutput ??
    ((result) => (result instanceof Error ? { error: result.message } : result) as unknown as FormattedOutput);
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
    outputSchema: def.outputSchema,
    async execute(input, meta) {
      let result: Output | Error;
      try {
        const validInput = def.inputSchema ? await validate('input', def.inputSchema, input) : input;
        const output = await def.execute(validInput, meta);
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

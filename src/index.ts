import type { CombinedSchema, StandardSchemaV1 } from './schema.js';

export type * from './schema.js';

/** Thrown when input or output fails Standard Schema validation. */
export class ToolValidationError extends Error {
  constructor(
    readonly target: 'input' | 'output',
    readonly issues: readonly StandardSchemaV1.Issue[]
  ) {
    super(`${target} validation failed: ${issues.map((i) => i.message).join('; ')}`);
    this.name = 'ToolValidationError';
  }
}

/**
 * A standard, DRY LLM tool: `name` + `description` + validated input/output + `execute`.
 * `execute` maps the input schema's input type to the output schema's output type
 * (`execute(input: InferInput<Input>): InferOutput<Output>`), validating both at runtime.
 */
export interface StandardTool<Input extends CombinedSchema, Output extends CombinedSchema> {
  name: string;
  description: string;
  /** Standard Schema + Standard JSON Schema for the input. */
  inputSchema: Input;
  /** Standard Schema + Standard JSON Schema for the output. */
  outputSchema: Output;
  /** Validate input → run → validate output. Throws {@link ToolValidationError} on failure. */
  execute(
    input: StandardSchemaV1.InferInput<Input>
  ): StandardSchemaV1.InferOutput<Output> | Promise<StandardSchemaV1.InferOutput<Output>>;
}

/**
 * Create a standard tool. `inputSchema`/`outputSchema` must implement both Standard Schema
 * (validation) and Standard JSON Schema (JSON Schema emission) — e.g. Zod 4.2+, ArkType 2.1.28+,
 * or Valibot 1.2+ via `@valibot/to-json-schema`.
 *
 * Your `execute` receives the validated input and returns the output; the returned tool's
 * `execute` validates input, runs yours, then validates the result.
 */
export function standardTool<Input extends CombinedSchema, Output extends CombinedSchema>(def: {
  name: string;
  description: string;
  inputSchema: Input;
  outputSchema: Output;
  execute: (
    input: StandardSchemaV1.InferOutput<Input>
  ) => StandardSchemaV1.InferOutput<Output> | Promise<StandardSchemaV1.InferOutput<Output>>;
}): StandardTool<Input, Output> {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    outputSchema: def.outputSchema,
    async execute(input) {
      const validInput = await validate('input', def.inputSchema, input);
      const result = await def.execute(validInput);
      return validate('output', def.outputSchema, result);
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

import type { CombinedSchema, StandardSchemaV1 } from './standard-schema.js';

export type * from './standard-schema.js';

/** Thrown when input or output fails Standard Schema validation. */
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

/**
 * A standard, DRY LLM tool over its **data** types `Input`/`Output`: `name` + `description` +
 * Standard-Schema/JSON-Schema `inputSchema`/`outputSchema` + `execute(input: Input): Output`,
 * validating both at runtime. `Input`/`Output` are the data the tool accepts and returns; the
 * schemas describe them.
 */
export interface StandardTool<Input, Output> {
  name: string;
  description: string;
  /** Standard Schema + Standard JSON Schema describing the input data. */
  inputSchema: CombinedSchema<Input>;
  /** Standard Schema + Standard JSON Schema describing the output data. */
  outputSchema: CombinedSchema<Output>;
  /** Validate input → run → validate output. Throws {@link ToolValidationError} on failure. */
  execute(input: Input): Output | Promise<Output>;
}

/**
 * Create a standard tool. `inputSchema`/`outputSchema` must implement both Standard Schema
 * (validation) and Standard JSON Schema (JSON Schema emission) — e.g. Zod 4.2+, ArkType 2.1.28+,
 * or Valibot 1.2+ via `@valibot/to-json-schema`.
 *
 * Your `execute` receives the validated input and returns the output; the returned tool's
 * `execute` validates input, runs yours, then validates the result.
 */
export function standardTool<Input, Output>(def: {
  name: string;
  description: string;
  inputSchema: CombinedSchema<Input>;
  outputSchema: CombinedSchema<Output>;
  execute: (input: Input) => Output | Promise<Output>;
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

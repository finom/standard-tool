import type { StandardSchemaV1, StandardJSONSchemaV1 } from './standard-schema.js';

type CombinedSpec<T> = StandardSchemaV1<T> & StandardJSONSchemaV1<T>;

export type DefaultFormattedOutput<Output> = Output | { error: string };

/** A portable LLM tool definition. */
export interface StandardTool<Input = unknown, Output = unknown, FormattedOutput = DefaultFormattedOutput<Output>> {
  name: string;
  title?: string;
  description: string;
  inputSchema?: CombinedSpec<Input>;
  outputSchema?: CombinedSpec<Output>;
  // biome-ignore lint/suspicious/noExplicitAny: per-call context, typed by the handler
  execute(input: Input, meta?: any): FormattedOutput | Promise<FormattedOutput>;
}

/** Reference implementation of the {@link StandardTool} type. */
export function standardTool<Input = unknown, Output = unknown, FormattedOutput = DefaultFormattedOutput<Output>>(def: {
  name: string;
  title?: string;
  description: string;
  inputSchema?: CombinedSpec<Input>;
  outputSchema?: CombinedSpec<Output>;
  // biome-ignore lint/suspicious/noExplicitAny: per-call context, typed by the handler
  execute: (input: Input, meta: any) => Output | Promise<Output>;
  formatOutput?: (result: Output | Error) => FormattedOutput | Promise<FormattedOutput>;
}): StandardTool<Input, Output, FormattedOutput> {
  const formatOutput: (result: Output | Error) => FormattedOutput | Promise<FormattedOutput> =
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
  const result = await schema['~standard'].validate(value);
  if (result.issues) {
    throw Object.assign(new Error(`${target} validation failed: ${result.issues.map((i) => i.message).join('; ')}`), {
      issues: result.issues,
    });
  }
  return result.value;
}

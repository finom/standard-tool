import type { StandardSchemaV1, StandardJSONSchemaV1 } from './standard-schema.js';

type CombinedSpec<T> = StandardSchemaV1<T> & StandardJSONSchemaV1<T>;

/** The default formatter's envelope: the raw `Output`, or `{ error }` on a validation/exec failure. */
export type DefaultFormattedOutput<Output> = Output | { error: string };

/**
 * Thrown by a neutral tool's `execute`/`executeUnformatted` when input or output validation fails.
 * Carries the failing side and the Standard Schema issues, so a formatter can build a rich result.
 */
export class StandardToolValidationError extends Error {
  constructor(
    readonly target: 'input' | 'output',
    readonly issues: readonly StandardSchemaV1.Issue[]
  ) {
    super(`${target} validation failed: ${issues.map((i) => i.message).join('; ')}`);
    this.name = 'StandardToolValidationError';
  }
}

/**
 * A portable LLM tool definition — the standard interchange shape, meant to be produced and
 * consumed by any framework, SDK, or app.
 *
 * In its neutral form (`FormattedOutput = Output`, the default) `execute` validates input and
 * output against the tool's own schemas, returns the validated `Output`, and *throws* on a
 * violation. Formatting (`FormattedOutput` ≠ `Output`) reshapes that result for a specific
 * consumer (an MCP envelope, a provider result shape), which binds the tool to that consumer — so
 * it is opt-in and lives outside this neutral shape (see {@link FormattableTool.formatted}).
 */
export interface StandardTool<Input = unknown, Output = unknown, FormattedOutput = Output> {
  name: string;
  title?: string;
  description: string;
  inputSchema?: CombinedSpec<Input>;
  outputSchema?: CombinedSpec<Output>;
  // biome-ignore lint/suspicious/noExplicitAny: per-call context, typed by the handler
  execute(input: Input, meta?: any): FormattedOutput | Promise<FormattedOutput>;
}

/**
 * What {@link standardTool} and {@link formatted} return: a {@link StandardTool} that additionally
 * carries `executeUnformatted` (the validated, throwing, *unformatted* execute) and a `formatted()`
 * method.
 *
 * Because the unformatted execute is carried — not discarded when you format — a formatted tool can
 * be re-formatted any number of times: every `formatted()` call re-derives from the unformatted
 * result, never from the previous formatting (replace, not compose). So a framework can ship a tool
 * pre-formatted for itself, and a consumer can still re-target it for other usage.
 */
export interface FormattableTool<Input = unknown, Output = unknown, FormattedOutput = Output>
  extends StandardTool<Input, Output, FormattedOutput> {
  /** Validate input → run → validate output, returning the raw `Output`. Throws on a violation. */
  // biome-ignore lint/suspicious/noExplicitAny: per-call context, typed by the handler
  executeUnformatted(input: Input, meta?: any): Promise<Output>;
  /** Re-format from the unformatted result. No formatter → the default `{ error }` envelope. */
  formatted(): FormattableTool<Input, Output, DefaultFormattedOutput<Output>>;
  formatted<NewFormattedOutput>(
    format: (result: Output | Error) => NewFormattedOutput | Promise<NewFormattedOutput>
  ): FormattableTool<Input, Output, NewFormattedOutput>;
}

type ToolMeta<Input, Output> = Pick<
  StandardTool<Input, Output>,
  'name' | 'title' | 'description' | 'inputSchema' | 'outputSchema'
>;

type Raw<Input, Output> = (input: Input, meta?: unknown) => Output | Promise<Output>;
type Format<Output, FormattedOutput> = (result: Output | Error) => FormattedOutput | Promise<FormattedOutput>;

const defaultFormat = <Output>(result: Output | Error): DefaultFormattedOutput<Output> =>
  result instanceof Error ? { error: result.message } : result;

/** Build a FormattableTool from its parts. With no `format`, the tool is neutral (`execute` === raw). */
function makeFormattable<Input, Output, FormattedOutput>(
  base: ToolMeta<Input, Output>,
  raw: Raw<Input, Output>,
  format?: Format<Output, FormattedOutput>
): FormattableTool<Input, Output, FormattedOutput> {
  const executeUnformatted = async (input: Input, meta?: unknown): Promise<Output> => raw(input, meta);
  const execute: (input: Input, meta?: unknown) => Promise<FormattedOutput> = format
    ? async (input, meta) => {
        let result: Output | Error;
        try {
          result = await executeUnformatted(input, meta);
        } catch (error) {
          result = error instanceof Error ? error : new Error(String(error));
        }
        return format(result);
      }
    : (executeUnformatted as unknown as (input: Input, meta?: unknown) => Promise<FormattedOutput>);
  const tool = {
    name: base.name,
    title: base.title,
    description: base.description,
    inputSchema: base.inputSchema,
    outputSchema: base.outputSchema,
    execute,
    executeUnformatted,
    formatted: (next?: Format<Output, unknown>) => makeFormattable(base, raw, next ?? defaultFormat),
  };
  return tool as unknown as FormattableTool<Input, Output, FormattedOutput>;
}

/**
 * Reference implementation of {@link StandardTool}. Returns a neutral tool: `execute` validates the
 * input (when an `inputSchema` is given), runs your handler, validates the output (when an
 * `outputSchema` is given), and returns the validated `Output`, *throwing* a
 * {@link StandardToolValidationError} on a violation (or rethrowing what your handler threw).
 *
 * To hand the model a consumer-specific shape instead of the raw `Output`, format it — see
 * {@link FormattableTool.formatted}.
 */
export function standardTool<Input = unknown, Output = unknown>(def: {
  name: string;
  title?: string;
  description: string;
  inputSchema?: CombinedSpec<Input>;
  outputSchema?: CombinedSpec<Output>;
  // biome-ignore lint/suspicious/noExplicitAny: per-call context, typed by the handler
  execute: (input: Input, meta: any) => Output | Promise<Output>;
}): FormattableTool<Input, Output, Output> {
  const raw: Raw<Input, Output> = async (input, meta) => {
    const validInput = def.inputSchema ? await validate('input', def.inputSchema, input) : input;
    const output = await def.execute(validInput, meta);
    return def.outputSchema ? await validate('output', def.outputSchema, output) : output;
  };
  const { name, title, description, inputSchema, outputSchema } = def;
  return makeFormattable<Input, Output, Output>({ name, title, description, inputSchema, outputSchema }, raw);
}

/**
 * Wrap a neutral {@link StandardTool} so `execute` returns a consumer-specific shape: the validated
 * `Output` (or an `Error`) is passed to `format`; with no `format`, the default `{ error }` envelope
 * is used. Returns a {@link FormattableTool}, so the result can itself be re-formatted.
 *
 * `tool.formatted(format)` is the equivalent for tools made by {@link standardTool}. Prefer the
 * method when you have one — it can re-format an *already-formatted* tool (it re-derives from the
 * carried unformatted execute), whereas this function takes a neutral tool.
 */
export function formatted<Input, Output>(
  tool: StandardTool<Input, Output, Output>
): FormattableTool<Input, Output, DefaultFormattedOutput<Output>>;
export function formatted<Input, Output, FormattedOutput>(
  tool: StandardTool<Input, Output, Output>,
  format: Format<Output, FormattedOutput>
): FormattableTool<Input, Output, FormattedOutput>;
export function formatted<Input, Output, FormattedOutput>(
  tool: StandardTool<Input, Output, Output>,
  format?: Format<Output, FormattedOutput>
): FormattableTool<Input, Output, FormattedOutput | DefaultFormattedOutput<Output>> {
  const carried = (tool as Partial<FormattableTool<Input, Output, Output>>).executeUnformatted;
  const raw: Raw<Input, Output> = carried ?? ((input, meta) => tool.execute(input, meta));
  const { name, title, description, inputSchema, outputSchema } = tool;
  const fmt = (format ?? defaultFormat) as Format<Output, FormattedOutput | DefaultFormattedOutput<Output>>;
  return makeFormattable({ name, title, description, inputSchema, outputSchema }, raw, fmt);
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

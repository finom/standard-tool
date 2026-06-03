# Examples

Using a StandardTool with [OpenAI](#openai), [Anthropic](#anthropic), the [Vercel AI SDK](#vercel-ai-sdk), and [MCP](#mcp) — the SDKs that accept a JSON Schema object or a Standard Schema directly. (One that takes only a library-specific schema, such as a Zod raw shape, would need a per-library shim, so it's out of scope here.) Each example keeps the tools in one array, maps it into the provider's request, and dispatches each tool call back by `name` — all inline, no helper functions. In real code you'd factor these into your own abstractions; here they're spelled out.

> The examples assume you've installed the provider SDK you're using (`openai`, `@anthropic-ai/sdk`, or `ai` with `@ai-sdk/*`) plus `standard-tool` and `zod`. They use Zod, but the model only ever sees the JSON Schema a tool emits, so Valibot or ArkType work the same way.

Two parts of a tool do the work in every integration:

- `inputSchema['~standard'].jsonSchema.input({ target })` — the JSON Schema you hand the model so it knows how to call the tool.
- `execute(args)` — runs the tool, validating the model's arguments and the result and throwing on a violation. `formatted().execute(args)` returns `{ error }` instead of throwing, which is what you usually want inside a model loop.

## The shared tools

Define the tools once; every example below imports this array.

```ts
// tools.ts
import { standardTool, type FormattableStandardTool } from 'standard-tool';
import { z } from 'zod';

export const tools: FormattableStandardTool[] = [
  standardTool({
    name: 'get_weather',
    description: 'Get the current temperature for a city.',
    inputSchema: z.object({ city: z.string() }),
    outputSchema: z.object({ tempC: z.number() }),
    execute: async ({ city }) => ({ tempC: 21 }),
  }),
  standardTool({
    name: 'get_time',
    description: 'Get the current time in an IANA timezone.',
    inputSchema: z.object({ timezone: z.string() }),
    outputSchema: z.object({ iso: z.string() }),
    execute: async ({ timezone }) => ({ iso: new Date().toLocaleString('en-US', { timeZone: timezone }) }),
  }),
  standardTool({
    name: 'convert_currency',
    description: 'Convert an amount between two currencies.',
    inputSchema: z.object({ amount: z.number(), from: z.string(), to: z.string() }),
    outputSchema: z.object({ amount: z.number() }),
    execute: async ({ amount }) => ({ amount: Math.round(amount * 1.08 * 100) / 100 }),
  }),
];
```

## OpenAI

### Chat Completions

Tools go in under a `function` key; calls come back on `message.tool_calls`; each result is a `role: 'tool'` message.

```ts
import OpenAI from 'openai';
import { tools } from './tools';

const client = new OpenAI();

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: 'user', content: 'What is the weather in Paris?' },
];

const res = await client.chat.completions.create({
  model: 'gpt-5.5',
  messages,
  tools: tools.map((tool): OpenAI.Chat.ChatCompletionTool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
    },
  })),
});

messages.push(res.choices[0].message);
for (const call of res.choices[0].message.tool_calls ?? []) {
  if (call.type !== 'function') continue;
  const tool = tools.find((t) => t.name === call.function.name);
  if (!tool) continue;
  const result = await tool.formatted().execute(JSON.parse(call.function.arguments));
  messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
}

const final = await client.chat.completions.create({ model: 'gpt-5.5', messages });
console.log(final.choices[0].message.content);
```

### Responses API

The Responses API is flatter — it drops the `function` wrapper and adds an optional `strict`. Tool calls arrive as `function_call` items in `res.output`, and results go back as `function_call_output`:

```ts
import OpenAI from 'openai';
import { tools } from './tools';

const client = new OpenAI();

const input: OpenAI.Responses.ResponseInput = [{ role: 'user', content: 'What is the weather in Paris?' }];

const res = await client.responses.create({
  model: 'gpt-5.5',
  input,
  tools: tools.map((tool): OpenAI.Responses.Tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
    strict: false,
  })),
});

input.push(...res.output);
for (const item of res.output) {
  if (item.type !== 'function_call') continue;
  const tool = tools.find((t) => t.name === item.name);
  if (!tool) continue;
  const result = await tool.formatted().execute(JSON.parse(item.arguments));
  input.push({ type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(result) });
}

const final = await client.responses.create({ model: 'gpt-5.5', input });
console.log(final.output_text);
```

## Anthropic

The Messages API uses `input_schema` instead of `parameters`, returns `tool_use` blocks in the assistant's `content`, and expects `tool_result` blocks in a following `user` message.

```ts
import Anthropic from '@anthropic-ai/sdk';
import { tools } from './tools';

const client = new Anthropic();

const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'What is the weather in Paris?' }];

const res = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  messages,
  tools: tools.map((tool): Anthropic.Tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as Anthropic.Tool.InputSchema,
  })),
});

messages.push({ role: 'assistant', content: res.content });
const results: Anthropic.ToolResultBlockParam[] = [];
for (const block of res.content) {
  if (block.type !== 'tool_use') continue;
  const tool = tools.find((t) => t.name === block.name);
  if (!tool) continue;
  const result = await tool.formatted().execute(block.input);
  results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
}
messages.push({ role: 'user', content: results });

const final = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 1024, messages });
console.log(final.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''));
```

## Vercel AI SDK

The AI SDK (version 6) runs the tool loop itself: give `generateText` a set of tools and a `stopWhen` condition and it calls them and feeds results back until the model answers.

A tool's `inputSchema` is already a Standard Schema, and the SDK accepts one directly — it derives the model-facing JSON Schema and validates the model's arguments from it. Pass it as-is, and give `execute` the tool's `executeUnformatted`, which runs the tool and returns its raw `Output` (not a formatted `{ error }` envelope) for the SDK to surface.

```ts
import { generateText, tool, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { tools } from './tools';

const { text } = await generateText({
  model: openai('gpt-5.5'), // or anthropic('claude-sonnet-4-6')
  prompt: 'What is the weather in Paris?',
  stopWhen: stepCountIs(5),
  tools: Object.fromEntries(
    tools.map(({ name, description, inputSchema, executeUnformatted }) => [
      name,
      tool({ description, inputSchema, execute: executeUnformatted }),
    ]),
  ),
});

console.log(text);
```

## MCP

A StandardTool maps onto the Model Context Protocol with the same two parts:

- **`tools/list`** — `inputSchema['~standard'].jsonSchema.input({ target })` and `.output({ target })` give the `inputSchema` / `outputSchema` JSON Schema for the descriptor (`name`, `title`, `description`).
- **`tools/call`** — apply the text-only `.formatted(toMcpResult)` formatter from the README's [MCP-compatible output](./README.md#mcp-compatible-output) section, and `execute` returns a value shaped like an MCP `CallToolResult` (`{ content, structuredContent?, isError? }`) that you return from the handler. `execute` validates once; don't also register a validating schema for the same call.

## Notes

- **Who validates.** OpenAI and Anthropic don't check tool arguments against your schema, so `formatted().execute` is the only validation — that's why those examples call it on the model's raw args. The AI SDK validates from the schema you give it, so passing the tool's `inputSchema` straight in lets it both describe and validate the tool.
- **Errors as data.** `execute` throws on a schema-invalid argument or result; `formatted().execute` returns `{ error }` instead, so an invalid argument goes back to the model to fix. `JSON.parse` runs before `execute`, so guard it if the model might emit invalid JSON syntax — that throws before `execute` can turn it into `{ error }`.
- **JSON Schema targets.** `{ target: 'draft-2020-12' }` fits OpenAI and Anthropic; use `'openapi-3.0'` for consumers that want the OpenAPI subset (such as Gemini), or `'draft-07'`.
- **Per-call context.** Pass data the model shouldn't see (an auth token, tenant, locale) as the second argument to `execute(input, meta)`. It's never validated and never in the JSON Schema.

## Links

- [README](./README.md) — the type, the API, and the OpenAI Responses + MCP-output sections
- [OVERVIEW](./OVERVIEW.md) — why this exists and how the provider/framework tool shapes compare
- [Standard Schema](https://standardschema.dev) · [Standard JSON Schema](https://standardschema.dev/json-schema)
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling) · [Anthropic tool use](https://platform.claude.com/docs/en/build-with-claude/tool-use) · [AI SDK tools](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)

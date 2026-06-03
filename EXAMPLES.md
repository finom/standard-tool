# Examples

Using a StandardTool with [OpenAI](#openai), [Anthropic](#anthropic), the [Vercel AI SDK](#vercel-ai-sdk), and [MCP](#mcp) — the SDKs that accept a JSON Schema object or a Standard Schema directly. (One that takes only a library-specific schema, such as a Zod raw shape, would need a per-library shim, so it's out of scope here.) Each example wires a single tool directly into the provider's request and handles the tool call inline — no helpers, no dispatch table — so you can see exactly which part of a StandardTool maps to what. In real code you'd factor these into your own abstractions; here they're spelled out.

> The examples assume you've installed the provider SDK you're using (`openai`, `@anthropic-ai/sdk`, or `ai` with `@ai-sdk/*`) plus `standard-tool` and `zod`. They use Zod, but the model only ever sees the JSON Schema a tool emits, so Valibot or ArkType work the same way.

Two parts of a tool do the work in every integration:

- `inputSchema['~standard'].jsonSchema.input({ target })` — the JSON Schema you hand the model so it knows how to call the tool.
- `execute(args)` — runs the tool, validating the model's arguments and the result and throwing on a violation. `formatted().execute(args)` returns `{ error }` instead of throwing, which is what you usually want inside a model loop.

## The shared tool

Define the tool once; every example below imports it.

```ts
// tool.ts
import { standardTool } from 'standard-tool';
import { z } from 'zod';

export const getWeather = standardTool({
  name: 'get_weather',
  description: 'Get the current temperature for a city.',
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ tempC: z.number() }),
  execute: async ({ city }) => ({ tempC: 21 }), // call your real weather API here
});
```

## OpenAI

### Chat Completions

Tools go in under a `function` key; calls come back on `message.tool_calls`; each result is a `role: 'tool'` message.

```ts
import OpenAI from 'openai';
import { getWeather } from './tool';

const client = new OpenAI();

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: 'user', content: 'What is the weather in Paris?' },
];

const res = await client.chat.completions.create({
  model: 'gpt-5.5',
  messages,
  tools: [
    {
      type: 'function',
      function: {
        name: getWeather.name,
        description: getWeather.description,
        parameters: getWeather.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
      },
    },
  ],
});

messages.push(res.choices[0].message);
for (const call of res.choices[0].message.tool_calls ?? []) {
  if (call.type !== 'function' || call.function.name !== getWeather.name) continue;
  // execute is the only validation — OpenAI doesn't check args; bad args come back as { error }
  const result = await getWeather.formatted().execute(JSON.parse(call.function.arguments));
  messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
}

const final = await client.chat.completions.create({ model: 'gpt-5.5', messages });
console.log(final.choices[0].message.content);
```

### Responses API

The Responses API is flatter — it drops the `function` wrapper and adds an optional `strict`. Tool calls arrive as `function_call` items in `res.output`, and results go back as `function_call_output`:

```ts
import OpenAI from 'openai';
import { getWeather } from './tool';

const client = new OpenAI();

const input: OpenAI.Responses.ResponseInput = [{ role: 'user', content: 'What is the weather in Paris?' }];

const res = await client.responses.create({
  model: 'gpt-5.5',
  input,
  tools: [
    {
      type: 'function',
      name: getWeather.name,
      description: getWeather.description,
      parameters: getWeather.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
      strict: false,
    },
  ],
});

input.push(...res.output);
for (const item of res.output) {
  if (item.type !== 'function_call' || item.name !== getWeather.name) continue;
  const result = await getWeather.formatted().execute(JSON.parse(item.arguments));
  input.push({ type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(result) });
}

const final = await client.responses.create({ model: 'gpt-5.5', input });
console.log(final.output_text);
```

## Anthropic

The Messages API uses `input_schema` instead of `parameters`, returns `tool_use` blocks in the assistant's `content`, and expects `tool_result` blocks in a following `user` message.

```ts
import Anthropic from '@anthropic-ai/sdk';
import { getWeather } from './tool';

const client = new Anthropic();

const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'What is the weather in Paris?' }];

const res = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  messages,
  tools: [
    {
      name: getWeather.name,
      description: getWeather.description,
      input_schema: getWeather.inputSchema!['~standard'].jsonSchema.input({
        target: 'draft-2020-12',
      }) as Anthropic.Tool.InputSchema,
    },
  ],
});

messages.push({ role: 'assistant', content: res.content });
const results: Anthropic.ToolResultBlockParam[] = [];
for (const block of res.content) {
  if (block.type !== 'tool_use' || block.name !== getWeather.name) continue;
  // block.input arrives as unknown off the wire; execute validates it (returns { error } on a mismatch)
  const result = await getWeather.formatted().execute(block.input as { city: string });
  results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
}
messages.push({ role: 'user', content: results });

const final = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 1024, messages });
console.log(final.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''));
```

## Vercel AI SDK

The AI SDK (version 6) runs the tool loop itself: give `generateText` a set of tools and a `stopWhen` condition and it calls them and feeds results back until the model answers.

The thing to get right is validation. The SDK validates a tool's input against `inputSchema` before calling `execute` — but only when that schema carries a validator. Since `execute` already validates, hand the SDK the emitted JSON Schema through `jsonSchema()` (which has no validator), so the SDK only uses it to describe the tool to the model and `execute` validates exactly once.

```ts
import { generateText, tool, jsonSchema, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { getWeather } from './tool';

const { text } = await generateText({
  model: openai('gpt-5.5'), // or anthropic('claude-sonnet-4-6')
  prompt: 'What is the weather in Paris?',
  stopWhen: stepCountIs(5),
  tools: {
    [getWeather.name]: tool({
      description: getWeather.description,
      // no `validate` on jsonSchema() → the SDK describes the tool but does not validate, so the one
      // validation happens in getWeather.execute below (no double validation)
      inputSchema: jsonSchema<{ city: string }>(
        getWeather.inputSchema!['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
      ),
      execute: (args) => getWeather.execute(args),
    }),
  },
});

console.log(text);
```

## MCP

A StandardTool maps onto the Model Context Protocol with the same two parts:

- **`tools/list`** — `inputSchema['~standard'].jsonSchema.input({ target })` and `.output({ target })` give the `inputSchema` / `outputSchema` JSON Schema for the descriptor (`name`, `title`, `description`).
- **`tools/call`** — apply the text-only `.formatted(toMcpResult)` formatter from the README's [MCP-compatible output](./README.md#mcp-compatible-output) section, and `execute` returns a value shaped like an MCP `CallToolResult` (`{ content, structuredContent?, isError? }`) that you return from the handler. `execute` validates once; don't also register a validating schema for the same call.

## Notes

- **Validate once.** OpenAI and Anthropic don't check tool arguments against your schema, so `execute` is the validation — that's why the examples call it on the model's raw args. A framework that *does* validate from the schema would validate twice if `execute` also ran; pass the JSON Schema through `jsonSchema()` with no validator (as in the Vercel example) so the framework only describes the tool and `execute` validates once.
- **Errors as data.** `execute` throws on a bad argument or result; `formatted().execute` returns `{ error }` instead. In a model loop you usually want the latter, so one malformed call goes back to the model to fix rather than throwing.
- **JSON Schema targets.** `{ target: 'draft-2020-12' }` fits OpenAI and Anthropic; use `'openapi-3.0'` for consumers that want the OpenAPI subset (such as Gemini), or `'draft-07'`.
- **Per-call context.** Pass data the model shouldn't see (an auth token, tenant, locale) as the second argument to `execute(input, meta)`. It's never validated and never in the JSON Schema.

## Links

- [README](./README.md) — the type, the API, and the OpenAI Responses + MCP-output sections
- [OVERVIEW](./OVERVIEW.md) — why this exists and how the provider/framework tool shapes compare
- [Standard Schema](https://standardschema.dev) · [Standard JSON Schema](https://standardschema.dev/json-schema)
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling) · [Anthropic tool use](https://platform.claude.com/docs/en/build-with-claude/tool-use) · [AI SDK tools](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)

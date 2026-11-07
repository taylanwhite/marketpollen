import OpenAI from 'openai';
import './auth.js'; // loads .env for local runs

// Cheap, current OpenAI model for pulling fields out of visit notes and
// business cards. Reads images and supports strict JSON answers.
export const EXTRACTION_MODEL = 'gpt-6-luna';

let client: OpenAI | null = null;

/** Returns a shared client, or null when OPENAI_API_KEY is not set. */
export function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

type Schema = Record<string, any>;

/**
 * OpenAI's strict JSON mode needs every property listed as required. Fields
 * that are optional in our schema become "may be null" instead.
 */
function strictSchema(schema: Schema): Schema {
  if (schema.type === 'array' && schema.items) return { ...schema, items: strictSchema(schema.items) };
  if (schema.type !== 'object' || !schema.properties) return schema;
  const required = new Set<string>(schema.required || []);
  const properties: Schema = {};
  for (const [key, prop] of Object.entries<Schema>(schema.properties)) {
    const inner = strictSchema(prop);
    if (required.has(key)) {
      properties[key] = inner;
    } else {
      properties[key] = {
        ...inner,
        type: [inner.type, 'null'],
        ...(inner.enum && { enum: [...inner.enum, null] }),
      };
    }
  }
  return { ...schema, properties, required: Object.keys(properties), additionalProperties: false };
}

/** Turns the nulls strict mode returns for missing fields back into "not set". */
function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== null) out[k] = dropNulls(v);
    return out;
  }
  return value;
}

/**
 * One model call that must answer with JSON matching `schema`.
 * Throws on a refusal or a cut-off answer instead of returning half a result.
 */
export async function extractJson<T>(
  openai: OpenAI,
  opts: {
    name: string;
    system: string;
    content: string | OpenAI.Chat.ChatCompletionContentPart[];
    schema: Schema;
  },
): Promise<T> {
  const response = await openai.chat.completions.create({
    model: EXTRACTION_MODEL,
    max_completion_tokens: 16000,
    reasoning_effort: 'medium',
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.content },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: opts.name, strict: true, schema: strictSchema(opts.schema) },
    },
  });
  const choice = response.choices[0];
  if (choice?.message?.refusal) throw new Error('AI declined to read this. Fill the fields in by hand.');
  if (choice?.finish_reason === 'length') throw new Error('AI answer was cut off. Try shorter notes.');
  const text = choice?.message?.content;
  if (!text) throw new Error('AI returned no answer');
  return dropNulls(JSON.parse(text)) as T;
}

/** Plain-English message for an error from the OpenAI API. */
export function aiErrorMessage(err: unknown): string {
  if (err instanceof OpenAI.RateLimitError) return 'AI is busy right now. Try again in a moment.';
  if (err instanceof OpenAI.AuthenticationError) return 'AI is not set up correctly (bad API key).';
  if (err instanceof OpenAI.APIError) return `AI request failed (${err.status ?? 'network'}): ${err.message}`;
  return err instanceof Error ? err.message : 'AI request failed';
}

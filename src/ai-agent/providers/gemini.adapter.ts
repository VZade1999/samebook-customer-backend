import { GoogleGenAI } from '@google/genai';
import Groq from 'groq-sdk';

// No default timeout on this SDK's own client — unlike Groq/Cerebras, a
// hung Gemini call would otherwise block the whole chat request
// indefinitely instead of falling through to the next provider tier.
const GEMINI_TIMEOUT_MS = 20_000;

// Translates between this app's existing OpenAI/Groq-shaped messages/tools
// (used everywhere else in ai-agent.service.ts) and Gemini's Content/Tool
// format, and normalizes Gemini's response back into a
// Groq.Chat.ChatCompletion-shaped object — so the rest of the chat loop
// (which reads completion.choices[0].message.{content,tool_calls} and
// completion.usage) never needs to know Gemini is involved at all.
export class GeminiRateLimitError extends Error {}

function toGeminiContents(
  messages: Groq.Chat.ChatCompletionMessageParam[],
): { systemInstruction?: string; contents: any[] } {
  let systemInstruction: string | undefined;
  const contents: any[] = [];
  // Gemini's functionResponse needs the function *name*, but our tool-result
  // messages only carry tool_call_id — recovered from the preceding
  // assistant turn's tool_calls.
  const callIdToName = new Map<string, string>();

  for (const msg of messages) {
    const anyMsg = msg as any;

    if (msg.role === 'system') {
      systemInstruction = typeof msg.content === 'string' ? msg.content : '';
      continue;
    }

    if (msg.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: String(msg.content ?? '') }] });
      continue;
    }

    if (msg.role === 'assistant') {
      if (anyMsg.tool_calls?.length) {
        const parts = anyMsg.tool_calls.map((tc: any) => {
          callIdToName.set(tc.id, tc.function.name);
          return {
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments || '{}'),
            },
            // Required by newer Gemini models on any functionCall part sent
            // back in a follow-up request — omitting it fails the whole
            // call with "Function call is missing a thought_signature".
            // Only present when this history entry originally came from
            // Gemini itself (see callGemini below); absent for tool calls
            // that happened while a different provider was serving the
            // conversation, which is fine — Gemini just won't have one to
            // echo back for those.
            ...(tc.thought_signature ? { thoughtSignature: tc.thought_signature } : {}),
          };
        });
        contents.push({ role: 'model', parts });
      } else {
        contents.push({ role: 'model', parts: [{ text: String(anyMsg.content ?? '') }] });
      }
      continue;
    }

    if (msg.role === 'tool') {
      const name = callIdToName.get(anyMsg.tool_call_id) || 'unknown_function';
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name, response: { output: String(anyMsg.content ?? '') } } }],
      });
      continue;
    }
  }

  return { systemInstruction, contents };
}

function toGeminiTools(tools: Groq.Chat.ChatCompletionTool[]) {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.function?.name,
        description: t.function?.description,
        // Gemini accepts a plain JSON-Schema object here (mutually
        // exclusive with its own `parameters` Schema-object format) — lets
        // the exact same tool definitions used for Groq/Cerebras work here
        // unmodified.
        parametersJsonSchema: t.function?.parameters,
      })),
    },
  ];
}

export async function callGemini(
  apiKey: string,
  model: string,
  messages: Groq.Chat.ChatCompletionMessageParam[],
  tools: Groq.Chat.ChatCompletionTool[],
): Promise<Groq.Chat.ChatCompletion> {
  const ai = new GoogleGenAI({ apiKey });
  const { systemInstruction, contents } = toGeminiContents(messages);

  let response;
  try {
    response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction,
        tools: toGeminiTools(tools),
        maxOutputTokens: 1024,
        temperature: 0.7,
        httpOptions: { timeout: GEMINI_TIMEOUT_MS },
      },
    });
  } catch (err: any) {
    const status = err?.status ?? err?.response?.status;
    const message = String(err?.message ?? '');
    if (status === 429 || /RESOURCE_EXHAUSTED|rate.?limit/i.test(message)) {
      throw new GeminiRateLimitError(message || 'Gemini rate limit');
    }
    throw err;
  }

  const functionCalls = response.functionCalls ?? [];
  // functionCalls is derived (in order) from the same parts array that
  // carries each call's thoughtSignature — correlate by position so it can
  // be echoed back on the next turn (see toGeminiContents above).
  const functionCallParts = (response.candidates?.[0]?.content?.parts ?? []).filter(
    (p: any) => p.functionCall,
  );
  const toolCalls = functionCalls.map((fc, i) => ({
    id: fc.id || `gemini_call_${i}_${Date.now()}`,
    type: 'function' as const,
    function: { name: fc.name || '', arguments: JSON.stringify(fc.args ?? {}) },
    thought_signature: functionCallParts[i]?.thoughtSignature,
  }));

  const promptTokens = response.usageMetadata?.promptTokenCount ?? 0;
  const completionTokens = response.usageMetadata?.responseTokenCount ?? 0;

  return {
    id: `gemini-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
        message: {
          role: 'assistant',
          content: toolCalls.length ? null : (response.text ?? ''),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  } as unknown as Groq.Chat.ChatCompletion;
}

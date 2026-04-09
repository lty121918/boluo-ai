import { requestUrl, type RequestUrlResponse } from "obsidian";
import type { ChatMessage, ChatRequest, StreamHandlers } from "./types";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function splitSystemMessages(messages: ChatMessage[]): { system: string; conversation: ChatMessage[] } {
  const systemParts: string[] = [];
  const conversation: ChatMessage[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(message.content);
      continue;
    }

    conversation.push(message);
  }

  return {
    system: systemParts.join("\n\n"),
    conversation
  };
}

function extractErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const directMessage = payload.message;
  if (typeof directMessage === "string" && directMessage.trim()) {
    return directMessage.trim();
  }

  const detail = payload.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }

  const error = payload.error;
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (isRecord(error) && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  return null;
}

function readErrorMessage(response: RequestUrlResponse): string {
  const fallback = `${response.status}`;
  const text = response.text;

  if (!text) {
    return fallback;
  }

  try {
    const message = extractErrorMessage(JSON.parse(text) as unknown);
    if (message) {
      return message;
    }
  } catch {
    // Fall back to the raw text when the body is not JSON.
  }

  return text;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The request was aborted.", "AbortError");
  }
}

function extractCompletionText(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }

  if (payload.type === "content_block_delta" && isRecord(payload.delta)) {
    return typeof payload.delta.text === "string" ? payload.delta.text : "";
  }

  if (Array.isArray(payload.content)) {
    return payload.content
      .map((part) => {
        if (!isRecord(part)) {
          return "";
        }

        return part.type === "text" && typeof part.text === "string" ? part.text : "";
      })
      .join("");
  }

  if (payload.type === "message" && Array.isArray(payload.content)) {
    return payload.content
      .map((part) => {
        if (!isRecord(part)) {
          return "";
        }

        return part.type === "text" && typeof part.text === "string" ? part.text : "";
      })
      .join("");
    }

  return "";
}

export async function streamClaudeChat(
  request: ChatRequest,
  handlers: StreamHandlers
): Promise<string> {
  const { system, conversation } = splitSystemMessages(request.messages);

  throwIfAborted(request.signal);

  const response = await requestUrl({
    url: `${trimTrailingSlash(request.provider.baseUrl)}/messages`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": request.provider.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: request.provider.model,
      system: system || undefined,
      messages: conversation.map((message) => ({
        role: message.role,
        content: message.content
      })),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: false
    }),
    throw: false
  });

  throwIfAborted(request.signal);

  if (response.status >= 400) {
    throw new Error(readErrorMessage(response));
  }

  const text = extractCompletionText(response.json as unknown);
  handlers.onToken(text);
  handlers.onComplete?.(text);
  return text;
}

import { requestUrl, type RequestUrlResponse } from "obsidian";
import type { ChatRequest, StreamHandlers } from "./types";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getAuthHeaders(apiKey: string): Record<string, string> {
  if (!apiKey.trim()) {
    return {
      "Content-Type": "application/json"
    };
  }

  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

function extractTextPart(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (isRecord(part)) {
          return typeof part.text === "string" ? part.text : "";
        }

        return "";
      })
      .join("");
  }

  return "";
}

function extractCompletionText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    return "";
  }

  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice)) {
    return "";
  }

  const message = firstChoice.message;
  if (isRecord(message)) {
    return extractTextPart(message.content);
  }

  const delta = firstChoice.delta;
  if (isRecord(delta)) {
    return extractTextPart(delta.content);
  }

  return "";
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

function shouldRetryWithTemperatureOne(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase();
  return normalized.includes("temperature") && normalized.includes("only 1 is allowed");
}

async function createOpenAIResponse(
  request: ChatRequest,
  temperature: number
): Promise<RequestUrlResponse> {
  throwIfAborted(request.signal);

  const response = await requestUrl({
    url: `${trimTrailingSlash(request.provider.baseUrl)}/chat/completions`,
    method: "POST",
    headers: getAuthHeaders(request.provider.apiKey),
    body: JSON.stringify({
      model: request.provider.model,
      messages: request.messages,
      temperature,
      max_tokens: request.maxTokens,
      stream: false
    }),
    throw: false
  });

  throwIfAborted(request.signal);
  return response;
}

export async function streamOpenAIChat(
  request: ChatRequest,
  handlers: StreamHandlers
): Promise<string> {
  let response = await createOpenAIResponse(request, request.temperature);

  if (response.status >= 400) {
    const errorMessage = readErrorMessage(response);

    if (request.temperature !== 1 && shouldRetryWithTemperatureOne(errorMessage)) {
      response = await createOpenAIResponse(request, 1);
    } else {
      throw new Error(errorMessage);
    }
  }

  if (response.status >= 400) {
    throw new Error(readErrorMessage(response));
  }

  const text = extractCompletionText(response.json as unknown);
  handlers.onToken(text);
  handlers.onComplete?.(text);
  return text;
}

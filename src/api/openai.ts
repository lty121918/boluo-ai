import type { ChatRequest, StreamHandlers } from "./types";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getAuthHeaders(apiKey: string): HeadersInit {
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

        if (part && typeof part === "object" && "text" in part) {
          return typeof part.text === "string" ? part.text : "";
        }

        return "";
      })
      .join("");
  }

  return "";
}

function extractStreamToken(payload: any): string {
  const delta = payload?.choices?.[0]?.delta?.content;
  return extractTextPart(delta);
}

function extractCompletionText(payload: any): string {
  return extractTextPart(payload?.choices?.[0]?.message?.content);
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`;

  try {
    const text = await response.text();
    if (!text) {
      return fallback;
    }

    try {
      const payload = JSON.parse(text);
      const message =
        payload?.error?.message ??
        payload?.message ??
        payload?.detail ??
        payload?.error;

      if (typeof message === "string" && message.trim()) {
        return message.trim();
      }
    } catch {
      // Fall back to the raw text when the body is not JSON.
    }

    return text;
  } catch {
    return fallback;
  }
}

function shouldRetryWithTemperatureOne(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase();
  return normalized.includes("temperature") && normalized.includes("only 1 is allowed");
}

async function createOpenAIResponse(request: ChatRequest, temperature: number): Promise<Response> {
  return fetch(`${trimTrailingSlash(request.provider.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: getAuthHeaders(request.provider.apiKey),
    signal: request.signal,
    body: JSON.stringify({
      model: request.provider.model,
      messages: request.messages,
      temperature,
      max_tokens: request.maxTokens,
      stream: true
    })
  });
}

export async function streamOpenAIChat(
  request: ChatRequest,
  handlers: StreamHandlers
): Promise<string> {
  let response = await createOpenAIResponse(request, request.temperature);

  if (!response.ok) {
    const errorMessage = await readErrorMessage(response);

    if (request.temperature !== 1 && shouldRetryWithTemperatureOne(errorMessage)) {
      response = await createOpenAIResponse(request, 1);
    } else {
      throw new Error(errorMessage);
    }
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  if (!response.body) {
    const json = await response.json();
    const text = extractCompletionText(json);
    handlers.onToken(text);
    handlers.onComplete?.(text);
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    const pendingLines = done && buffer ? [...lines, buffer] : lines;

    if (done) {
      buffer = "";
    }

    for (const rawLine of pendingLines) {
      const line = rawLine.trim();

      if (!line.startsWith("data:")) {
        continue;
      }

      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") {
        continue;
      }

      const token = extractStreamToken(JSON.parse(data));
      if (!token) {
        continue;
      }

      fullText += token;
      handlers.onToken(token);
    }

    if (done) {
      break;
    }
  }

  handlers.onComplete?.(fullText);
  return fullText;
}

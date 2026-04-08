import type { ChatMessage, ChatRequest, StreamHandlers } from "./types";

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

function extractTextDelta(payload: any): string {
  if (payload?.type === "content_block_delta") {
    return typeof payload?.delta?.text === "string" ? payload.delta.text : "";
  }

  if (payload?.type === "message") {
    const content = payload?.content;
    if (Array.isArray(content)) {
      return content
        .map((part) => (part?.type === "text" && typeof part?.text === "string" ? part.text : ""))
        .join("");
    }
  }

  return "";
}

export async function streamClaudeChat(
  request: ChatRequest,
  handlers: StreamHandlers
): Promise<string> {
  const { system, conversation } = splitSystemMessages(request.messages);
  const response = await fetch(`${trimTrailingSlash(request.provider.baseUrl)}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": request.provider.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    signal: request.signal,
    body: JSON.stringify({
      model: request.provider.model,
      system: system || undefined,
      messages: conversation.map((message) => ({
        role: message.role,
        content: message.content
      })),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  if (!response.body) {
    const json = await response.json();
    const text = extractTextDelta(json);
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

    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    const pendingChunks = done && buffer ? [...chunks, buffer] : chunks;

    if (done) {
      buffer = "";
    }

    for (const chunk of pendingChunks) {
      const lines = chunk.split(/\r?\n/);
      let data = "";

      for (const line of lines) {
        if (line.startsWith("data:")) {
          data += line.slice(5).trim();
        }
      }

      if (!data) {
        continue;
      }

      const payload = JSON.parse(data);
      const token = extractTextDelta(payload);

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

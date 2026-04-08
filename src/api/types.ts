export type ProviderType = "openai" | "claude";
export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface PluginSettings {
  providers: ProviderConfig[];
  activeProviderId: string;
  attachCurrentNoteByDefault: boolean;
  autoApplyCurrentNoteEdits: boolean;
  hasOpenedChatOnce: boolean;
}

export interface ChatRequest {
  provider: ProviderConfig;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface StreamHandlers {
  onToken: (token: string) => void;
  onComplete?: (fullText: string) => void;
}

import { MarkdownRenderer, type App, type Component } from "obsidian";
import type { ChatRole } from "../api/types";

export interface RenderableMessage {
  id: string;
  role: ChatRole;
  content: string;
  isStreaming?: boolean;
  canRegenerate?: boolean;
  canReplaceCurrentNote?: boolean;
}

interface ChatMessageOptions {
  app: App;
  component: Component;
  message: RenderableMessage;
  onCopy?: (message: RenderableMessage) => void;
  onInsert?: (message: RenderableMessage) => void;
  onRegenerate?: (message: RenderableMessage) => void;
  onReplaceCurrentNote?: (message: RenderableMessage) => void;
}

export class ChatMessageView {
  private readonly containerEl: HTMLElement;
  private readonly bubbleEl: HTMLElement;
  private readonly footerMetaEl: HTMLElement;
  private readonly contentEl: HTMLElement;
  private readonly streamingEl: HTMLPreElement;
  private copyButton?: HTMLButtonElement;
  private insertButton?: HTMLButtonElement;
  private regenerateButton?: HTMLButtonElement;
  private replaceNoteButton?: HTMLButtonElement;
  private message: RenderableMessage;

  constructor(parentEl: HTMLElement, private readonly options: ChatMessageOptions) {
    this.message = options.message;

    this.containerEl = parentEl.createDiv({
      cls: `obsidian-ai-message obsidian-ai-message-${this.message.role}`
    });

    this.bubbleEl = this.containerEl.createDiv({ cls: "obsidian-ai-message-bubble" });
    this.contentEl = this.bubbleEl.createDiv({ cls: "obsidian-ai-message-content" });
    this.streamingEl = this.contentEl.createEl("pre", {
      cls: "obsidian-ai-streaming"
    });

    const footerEl = this.containerEl.createDiv({ cls: "obsidian-ai-message-footer" });
    this.footerMetaEl = footerEl.createDiv({ cls: "obsidian-ai-message-footer-meta" });

    if (this.message.role === "assistant") {
      const actionsEl = footerEl.createDiv({ cls: "obsidian-ai-message-actions" });
      this.copyButton = actionsEl.createEl("button", {
        text: "复制"
      });
      this.copyButton.addEventListener("click", () => this.options.onCopy?.(this.message));

      this.insertButton = actionsEl.createEl("button", {
        text: "插入"
      });
      this.insertButton.addEventListener("click", () => this.options.onInsert?.(this.message));

      this.regenerateButton = actionsEl.createEl("button", {
        text: "重试"
      });
      this.regenerateButton.addEventListener("click", () => this.options.onRegenerate?.(this.message));

      this.replaceNoteButton = actionsEl.createEl("button", {
        text: "写回笔记"
      });
      this.replaceNoteButton.addEventListener("click", () => this.options.onReplaceCurrentNote?.(this.message));
    }
  }

  async render(): Promise<void> {
    this.containerEl.classList.toggle("obsidian-ai-message-streaming", !!this.message.isStreaming);
    this.footerMetaEl.setText(this.getFooterMeta());
    this.refreshActionState();

    if (this.message.isStreaming) {
      this.contentEl.empty();
      this.streamingEl.textContent = this.message.content || " ";
      this.contentEl.appendChild(this.streamingEl);
      return;
    }

    this.contentEl.empty();
    await MarkdownRenderer.render(
      this.options.app,
      this.message.content || "_空回复_",
      this.contentEl,
      "",
      this.options.component
    );
  }

  async update(message: RenderableMessage): Promise<void> {
    this.message = message;
    await this.render();
  }

  private refreshActionState(): void {
    const disabled = this.message.isStreaming || this.message.content.trim().length === 0;
    if (this.copyButton) {
      this.copyButton.disabled = disabled;
    }

    if (this.insertButton) {
      this.insertButton.disabled = disabled;
    }

    if (this.regenerateButton) {
      this.regenerateButton.disabled = this.message.isStreaming || !this.message.canRegenerate;
    }

    if (this.replaceNoteButton) {
      this.replaceNoteButton.disabled = this.message.isStreaming || !this.message.canReplaceCurrentNote;
    }
  }

  private getRoleLabel(): string {
    if (this.message.role === "assistant") {
      return "AI";
    }

    if (this.message.role === "user") {
      return "You";
    }

    return "Context";
  }

  private getFooterMeta(): string {
    const timestamp = this.getTimestamp();
    const tokenText = `约 ${this.estimateTokens()} tokens`;
    return `${this.getRoleLabel()} · ${timestamp} · ${tokenText}`;
  }

  private getTimestamp(): string {
    const createdAt = Number.parseInt(this.message.id.split("-")[0], 10);
    if (Number.isNaN(createdAt)) {
      return "--:--";
    }

    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(createdAt));
  }

  private estimateTokens(): number {
    const text = this.message.content.trim();
    if (!text) {
      return 0;
    }

    const cjkChars = (text.match(/[\u4E00-\u9FFF]/g) ?? []).length;
    const latinWords = text
      .replace(/[\u4E00-\u9FFF]/g, " ")
      .split(/\s+/)
      .filter(Boolean).length;
    return Math.max(1, Math.round(cjkChars * 0.75 + latinWords * 1.3));
  }
}

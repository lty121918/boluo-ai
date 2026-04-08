import {
  type EditorPosition,
  ItemView,
  MarkdownView,
  Notice,
  normalizePath,
  setIcon,
  TFile,
  type WorkspaceLeaf
} from "obsidian";
import { applyNoteEditPlan, parseNoteEditPlan } from "../actions/NoteEdits";
import type { ChatMessage } from "../api/types";
import { ChatMessageView, type RenderableMessage } from "./ChatMessage";
import type ObsidianAIAssistantPlugin from "../main";

export const CHAT_VIEW_TYPE = "boluo-ai-chat";
const MAX_NOTE_CONTEXT_CHARS = 12000;
type StatusKind = "info" | "error" | "success";
const NOTE_EDIT_KEYWORDS = [
  "添加",
  "加上",
  "加入",
  "加到",
  "补充",
  "补到",
  "补全",
  "更新",
  "修改",
  "改一下",
  "改成",
  "改写",
  "重写",
  "润色",
  "优化这篇",
  "整理",
  "替换",
  "删除",
  "删掉",
  "移除",
  "修正",
  "纠正",
  "插入",
  "写进",
  "写入",
  "写到",
  "记到",
  "记在",
  "插到",
  "合并到笔记",
  "同步到笔记",
  "append",
  "add ",
  "update ",
  "modify ",
  "edit ",
  "rewrite",
  "revise",
  "polish",
  "replace",
  "delete",
  "remove",
  "insert "
];
const NOTE_QUERY_KEYWORDS = ["总结", "总结一下", "解释", "分析", "是什么", "为什么", "读一下", "看看", "summarize", "explain", "analyze", "what", "why", "read"];
const SELECTION_EDIT_KEYWORDS = [
  "优化",
  "润色",
  "翻译",
  "改写",
  "修改",
  "重写",
  "简化",
  "压缩",
  "扩写",
  "续写",
  "polish",
  "rewrite",
  "translate",
  "revise",
  "edit"
];

interface SelectionAttachment {
  filePath: string;
  fileName: string;
  originalText: string;
  editableText: string;
  from: EditorPosition;
  to: EditorPosition;
}

function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export class ChatView extends ItemView {
  private messages: RenderableMessage[] = [];
  private messageViews = new Map<string, ChatMessageView>();
  private attachCurrentNote = false;
  private contextFile: TFile | null = null;
  private sending = false;
  private headerEl!: HTMLElement;
  private workspaceEl!: HTMLElement;
  private messagesEl!: HTMLElement;
  private composerEl!: HTMLElement;
  private composerMetaEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendButton!: HTMLButtonElement;
  private cancelButton!: HTMLButtonElement;
  private clearButton!: HTMLButtonElement;
  private undoEditButton!: HTMLButtonElement;
  private settingsButton!: HTMLButtonElement;
  private providerMetaEl!: HTMLElement;
  private emptyStateEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private statusTextEl!: HTMLElement;
  private noteContextRowEl!: HTMLElement;
  private noteChipEl!: HTMLElement;
  private noteChipLabelEl!: HTMLElement;
  private noteChipRemoveButton!: HTMLButtonElement;
  private attachNoteButton!: HTMLButtonElement;
  private selectionChipEl!: HTMLElement;
  private selectionChipLabelEl!: HTMLElement;
  private selectionChipRemoveButton!: HTMLButtonElement;
  private requestAbortController: AbortController | null = null;
  private statusTimeout: number | null = null;
  private selectionSyncFrame: number | null = null;
  private lastSelectionSignature = "";
  private lastAppliedEdit: { path: string; previousContent: string } | null = null;
  private selectionAttachment: SelectionAttachment | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: ObsidianAIAssistantPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Boluo AI";
  }

  getIcon(): string {
    return "messages-square";
  }

  async onOpen(): Promise<void> {
    this.attachCurrentNote = this.plugin.settings.attachCurrentNoteByDefault;
    this.updateContextFileFromWorkspace();
    this.render();
    this.renderMessages();
    this.refreshControls();
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.updateContextFileFromWorkspace();
        this.scheduleSelectionSync();
        this.syncMessageActionState();
      })
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.updateContextFileFromWorkspace();
        this.scheduleSelectionSync();
        this.syncMessageActionState();
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", () => {
        this.scheduleSelectionSync();
      })
    );
    this.registerDomEvent(document, "selectionchange", () => {
      this.scheduleSelectionSync();
    });
    this.refreshActiveNoteChip();
    this.scheduleSelectionSync();
  }

  async onClose(): Promise<void> {
    this.cancelCurrentRequest();
    this.clearStatusTimer();
    this.clearSelectionSyncFrame();
    this.messages = [];
    this.messageViews.clear();
    this.containerEl.empty();
  }

  async refreshFromSettings(): Promise<void> {
    if (!this.headerEl) {
      return;
    }

    this.attachCurrentNote = this.plugin.settings.attachCurrentNoteByDefault;
    this.updateContextFileFromWorkspace();
    this.captureSelectionFromWorkspace();
    this.refreshControls();
    this.refreshActiveNoteChip();
    this.refreshSelectionAttachment();
    this.syncMessageActionState();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("obsidian-ai-view");

    this.headerEl = container.createDiv({ cls: "obsidian-ai-toolbar" });
    this.renderToolbar();

    this.workspaceEl = container.createDiv({ cls: "obsidian-ai-workspace" });
    this.messagesEl = this.workspaceEl.createDiv({ cls: "obsidian-ai-messages" });
    this.emptyStateEl = this.createEmptyState(this.messagesEl);

    this.composerEl = container.createDiv({ cls: "obsidian-ai-composer" });
    this.renderComposer();
  }

  private renderToolbar(): void {
    this.headerEl.empty();

    const toolbarShell = this.headerEl.createDiv({ cls: "obsidian-ai-toolbar-shell" });
    const brandEl = toolbarShell.createDiv({ cls: "obsidian-ai-toolbar-brand" });
    const markEl = brandEl.createDiv({ cls: "obsidian-ai-toolbar-mark" });
    markEl.setAttr("aria-hidden", "true");
    const logoPath = normalizePath(
      `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}/boluo-logo.svg`
    );
    const logoEl = markEl.createEl("img", {
      cls: "obsidian-ai-toolbar-logo"
    });
    logoEl.src = this.app.vault.adapter.getResourcePath(logoPath);
    logoEl.alt = "Boluo logo";
    const titleWrapEl = brandEl.createDiv({ cls: "obsidian-ai-toolbar-title-wrap" });
    titleWrapEl.createDiv({
      cls: "obsidian-ai-toolbar-title",
      text: "Boluo AI"
    });
    this.providerMetaEl = titleWrapEl.createDiv({
      cls: "obsidian-ai-provider-meta"
    });

    const actionsEl = toolbarShell.createDiv({ cls: "obsidian-ai-toolbar-actions" });

    this.settingsButton = actionsEl.createEl("button");
    this.settingsButton.addClass("obsidian-ai-toolbar-button");
    this.settingsButton.setAttr("aria-label", "打开设置");
    this.settingsButton.setAttr("title", "打开设置");
    setIcon(this.settingsButton, "settings-2");
    this.settingsButton.addEventListener("click", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.app as any).setting.open();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.app as any).setting.openTabById(this.plugin.manifest.id);
    });

    this.clearButton = actionsEl.createEl("button");
    this.clearButton.addClass("obsidian-ai-toolbar-button");
    this.clearButton.setAttr("aria-label", "清空会话");
    this.clearButton.setAttr("title", "清空会话");
    setIcon(this.clearButton, "trash-2");
    this.clearButton.addEventListener("click", () => this.clearConversation());

    this.undoEditButton = actionsEl.createEl("button");
    this.undoEditButton.addClass("obsidian-ai-toolbar-button");
    this.undoEditButton.setAttr("aria-label", "撤销上次编辑");
    this.undoEditButton.setAttr("title", "撤销上次编辑");
    setIcon(this.undoEditButton, "rotate-ccw");
    this.undoEditButton.addEventListener("click", () => void this.undoLastAppliedEdit());
  }

  private renderComposer(): void {
    this.noteContextRowEl = this.composerEl.createDiv({
      cls: "obsidian-ai-note-context obsidian-ai-button-hidden"
    });
    this.noteChipEl = this.noteContextRowEl.createDiv({ cls: "obsidian-ai-note-chip" });
    this.noteChipEl.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("button")) {
        return;
      }

      void this.openContextFile();
    });
    const noteIconEl = this.noteChipEl.createSpan({ cls: "obsidian-ai-note-chip-icon" });
    setIcon(noteIconEl, "file-text");
    this.noteChipLabelEl = this.noteChipEl.createSpan({ cls: "obsidian-ai-note-chip-label" });
    this.noteChipRemoveButton = this.noteChipEl.createEl("button", {
      cls: "clickable-icon",
      text: "×"
    });
    this.noteChipRemoveButton.addEventListener("click", async () => {
      this.attachCurrentNote = false;
      this.plugin.settings.attachCurrentNoteByDefault = false;
      await this.plugin.saveSettings();
      this.refreshActiveNoteChip();
      this.refreshControls();
    });
    this.attachNoteButton = this.noteContextRowEl.createEl("button", {
      cls: "obsidian-ai-attach-note-button obsidian-ai-button-hidden",
      text: "附带当前笔记"
    });
    this.attachNoteButton.addEventListener("click", async () => {
      if (!this.getContextFile()) {
        return;
      }

      this.attachCurrentNote = true;
      this.plugin.settings.attachCurrentNoteByDefault = true;
      await this.plugin.saveSettings();
      this.refreshActiveNoteChip();
      this.refreshControls();
    });

    this.selectionChipEl = this.noteContextRowEl.createDiv({
      cls: "obsidian-ai-note-chip obsidian-ai-selection-chip obsidian-ai-button-hidden"
    });
    const selectionIconEl = this.selectionChipEl.createSpan({
      cls: "obsidian-ai-note-chip-icon"
    });
    setIcon(selectionIconEl, "lock");
    this.selectionChipLabelEl = this.selectionChipEl.createSpan({
      cls: "obsidian-ai-note-chip-label"
    });
    this.selectionChipRemoveButton = this.selectionChipEl.createEl("button", {
      cls: "clickable-icon",
      text: "×"
    });
    this.selectionChipRemoveButton.addEventListener("click", () => {
      this.selectionAttachment = null;
      this.lastSelectionSignature = "";
      this.refreshSelectionAttachment();
      this.refreshControls();
    });

    this.statusEl = this.composerEl.createDiv({
      cls: "obsidian-ai-status obsidian-ai-status-hidden"
    });
    this.statusEl.setAttr("aria-live", "polite");
    this.statusTextEl = this.statusEl.createDiv({ cls: "obsidian-ai-status-text" });

    this.inputEl = this.composerEl.createEl("textarea", {
      cls: "obsidian-ai-input",
      attr: {
        placeholder: "How can I help you today?"
      }
    });
    this.inputEl.rows = 4;
    this.inputEl.addEventListener("input", () => {
      this.resizeInput();
    });
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void this.handleSend();
      }
    });

    const footerEl = this.composerEl.createDiv({ cls: "obsidian-ai-composer-footer" });
    this.composerMetaEl = footerEl.createDiv({ cls: "obsidian-ai-composer-meta-line" });
    const actionsEl = footerEl.createDiv({ cls: "obsidian-ai-composer-actions" });
    this.cancelButton = actionsEl.createEl("button", {
      cls: "obsidian-ai-stop-button"
    });
    this.cancelButton.setAttr("aria-label", "停止当前生成");
    this.cancelButton.setAttr("title", "停止当前生成");
    const stopIconEl = this.cancelButton.createSpan({
      cls: "obsidian-ai-stop-button-icon"
    });
    setIcon(stopIconEl, "square");
    this.cancelButton.createSpan({
      cls: "obsidian-ai-stop-button-label",
      text: "停止生成"
    });
    this.cancelButton.addEventListener("click", () => this.cancelCurrentRequest());
    this.sendButton = actionsEl.createEl("button", {
      cls: "obsidian-ai-send-button",
    });
    this.sendButton.setAttr("aria-label", "发送");
    this.sendButton.setAttr("title", "发送");
    setIcon(this.sendButton, "arrow-up");
    this.sendButton.addEventListener("click", () => void this.handleSend());
    this.resizeInput();
  }

  private refreshControls(): void {
    const provider = this.plugin.getActiveProvider();
    this.inputEl.disabled = !provider || this.sending;
    this.sendButton.disabled = !provider || this.sending;
    this.clearButton.disabled = this.sending || this.messages.length === 0;
    this.undoEditButton.disabled = this.sending || this.lastAppliedEdit === null;
    this.cancelButton.disabled = !this.sending;
    this.cancelButton.classList.toggle("obsidian-ai-button-hidden", !this.sending);
    this.sendButton.classList.toggle("obsidian-ai-button-hidden", this.sending);

    if (provider) {
      const noteMode = this.attachCurrentNote
        ? this.plugin.settings.autoApplyCurrentNoteEdits
          ? "附带当前笔记 · 自动写回"
          : "附带当前笔记"
        : "仅对话";
      const hasSelectionAttachment =
        this.selectionAttachment !== null &&
        this.selectionAttachment.editableText.trim().length > 0;
      this.providerMetaEl.setText(`${provider.name}${provider.model ? ` · ${provider.model}` : ""}`);
      this.composerMetaEl.setText(
        `${noteMode}${hasSelectionAttachment ? " · 已附带所选内容" : ""}`
      );
    } else {
      this.providerMetaEl.setText("");
      this.composerMetaEl.setText("先在设置中配置可用的 Provider");
    }

    if (!provider) {
      this.inputEl.placeholder = "先在设置中添加至少一个 Provider";
    } else if (provider.model.trim().length === 0) {
      this.inputEl.placeholder = "先填写模型名，再开始发送";
    } else {
      this.inputEl.placeholder = "输入问题，Enter 发送，Shift+Enter 换行";
    }

    this.refreshActiveNoteChip();
    this.refreshSelectionAttachment();
  }

  private renderMessages(): void {
    this.syncRegenerateFlags(false);
    this.messagesEl.empty();
    this.messageViews.clear();

    if (this.messages.length === 0) {
      this.emptyStateEl = this.createEmptyState(this.messagesEl);
      return;
    }

    for (const message of this.messages) {
      void this.mountMessageView(message);
    }
  }

  private async mountMessageView(message: RenderableMessage): Promise<void> {
    const view = new ChatMessageView(this.messagesEl, {
      app: this.app,
      component: this,
      message,
      onCopy: (currentMessage) => void this.copyMessage(currentMessage),
      onInsert: (currentMessage) => void this.insertMessageIntoNote(currentMessage),
      onRegenerate: (currentMessage) => void this.handleRegenerate(currentMessage),
      onReplaceCurrentNote: (currentMessage) => void this.replaceCurrentNote(currentMessage)
    });

    this.messageViews.set(message.id, view);
    await view.render();
    this.scrollToBottom();
  }

  private async updateMessage(messageId: string, updater: (message: RenderableMessage) => void): Promise<void> {
    const message = this.messages.find((item) => item.id === messageId);
    if (!message) {
      return;
    }

    updater(message);
    const view = this.messageViews.get(messageId);
    if (view) {
      await view.update(message);
      this.scrollToBottom();
    }
  }

  private scrollToBottom(): void {
    window.requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }

  private async handleSend(): Promise<void> {
    const content = this.inputEl.value.trim();
    if (!content || this.sending) {
      return;
    }

    await this.submitAssistantReply(content, {
      appendUserMessage: true,
      pendingStatus: "已发送消息，正在等待回复..."
    });
  }

  private async submitAssistantReply(
    content: string,
    options: {
      appendUserMessage: boolean;
      pendingStatus: string;
    }
  ): Promise<void> {
    const provider = this.plugin.getActiveProvider();
    if (!provider) {
      new Notice("请先在设置中配置 Provider。");
      return;
    }

    if (!provider.model.trim()) {
      new Notice("请先填写模型名称。");
      return;
    }

    this.sending = true;
    this.refreshControls();
    this.setStatus(`${options.pendingStatus} 当前 Provider：${provider.name}`, "info");

    const noteContext = await this.getAttachedNoteContext();
    const selectionAttachment = this.getSelectionAttachment();
    const shouldAutoApplySelectionEdit = this.shouldAutoApplySelectionEdit(content, selectionAttachment);
    const shouldAutoApplyNoteEdit = this.shouldAutoApplyNoteEdit(content, noteContext);
    const shouldApplyNoteEdit = !shouldAutoApplySelectionEdit && shouldAutoApplyNoteEdit;

    if (shouldAutoApplySelectionEdit) {
      this.setStatus("检测到选中文本编辑请求，完成后会直接替换原选区。", "info");
    } else if (shouldApplyNoteEdit) {
      this.setStatus("检测到笔记编辑请求，完成后会直接更新当前笔记。", "info");
    }

    if (options.appendUserMessage) {
      this.inputEl.value = "";
      this.resizeInput();
      const userMessage: RenderableMessage = {
        id: createMessageId(),
        role: "user",
        content
      };
      this.messages.push(userMessage);
      await this.mountMessageView(userMessage);
    }

    const assistantMessage: RenderableMessage = {
      id: createMessageId(),
      role: "assistant",
      content: "",
      isStreaming: true
    };
    this.messages.push(assistantMessage);
    this.syncRegenerateFlags();
    await this.mountMessageView(assistantMessage);

    const requestAbortController = new AbortController();
    this.requestAbortController = requestAbortController;
    let fullText = "";

    try {
      const requestMessages = this.buildRequestMessages(
        assistantMessage.id,
        noteContext,
        shouldApplyNoteEdit,
        selectionAttachment,
        shouldAutoApplySelectionEdit
      );

      await this.plugin.streamChat(
        {
          provider,
          messages: requestMessages,
          temperature: provider.temperature,
          maxTokens: provider.maxTokens,
          signal: requestAbortController.signal
        },
        {
          onToken: (token) => {
            if (!fullText) {
              this.setStatus(
                shouldAutoApplySelectionEdit
                  ? "正在生成并替换选中文本..."
                  : shouldApplyNoteEdit
                    ? "正在生成编辑指令并应用到笔记..."
                    : "正在生成回复...",
                "info"
              );
            }

            fullText += token;
            void this.updateMessage(assistantMessage.id, (message) => {
              message.content = shouldAutoApplySelectionEdit
                ? "_正在生成并替换选中文本..._"
                : shouldApplyNoteEdit
                  ? "_正在生成编辑指令并应用到当前笔记..._"
                  : fullText;
              message.isStreaming = true;
            });
          },
          onComplete: () => {
            if (shouldAutoApplySelectionEdit && selectionAttachment && fullText.trim().length > 0) {
              void this.finalizeAutoAppliedSelectionEdit(
                assistantMessage.id,
                selectionAttachment,
                fullText
              );
              return;
            }

            if (shouldApplyNoteEdit && noteContext && fullText.trim().length > 0) {
              void this.finalizeAutoAppliedNoteEdit(
                assistantMessage.id,
                noteContext.file,
                noteContext.content,
                fullText
              );
              return;
            }

            void this.updateMessage(assistantMessage.id, (message) => {
              message.content = fullText;
              message.isStreaming = false;
            });
            this.syncRegenerateFlags();
            this.setStatus("回复完成。", "success", 2500);
          }
        }
      );
    } catch (error) {
      if (this.isAbortError(error) || requestAbortController.signal.aborted) {
        const cancelledContent = fullText.trim().length > 0 ? `${fullText}\n\n_已停止生成。_` : "_已取消当前请求。_";
        void this.updateMessage(assistantMessage.id, (item) => {
          item.content = cancelledContent;
          item.isStreaming = false;
        });
        this.syncRegenerateFlags();
        this.setStatus("已取消当前请求。", "info", 2500);
      } else {
        const message = error instanceof Error ? error.message : "未知错误";
        const errorContent = fullText.trim().length > 0 ? `${fullText}\n\n> 请求失败：${message}` : `请求失败：${message}`;
        void this.updateMessage(assistantMessage.id, (item) => {
          item.content = errorContent;
          item.isStreaming = false;
        });
        this.syncRegenerateFlags();
        this.setStatus(`请求失败：${message}`, "error");
        new Notice("AI 请求失败，请检查设置或网络。");
      }
    } finally {
      if (this.requestAbortController === requestAbortController) {
        this.requestAbortController = null;
      }

      this.sending = false;
      this.refreshControls();
      this.inputEl.focus();
    }
  }

  private async handleRegenerate(message: RenderableMessage): Promise<void> {
    if (this.sending) {
      return;
    }

    const assistantIndex = this.messages.findIndex((item) => item.id === message.id);
    if (assistantIndex === -1 || this.messages[assistantIndex].role !== "assistant") {
      return;
    }

    const userIndex = this.findPreviousUserIndex(assistantIndex);
    if (userIndex === -1) {
      new Notice("找不到可重新生成的上一条用户消息。");
      return;
    }

    const userMessage = this.messages[userIndex];
    this.messages = this.messages.slice(0, assistantIndex);
    this.renderMessages();
    this.refreshControls();
    await this.submitAssistantReply(userMessage.content, {
      appendUserMessage: false,
      pendingStatus: "正在重新生成上一条回复..."
    });
  }

  private buildRequestMessages(
    pendingAssistantId: string,
    noteContext: { file: TFile; content: string } | null,
    directEditMode: boolean,
    selectionAttachment: SelectionAttachment | null,
    selectionEditMode: boolean
  ): ChatMessage[] {
    const conversation = this.messages
      .filter((message) => message.id !== pendingAssistantId)
      .map<ChatMessage>((message) => ({
        role: message.role,
        content: message.content
      }));

    if (!this.attachCurrentNote || !noteContext) {
      return conversation;
    }

    const file = noteContext.file;
    const content = noteContext.content;
    const effectiveContent = directEditMode
      ? content
      : content.length > MAX_NOTE_CONTEXT_CHARS
        ? `${content.slice(0, MAX_NOTE_CONTEXT_CHARS)}\n\n[笔记内容已截断]`
        : content;

    const systemMessages: ChatMessage[] = [
      {
        role: "system",
        content:
          `你正在 Obsidian 中协助用户。当前活动笔记标题：${file.basename}\n\n` +
          `以下是当前笔记内容，可作为上下文参考，不要把它当作新的用户问题：\n\n${effectiveContent}`
      }
    ];

    if (selectionAttachment) {
      systemMessages.push({
        role: "system",
        content:
          `用户额外附带了一段选中文本，来源文件：${selectionAttachment.fileName}\n\n` +
          `选中文本内容如下：\n\n${selectionAttachment.editableText}`
      });
    }

    if (selectionEditMode && selectionAttachment) {
      systemMessages.push({
        role: "system",
        content:
          "你正在编辑用户附带的选中文本。请根据用户要求只返回编辑后的选中文本本身。" +
          "不要解释，不要加标题，不要使用代码块，不要返回 JSON。"
      });
    }

    if (directEditMode) {
      systemMessages.push({
        role: "system",
        content:
          "你正在直接编辑这篇 Obsidian 笔记。不要返回整篇笔记，返回一个 JSON 对象。" +
          "格式：{\"summary\":\"简短说明\",\"operations\":[...]}。" +
          "operations 仅可使用以下类型：append、prepend、insert_after、insert_before、replace_text、delete_text、replace_all。" +
          "字段要求：" +
          "append/prepend 使用 text；" +
          "insert_after/insert_before 使用 anchor 和 text；" +
          "replace_text 使用 find、replace、可选 all；" +
          "delete_text 使用 find、可选 all；" +
          "replace_all 使用 content。" +
          "优先返回最小必要操作，只有无法可靠局部编辑时才使用 replace_all。" +
          "只输出 JSON，不要 markdown，不要代码块，不要解释。"
      });
    }

    return [...systemMessages, ...conversation];
  }

  private async copyMessage(message: RenderableMessage): Promise<void> {
    await navigator.clipboard.writeText(message.content);
    new Notice("已复制到剪贴板。");
  }

  private async insertMessageIntoNote(message: RenderableMessage): Promise<void> {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = markdownView?.editor;

    if (!editor) {
      new Notice("当前没有可编辑的笔记。");
      return;
    }

    editor.replaceRange(message.content, editor.getCursor());
    new Notice("已插入到当前笔记。");
  }

  private async replaceCurrentNote(message: RenderableMessage): Promise<void> {
    const file = this.getContextFile();
    if (!file) {
      new Notice("当前没有可替换的活动笔记。");
      return;
    }

    await this.app.vault.modify(file, message.content);
    new Notice(`已替换笔记：${file.basename}`);
  }

  private clearConversation(): void {
    if (this.sending) {
      return;
    }

    this.messages = [];
    this.renderMessages();
    this.clearStatus();
    this.refreshControls();
    new Notice("已清空当前会话。");
  }

  private async undoLastAppliedEdit(): Promise<void> {
    if (!this.lastAppliedEdit) {
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(this.lastAppliedEdit.path);
    if (!(file instanceof TFile)) {
      new Notice("找不到要撤销编辑的笔记。");
      this.lastAppliedEdit = null;
      this.refreshControls();
      return;
    }

    await this.app.vault.modify(file, this.lastAppliedEdit.previousContent);
    this.lastAppliedEdit = null;
    this.refreshControls();
    this.setStatus("已撤销上次自动编辑。", "success", 2500);
    new Notice("已撤销上次自动编辑。");
  }

  private cancelCurrentRequest(): void {
    if (!this.requestAbortController || this.requestAbortController.signal.aborted) {
      return;
    }

    this.setStatus("正在取消当前请求...", "info");
    this.requestAbortController.abort();
  }

  private setStatus(message: string, kind: StatusKind, autoClearMs?: number): void {
    this.clearStatusTimer();
    this.statusEl.className = `obsidian-ai-status obsidian-ai-status-${kind}`;
    this.statusTextEl.setText(message);

    if (autoClearMs) {
      this.statusTimeout = window.setTimeout(() => {
        this.clearStatus();
      }, autoClearMs);
    }
  }

  private clearStatus(): void {
    this.clearStatusTimer();
    this.statusEl.className = "obsidian-ai-status obsidian-ai-status-hidden";
    this.statusTextEl.empty();
  }

  private clearStatusTimer(): void {
    if (this.statusTimeout !== null) {
      window.clearTimeout(this.statusTimeout);
      this.statusTimeout = null;
    }
  }

  private isAbortError(error: unknown): boolean {
    return (
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError")
    );
  }

  private findPreviousUserIndex(fromIndex: number): number {
    for (let index = fromIndex - 1; index >= 0; index -= 1) {
      if (this.messages[index].role === "user") {
        return index;
      }
    }

    return -1;
  }

  private syncRegenerateFlags(updateViews = true): void {
    let latestAssistantIndex = -1;

    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      if (this.messages[index].role === "assistant") {
        latestAssistantIndex = index;
        break;
      }
    }

    for (let index = 0; index < this.messages.length; index += 1) {
      const message = this.messages[index];
      if (message.role !== "assistant") {
        continue;
      }

      message.canRegenerate =
        index === latestAssistantIndex &&
        !message.isStreaming &&
        this.findPreviousUserIndex(index) !== -1;
      message.canReplaceCurrentNote =
        !message.isStreaming &&
        message.content.trim().length > 0 &&
        this.getContextFile() !== null;
    }

    if (updateViews) {
      this.syncMessageActionState();
    }
  }

  private syncMessageActionState(): void {
    const hasActiveFile = this.getContextFile() !== null;

    for (const message of this.messages) {
      if (message.role === "assistant") {
        message.canReplaceCurrentNote =
          !message.isStreaming &&
          message.content.trim().length > 0 &&
          hasActiveFile;
      }

      const view = this.messageViews.get(message.id);
      if (view) {
        void view.update(message);
      }
    }
  }

  private refreshActiveNoteChip(): void {
    const file = this.getContextFile();
    const hasFile = file !== null;
    const hasSelectionAttachment =
      (this.selectionAttachment?.editableText.trim().length ?? 0) > 0;
    this.noteContextRowEl.classList.toggle(
      "obsidian-ai-button-hidden",
      !hasFile && !hasSelectionAttachment
    );
    this.noteChipEl.classList.toggle("obsidian-ai-button-hidden", !this.attachCurrentNote || !hasFile);
    this.attachNoteButton.classList.toggle("obsidian-ai-button-hidden", this.attachCurrentNote || !hasFile);

    if (!hasFile || !file) {
      this.noteChipLabelEl.setText("");
      this.attachNoteButton.setText("附带当前笔记");
      return;
    }

    this.noteChipLabelEl.setText(file.basename);
    this.noteChipEl.setAttr("aria-label", `当前上下文笔记：${file.basename}`);
    this.attachNoteButton.setText(`将《${file.basename}》加入上下文`);
  }

  private createEmptyState(parentEl: HTMLElement): HTMLElement {
    const emptyEl = parentEl.createDiv({ cls: "obsidian-ai-empty-state" });
    emptyEl.createDiv({
      cls: "obsidian-ai-empty-title",
      text: "今天想写什么？"
    });
    emptyEl.createDiv({
      cls: "obsidian-ai-empty-meta",
      text: "从底部输入框开始，或先附带当前笔记后再发送。"
    });

    return emptyEl;
  }

  private getActiveMarkdownFile(): TFile | null {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    return markdownView?.file ?? null;
  }

  private getContextFile(): TFile | null {
    return this.contextFile;
  }

  private async getAttachedNoteContext(): Promise<{ file: TFile; content: string } | null> {
    if (!this.attachCurrentNote) {
      return null;
    }

    const file = this.getContextFile();
    if (!file) {
      return null;
    }

    return {
      file,
      content: await this.app.vault.read(file)
    };
  }

  private shouldAutoApplyNoteEdit(
    userInput: string,
    noteContext: { file: TFile; content: string } | null
  ): boolean {
    if (!this.plugin.settings.autoApplyCurrentNoteEdits) {
      return false;
    }

    if (!noteContext) {
      return false;
    }

    const normalized = userInput.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    const hasEditKeyword = NOTE_EDIT_KEYWORDS.some((keyword) => normalized.includes(keyword));
    const hasQueryKeyword = NOTE_QUERY_KEYWORDS.some((keyword) => normalized.includes(keyword));

    if (hasEditKeyword) {
      return true;
    }

    if (hasQueryKeyword) {
      return false;
    }

    return /帮我.*(改|加|补|删|写|更新)|请.*(修改|添加|补充|重写)|记到笔记|写到笔记/.test(userInput);
  }

  private async applyGeneratedNoteEdit(
    file: TFile,
    previousContent: string,
    nextContent: string
  ): Promise<{ ok: boolean; message: string }> {
    try {
      this.lastAppliedEdit = {
        path: file.path,
        previousContent
      };
      await this.app.vault.modify(file, nextContent);
      this.refreshControls();
      this.setStatus(`已直接更新笔记：${file.basename}。如不满意可撤销上次编辑。`, "success", 5000);
      new Notice(`已更新当前笔记：${file.basename}`);
      return {
        ok: true,
        message: `已更新当前笔记《${file.basename}》。如不满意可点击“撤销上次编辑”。`
      };
    } catch (error) {
      this.lastAppliedEdit = null;
      const message = error instanceof Error ? error.message : "未知错误";
      this.setStatus(`自动更新笔记失败：${message}`, "error");
      new Notice(`自动更新笔记失败：${message}`);
      return {
        ok: false,
        message
      };
    }
  }

  private async finalizeAutoAppliedNoteEdit(
    assistantMessageId: string,
    file: TFile,
    previousContent: string,
    nextContent: string
  ): Promise<void> {
    try {
      const plan = parseNoteEditPlan(nextContent);
      const updatedContent = applyNoteEditPlan(previousContent, plan);
      const result = await this.applyGeneratedNoteEdit(file, previousContent, updatedContent);

      if (result.ok) {
        const summary = plan.summary?.trim();
        await this.updateMessage(assistantMessageId, (message) => {
          message.content = summary
            ? `${result.message}\n\n本次修改：${summary}`
            : `${result.message}\n\n已直接写入笔记，不再展示整篇生成内容。`;
          message.isStreaming = false;
        });
        this.syncRegenerateFlags();
        return;
      }

      await this.updateMessage(assistantMessageId, (message) => {
        message.content = `自动更新笔记失败：${result.message}\n\n以下是模型返回的编辑指令，请手动检查：\n\n${nextContent}`;
        message.isStreaming = false;
      });
      this.syncRegenerateFlags();
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法解析编辑指令";
      await this.updateMessage(assistantMessageId, (item) => {
        item.content = `自动更新笔记失败：${message}\n\n以下是模型原始返回，请手动检查：\n\n${nextContent}`;
        item.isStreaming = false;
      });
      this.syncRegenerateFlags();
      this.setStatus(`自动更新笔记失败：${message}`, "error");
    }
  }

  private async finalizeAutoAppliedSelectionEdit(
    assistantMessageId: string,
    selectionAttachment: SelectionAttachment,
    nextText: string
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(selectionAttachment.filePath);
    if (!(file instanceof TFile)) {
      await this.updateMessage(assistantMessageId, (message) => {
        message.content = `自动替换选中文本失败：找不到原始文件。\n\n以下是生成结果：\n\n${nextText}`;
        message.isStreaming = false;
      });
      this.syncRegenerateFlags();
      return;
    }

    try {
      const previousContent = await this.app.vault.read(file);
      const updatedContent = this.replaceRangeInContent(
        previousContent,
        selectionAttachment.from,
        selectionAttachment.to,
        nextText
      );

      const result = await this.applyGeneratedNoteEdit(file, previousContent, updatedContent);
      if (result.ok) {
        await this.updateMessage(assistantMessageId, (message) => {
          message.content = `${result.message}\n\n已直接替换原选中文本。`;
          message.isStreaming = false;
        });
        this.selectionAttachment = null;
        this.lastSelectionSignature = "";
        this.refreshSelectionAttachment();
        this.syncRegenerateFlags();
        return;
      }

      await this.updateMessage(assistantMessageId, (message) => {
        message.content = `自动替换选中文本失败：${result.message}\n\n以下是生成结果：\n\n${nextText}`;
        message.isStreaming = false;
      });
      this.syncRegenerateFlags();
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法替换选中文本";
      await this.updateMessage(assistantMessageId, (item) => {
        item.content = `自动替换选中文本失败：${message}\n\n以下是生成结果：\n\n${nextText}`;
        item.isStreaming = false;
      });
      this.syncRegenerateFlags();
      this.setStatus(`自动替换选中文本失败：${message}`, "error");
    }
  }

  private updateContextFileFromWorkspace(): void {
    const activeFile = this.getActiveMarkdownFile();
    if (activeFile) {
      this.contextFile = activeFile;
    }
  }

  private captureSelectionFromWorkspace(): void {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = markdownView?.editor;
    const file = markdownView?.file;
    if (!editor || !file) {
      return;
    }

    const selectedText = editor.getSelection();
    if (!selectedText || selectedText.trim().length === 0) {
      return;
    }

    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const signature = `${file.path}:${from.line}:${from.ch}:${to.line}:${to.ch}:${selectedText}`;
    if (signature === this.lastSelectionSignature) {
      return;
    }

    this.lastSelectionSignature = signature;

    this.selectionAttachment = {
      filePath: file.path,
      fileName: file.basename,
      originalText: selectedText,
      editableText: selectedText,
      from,
      to
    };
  }

  private refreshSelectionAttachment(): void {
    const attachment = this.selectionAttachment;
    const hasSelectionAttachment = (attachment?.editableText.trim().length ?? 0) > 0;
    this.selectionChipEl.classList.toggle("obsidian-ai-button-hidden", !hasSelectionAttachment);
    this.noteContextRowEl.classList.toggle(
      "obsidian-ai-button-hidden",
      this.getContextFile() === null && !hasSelectionAttachment
    );

    if (!attachment || attachment.originalText.trim().length === 0) {
      this.selectionChipLabelEl.setText("");
      this.selectionChipEl.removeAttribute("title");
      this.selectionChipEl.removeAttribute("aria-label");
      return;
    }

    const metrics = this.getSelectionMetrics(attachment);
    const lineRange =
      attachment.from.line === attachment.to.line
        ? `L${attachment.from.line + 1}`
        : `L${attachment.from.line + 1}-L${attachment.to.line + 1}`;
    const helperText =
      `已锁定选区 · ${metrics.characters} 字 · ${metrics.lines} 行`;
    this.selectionChipLabelEl.setText(helperText);
    this.selectionChipEl.setAttr(
      "title",
      `当前已锁定来自《${attachment.fileName}》的选区（${lineRange}）。只有重新选中新内容时才会替换，点击 × 可清除。`
    );
    this.selectionChipEl.setAttr(
      "aria-label",
      `已锁定选区，来自 ${attachment.fileName}，${metrics.characters} 字，${metrics.lines} 行`
    );
  }

  private scheduleSelectionSync(): void {
    if (this.selectionSyncFrame !== null) {
      return;
    }

    this.selectionSyncFrame = window.requestAnimationFrame(() => {
      this.selectionSyncFrame = null;
      this.captureSelectionFromWorkspace();
      this.refreshControls();
    });
  }

  private clearSelectionSyncFrame(): void {
    if (this.selectionSyncFrame === null) {
      return;
    }

    window.cancelAnimationFrame(this.selectionSyncFrame);
    this.selectionSyncFrame = null;
  }

  private getSelectionMetrics(attachment: SelectionAttachment): { characters: number; lines: number } {
    const text = attachment.editableText.trim();
    const lines = Math.max(1, attachment.to.line - attachment.from.line + 1);
    return {
      characters: text.length,
      lines
    };
  }

  private resizeInput(): void {
    if (!this.inputEl) {
      return;
    }

    this.inputEl.style.height = "auto";
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 220)}px`;
  }

  private getSelectionAttachment(): SelectionAttachment | null {
    return this.selectionAttachment;
  }

  private shouldAutoApplySelectionEdit(
    userInput: string,
    selectionAttachment: SelectionAttachment | null
  ): boolean {
    if (!selectionAttachment) {
      return false;
    }

    const normalized = userInput.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    const hasEditKeyword = SELECTION_EDIT_KEYWORDS.some((keyword) => normalized.includes(keyword));
    const hasQueryKeyword = NOTE_QUERY_KEYWORDS.some((keyword) => normalized.includes(keyword));

    if (hasEditKeyword) {
      return true;
    }

    if (hasQueryKeyword) {
      return false;
    }

    return /这段|这部分|选中|所选|帮我改|改一下|润色一下|翻译一下/.test(userInput);
  }

  private replaceRangeInContent(
    content: string,
    from: EditorPosition,
    to: EditorPosition,
    replacement: string
  ): string {
    const start = this.positionToOffset(content, from);
    const end = this.positionToOffset(content, to);

    if (start > end || start < 0 || end > content.length) {
      throw new Error("选中文本位置已失效，请重新选择后再试。");
    }

    return content.slice(0, start) + replacement + content.slice(end);
  }

  private positionToOffset(content: string, position: EditorPosition): number {
    let offset = 0;
    let currentLine = 0;

    while (currentLine < position.line) {
      const nextLineBreak = content.indexOf("\n", offset);
      if (nextLineBreak === -1) {
        return content.length;
      }

      offset = nextLineBreak + 1;
      currentLine += 1;
    }

    return Math.min(offset + position.ch, content.length);
  }

  private async openContextFile(): Promise<void> {
    const file = this.getContextFile();
    if (!file) {
      return;
    }

    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    await this.app.workspace.revealLeaf(leaf);
  }

}

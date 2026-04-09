import {
  Editor,
  type EditorPosition,
  Menu,
  Modal,
  Notice,
  Plugin,
  Setting,
  type WorkspaceLeaf
} from "obsidian";
import { buildTextActionMessages, getTextActionDefinition, type TextActionKind } from "./actions/TextActions";
import { streamClaudeChat } from "./api/claude";
import { streamOpenAIChat } from "./api/openai";
import type { ChatRequest, PluginSettings, StreamHandlers } from "./api/types";
import { ObsidianAIAssistantSettingTab, DEFAULT_SETTINGS } from "./settings";
import { CHAT_VIEW_TYPE, ChatView } from "./ui/ChatView";
import { ProcessingModal } from "./ui/ProcessingModal";
import { ResultModal } from "./ui/ResultModal";

class CustomInstructionModal extends Modal {
  private value = "";

  constructor(
    app: Plugin["app"],
    private readonly onSubmit: (value: string) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText("自定义 AI 指令");

    new Setting(contentEl)
      .setName("处理要求")
      .setDesc("例如：改写成更口语化的博客风格。")
      .addTextArea((text) => {
        text.inputEl.rows = 6;
        text.inputEl.addClass("obsidian-ai-custom-instruction");
        text.onChange((value) => {
          this.value = value;
        });
      });

    const actionsEl = contentEl.createDiv({ cls: "obsidian-ai-result-actions" });
    const submitButton = actionsEl.createEl("button", {
      cls: "mod-cta",
      text: "开始处理"
    });
    submitButton.addEventListener("click", () => {
      if (!this.value.trim()) {
        new Notice("请输入自定义指令。");
        return;
      }

      this.onSubmit(this.value.trim());
      this.close();
    });

    const cancelButton = actionsEl.createEl("button", {
      text: "取消"
    });
    cancelButton.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export default class ObsidianAIAssistantPlugin extends Plugin {
  settings!: PluginSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
    this.addSettingTab(new ObsidianAIAssistantSettingTab(this));
    this.addRibbonIcon("bot", "打开 AI 侧边栏", () => {
      void this.activateChatSidebar();
    });

    this.addCommand({
      id: "toggle-chat-sidebar",
      name: "打开或关闭 AI 侧边栏",
      callback: () => void this.toggleChatSidebar()
    });

    this.registerTextActionCommand("summarize");
    this.registerTextActionCommand("polish");
    this.registerTextActionCommand("translate");
    this.registerTextActionCommand("continue");
    this.registerCustomTextActionCommand();

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        this.registerEditorMenu(menu, editor);
      })
    );

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.hasOpenedChatOnce) {
        return;
      }

      void this.openChatOnFirstLoad();
    });
  }

  onunload(): void {
    this.detachChatLeaves();
  }

  getActiveProvider() {
    return (
      this.settings.providers.find((provider) => provider.id === this.settings.activeProviderId) ??
      this.settings.providers[0]
    );
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<PluginSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      providers: loaded?.providers?.length ? loaded.providers : DEFAULT_SETTINGS.providers.map((item) => ({ ...item }))
    };

    if (!this.settings.activeProviderId) {
      this.settings.activeProviderId = this.settings.providers[0]?.id ?? "";
    }
  }

  async saveSettings(): Promise<void> {
    if (!this.settings.activeProviderId && this.settings.providers[0]) {
      this.settings.activeProviderId = this.settings.providers[0].id;
    }

    await this.saveData(this.settings);
    this.refreshChatViews();
  }

  async streamChat(request: ChatRequest, handlers: StreamHandlers): Promise<string> {
    if (request.provider.type === "claude") {
      return streamClaudeChat(request, handlers);
    }

    return streamOpenAIChat(request, handlers);
  }

  private async openChatOnFirstLoad(): Promise<void> {
    await this.activateChatSidebar();
    this.settings.hasOpenedChatOnce = true;
    await this.saveData(this.settings);
  }

  private registerTextActionCommand(actionKind: Exclude<TextActionKind, "custom">): void {
    const definition = getTextActionDefinition(actionKind);
    this.addCommand({
      id: `text-action-${actionKind}`,
      name: `AI ${definition.label}`,
      editorCheckCallback: (checking, editor) => {
        if (!editor.getSelection()) {
          return false;
        }

        if (!checking) {
          void this.runTextAction(editor, actionKind);
        }

        return true;
      }
    });
  }

  private registerCustomTextActionCommand(): void {
    this.addCommand({
      id: "text-action-custom",
      name: "AI 自定义处理",
      editorCheckCallback: (checking, editor) => {
        if (!editor.getSelection()) {
          return false;
        }

        if (!checking) {
          new CustomInstructionModal(this.app, (instruction) => {
            void this.runTextAction(editor, "custom", instruction);
          }).open();
        }

        return true;
      }
    });
  }

  private registerEditorMenu(menu: Menu, editor: Editor): void {
    const selection = editor.getSelection();
    if (!selection) {
      return;
    }

    menu.addSeparator();

    for (const actionKind of ["summarize", "polish", "translate", "continue"] as const) {
      const definition = getTextActionDefinition(actionKind);
      menu.addItem((item) => {
        item.setTitle(`AI ${definition.label}`).onClick(() => {
          void this.runTextAction(editor, actionKind);
        });
      });
    }

    menu.addItem((item) => {
      item.setTitle("AI 自定义处理").onClick(() => {
        new CustomInstructionModal(this.app, (instruction) => {
          void this.runTextAction(editor, "custom", instruction);
        }).open();
      });
    });
  }

  private async runTextAction(
    editor: Editor,
    actionKind: TextActionKind,
    customInstruction?: string
  ): Promise<void> {
    const provider = this.getActiveProvider();
    if (!provider) {
      new Notice("请先在插件设置中配置服务接口。");
      return;
    }

    if (!provider.model.trim()) {
      new Notice("请先填写模型名称。");
      return;
    }

    const selectedText = editor.getSelection();
    if (!selectedText.trim()) {
      new Notice("请先选中文本。");
      return;
    }

    const messages = buildTextActionMessages(selectedText, actionKind, customInstruction);
    const definition = getTextActionDefinition(actionKind);
    const selectionFrom = editor.getCursor("from");
    const selectionTo = editor.getCursor("to");
    const insertPosition = {
      line: selectionTo.line,
      ch: selectionTo.ch
    };
    const requestAbortController = new AbortController();
    const processingModal = new ProcessingModal(this.app, {
      title: `AI ${definition.label}`,
      originalText: selectedText,
      onCancel: () => {
        requestAbortController.abort();
      }
    });
    let resultText = "";
    processingModal.open();
    processingModal.setStatus(`正在${definition.label}...`);

    try {
      await this.streamChat(
        {
          provider,
          messages,
          temperature: provider.temperature,
          maxTokens: provider.maxTokens,
          signal: requestAbortController.signal
        },
        {
          onToken: (token) => {
            resultText += token;
            processingModal.setStatus(`正在${definition.label}...`);
            processingModal.setOutput(resultText);
          }
        }
      );
    } catch (error) {
      if (this.isAbortError(error) || requestAbortController.signal.aborted) {
        processingModal.finish();
        new Notice(`已取消${definition.label}。`);
        return;
      }

      const message = error instanceof Error ? error.message : "未知错误";
      processingModal.showError(message);
      new Notice(`AI 处理失败：${message}`);
      return;
    }
    processingModal.finish();

    if (!resultText.trim()) {
      new Notice("AI 返回了空结果。");
      return;
    }

    new ResultModal(this.app, {
      title: `AI ${definition.label}`,
      originalText: selectedText,
      resultText,
      onReplace: () => {
        this.replaceStoredRange(editor, selectionFrom, selectionTo, resultText);
        new Notice("已替换原文。");
      },
      onInsertBelow: () => {
        editor.replaceRange(`\n${resultText}`, insertPosition);
        new Notice("已插入到下方。");
      },
      onCopy: async () => {
        await navigator.clipboard.writeText(resultText);
        new Notice("已复制到剪贴板。");
      }
    }).open();
  }

  private replaceStoredRange(
    editor: Editor,
    from: EditorPosition,
    to: EditorPosition,
    nextText: string
  ): void {
    editor.replaceRange(nextText, from, to);
  }

  async toggleChatSidebar(): Promise<void> {
    const existingLeaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (existingLeaves.length > 0) {
      await this.detachChatLeaves();
      return;
    }

    await this.activateChatSidebar();
  }

  private async activateChatSidebar(): Promise<void> {
    let leaf: WorkspaceLeaf | null = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0] ?? null;

    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) {
        new Notice("无法打开右侧边栏，请先在 Obsidian 中创建一个侧边栏区域。");
        return;
      }

      await leaf.setViewState({
        type: CHAT_VIEW_TYPE,
        active: true
      });
    }

    await this.app.workspace.revealLeaf(leaf);
  }

  private detachChatLeaves(): void {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    for (const leaf of leaves) {
      leaf.detach();
    }
  }

  private refreshChatViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);

    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof ChatView) {
        view.refreshFromSettings();
      }
    }
  }

  private isAbortError(error: unknown): boolean {
    return (
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError")
    );
  }
}

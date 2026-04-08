import { App, Modal } from "obsidian";

interface ResultModalOptions {
  title: string;
  originalText: string;
  resultText: string;
  onReplace: () => void;
  onInsertBelow: () => void;
  onCopy: () => Promise<void> | void;
}

export class ResultModal extends Modal {
  constructor(app: App, private readonly options: ResultModalOptions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    const resultLength = this.options.resultText.trim().length;
    titleEl.setText(this.options.title);
    contentEl.addClass("obsidian-ai-result-modal");

    const headingEl = contentEl.createDiv({ cls: "obsidian-ai-modal-heading" });
    headingEl.createDiv({
      cls: "obsidian-ai-section-label",
      text: "Review Result"
    });

    const summaryEl = headingEl.createDiv({ cls: "obsidian-ai-result-summary" });
    summaryEl.setText(
      `原文 ${this.options.originalText.length} 字符 · 结果 ${this.options.resultText.length} 字符`
    );

    const compareEl = contentEl.createDiv({ cls: "obsidian-ai-result-compare" });

    const originalEl = compareEl.createDiv({ cls: "obsidian-ai-result-panel" });
    originalEl.createEl("h4", { text: "原文" });
    originalEl.createEl("pre", { text: this.options.originalText });

    const resultEl = compareEl.createDiv({ cls: "obsidian-ai-result-panel" });
    resultEl.createEl("h4", { text: "AI 结果" });
    resultEl.createEl("pre", { text: this.options.resultText });

    const actionsEl = contentEl.createDiv({ cls: "obsidian-ai-result-actions" });

    const replaceButton = actionsEl.createEl("button", {
      cls: "mod-cta",
      text: "替换"
    });
    replaceButton.disabled = resultLength === 0;
    replaceButton.addEventListener("click", () => {
      this.options.onReplace();
      this.close();
    });

    const insertButton = actionsEl.createEl("button", {
      text: "插入下方"
    });
    insertButton.disabled = resultLength === 0;
    insertButton.addEventListener("click", () => {
      this.options.onInsertBelow();
      this.close();
    });

    const copyButton = actionsEl.createEl("button", {
      text: "复制"
    });
    copyButton.disabled = resultLength === 0;
    copyButton.addEventListener("click", async () => {
      await this.options.onCopy();
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

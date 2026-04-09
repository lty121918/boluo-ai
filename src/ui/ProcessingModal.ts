import { App, Modal, Setting } from "obsidian";

type ProcessingStatusKind = "info" | "error";

interface ProcessingModalOptions {
  title: string;
  originalText: string;
  onCancel: () => void;
}

export class ProcessingModal extends Modal {
  private statusEl!: HTMLElement;
  private outputEl!: HTMLPreElement;
  private cancelButton!: HTMLButtonElement;
  private closeButton!: HTMLButtonElement;
  private isActive = true;
  private cancelTriggered = false;

  constructor(app: App, private readonly options: ProcessingModalOptions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText(this.options.title);
    contentEl.addClass("obsidian-ai-processing-modal");

    const headingEl = contentEl.createDiv({ cls: "obsidian-ai-modal-heading" });
    headingEl.createDiv({
      cls: "obsidian-ai-section-label",
      text: "Live processing"
    });

    this.statusEl = contentEl.createDiv({
      cls: "obsidian-ai-processing-status obsidian-ai-processing-status-info"
    });
    this.statusEl.setText("正在发送请求...");

    const compareEl = contentEl.createDiv({ cls: "obsidian-ai-result-compare" });

    const originalEl = compareEl.createDiv({ cls: "obsidian-ai-result-panel" });
    new Setting(originalEl).setName("原文").setHeading().settingEl.addClass("obsidian-ai-panel-heading");
    originalEl.createEl("pre", { text: this.options.originalText });

    const outputPanelEl = compareEl.createDiv({ cls: "obsidian-ai-result-panel" });
    new Setting(outputPanelEl)
      .setName("处理中")
      .setHeading()
      .settingEl.addClass("obsidian-ai-panel-heading");
    this.outputEl = outputPanelEl.createEl("pre", {
      text: "正在等待模型返回..."
    });
    this.outputEl.addClass("obsidian-ai-processing-output");

    const actionsEl = contentEl.createDiv({ cls: "obsidian-ai-result-actions" });
    this.cancelButton = actionsEl.createEl("button", {
      cls: "mod-warning",
      text: "取消处理"
    });
    this.cancelButton.addEventListener("click", () => {
      this.requestCancel();
    });

    this.closeButton = actionsEl.createEl("button", {
      cls: "mod-cta",
      text: "关闭"
    });
    this.closeButton.addClass("obsidian-ai-button-hidden");
    this.closeButton.addEventListener("click", () => {
      this.isActive = false;
      this.close();
    });
  }

  onClose(): void {
    if (this.isActive) {
      this.requestCancel();
    }

    this.contentEl.empty();
  }

  setStatus(message: string, kind: ProcessingStatusKind = "info"): void {
    this.statusEl.className = `obsidian-ai-processing-status obsidian-ai-processing-status-${kind}`;
    this.statusEl.setText(message);
  }

  setOutput(text: string): void {
    this.outputEl.setText(text || "正在等待模型返回...");
  }

  finish(): void {
    this.isActive = false;
    this.close();
  }

  showError(message: string): void {
    this.isActive = false;
    this.setStatus(`处理失败：${message}`, "error");
    this.setOutput(`处理失败：${message}`);
    this.cancelButton.disabled = true;
    this.cancelButton.addClass("obsidian-ai-button-hidden");
    this.closeButton.removeClass("obsidian-ai-button-hidden");
  }

  private requestCancel(): void {
    if (this.cancelTriggered) {
      return;
    }

    this.cancelTriggered = true;
    this.options.onCancel();
  }
}

import { PluginSettingTab, Setting } from "obsidian";
import type ObsidianAIAssistantPlugin from "./main";
import type { PluginSettings, ProviderConfig, ProviderType } from "./api/types";

interface ProviderPreset {
  label: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  model: string;
  temperature?: number;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    label: "OpenAI",
    name: "OpenAI",
    type: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini"
  },
  {
    label: "Kimi",
    name: "Kimi",
    type: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k2.5",
    temperature: 1
  },
  {
    label: "Qwen",
    name: "Qwen",
    type: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus"
  },
  {
    label: "DeepSeek",
    name: "DeepSeek",
    type: "openai",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat"
  },
  {
    label: "Ollama",
    name: "Ollama",
    type: "openai",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1"
  },
  {
    label: "Claude",
    name: "Claude",
    type: "claude",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-3-5-sonnet-latest"
  }
];

function createProvider(type: ProviderType): ProviderConfig {
  const isClaude = type === "claude";

  return {
    id: crypto.randomUUID(),
    name: isClaude ? "Claude" : "OpenAI Compatible",
    type,
    baseUrl: isClaude ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1",
    apiKey: "",
    model: "",
    temperature: 0.7,
    maxTokens: 2048
  };
}

export const DEFAULT_SETTINGS: PluginSettings = {
  providers: [createProvider("openai")],
  activeProviderId: "",
  attachCurrentNoteByDefault: false,
  autoApplyCurrentNoteEdits: true,
  hasOpenedChatOnce: false
};

export class ObsidianAIAssistantSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: ObsidianAIAssistantPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("obsidian-ai-settings-root");

    const heroEl = containerEl.createDiv({ cls: "obsidian-ai-settings-hero" });
    heroEl.createDiv({
      cls: "obsidian-ai-section-label",
      text: "AI Control Room"
    });
    heroEl.createEl("h2", { text: "Boluo AI" });
    heroEl.createDiv({
      cls: "obsidian-ai-settings-hero-meta",
      text: "在这里配置 Provider、默认上下文策略和自动写回行为，让侧边栏保持一套稳定的工作流。"
    });

    const generalSectionEl = containerEl.createDiv({ cls: "obsidian-ai-settings-section" });
    generalSectionEl.createDiv({
      cls: "obsidian-ai-section-label",
      text: "General"
    });
    generalSectionEl.createEl("h3", { text: "默认工作方式" });

    new Setting(generalSectionEl)
      .setName("默认附带当前笔记")
      .setDesc("在对话面板中默认勾选“附带当前笔记”。")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.attachCurrentNoteByDefault)
          .onChange(async (value) => {
            this.plugin.settings.attachCurrentNoteByDefault = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(generalSectionEl)
      .setName("当前默认 Provider")
      .setDesc("新打开侧边栏时使用的 Provider。")
      .addDropdown((dropdown) => {
        for (const provider of this.plugin.settings.providers) {
          dropdown.addOption(provider.id, provider.name);
        }

        const activeProviderId =
          this.plugin.settings.activeProviderId || this.plugin.settings.providers[0]?.id || "";

        dropdown.setValue(activeProviderId).onChange(async (value) => {
          this.plugin.settings.activeProviderId = value;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(generalSectionEl)
      .setName("自动应用当前笔记编辑")
      .setDesc("附带当前笔记时，检测到编辑型请求后自动把结果写回原笔记，并保留一次撤销。")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.autoApplyCurrentNoteEdits)
          .onChange(async (value) => {
            this.plugin.settings.autoApplyCurrentNoteEdits = value;
            await this.plugin.saveSettings();
          });
      });

    const addButtonsEl = containerEl.createDiv({ cls: "obsidian-ai-settings-actions" });
    addButtonsEl.createDiv({
      cls: "obsidian-ai-section-label",
      text: "Providers"
    });
    addButtonsEl.createEl("h3", { text: "Provider 列表" });

    const buttonRow = addButtonsEl.createDiv({ cls: "obsidian-ai-settings-button-row" });
    const addOpenAIButton = buttonRow.createEl("button", {
      cls: "mod-cta",
      text: "添加 OpenAI 兼容 Provider"
    });
    addOpenAIButton.addEventListener("click", async () => {
      this.plugin.settings.providers.push(createProvider("openai"));
      if (!this.plugin.settings.activeProviderId) {
        this.plugin.settings.activeProviderId = this.plugin.settings.providers[0].id;
      }
      await this.plugin.saveSettings();
      this.display();
    });

    const addClaudeButton = buttonRow.createEl("button", {
      text: "添加 Claude Provider"
    });
    addClaudeButton.addEventListener("click", async () => {
      this.plugin.settings.providers.push(createProvider("claude"));
      if (!this.plugin.settings.activeProviderId) {
        this.plugin.settings.activeProviderId = this.plugin.settings.providers[0].id;
      }
      await this.plugin.saveSettings();
      this.display();
    });

    for (const provider of this.plugin.settings.providers) {
      this.renderProviderSection(containerEl, provider);
    }
  }

  private renderProviderSection(containerEl: HTMLElement, provider: ProviderConfig): void {
    const cardEl = containerEl.createDiv({ cls: "obsidian-ai-provider-card" });
    cardEl.createEl("h3", { text: provider.name });

    new Setting(cardEl)
      .setName("显示名称")
      .setDesc("用于设置面板和侧边栏顶部展示。")
      .addText((text) => {
        text.setValue(provider.name).onChange(async (value) => {
          provider.name = value.trim() || "未命名 Provider";
          await this.plugin.saveSettings();
        });
      });

    new Setting(cardEl)
      .setName("API 类型")
      .setDesc("OpenAI 兼容接口或 Claude 原生接口。")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("openai", "OpenAI 兼容")
          .addOption("claude", "Claude")
          .setValue(provider.type)
          .onChange(async (value) => {
            const nextType = value as ProviderType;
            provider.type = nextType;
            provider.baseUrl =
              nextType === "claude"
                ? "https://api.anthropic.com/v1"
                : "https://api.openai.com/v1";
            await this.plugin.saveSettings();
            this.display();
          });
      });

    new Setting(cardEl)
      .setName("快速预设")
      .setDesc("一键套用常见服务商的默认配置。");

    const presetsRow = cardEl.createDiv({ cls: "obsidian-ai-settings-button-row" });
    for (const preset of PROVIDER_PRESETS) {
      const button = presetsRow.createEl("button", {
        text: preset.label
      });
      button.addEventListener("click", async () => {
        this.applyPreset(provider, preset);
        await this.plugin.saveSettings();
        this.display();
      });
    }

    new Setting(cardEl)
      .setName("Base URL")
      .setDesc("例如 https://api.openai.com/v1 或 http://localhost:11434/v1")
      .addText((text) => {
        text.inputEl.addClass("obsidian-ai-wide-input");
        text.setValue(provider.baseUrl).onChange(async (value) => {
          provider.baseUrl = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(cardEl)
      .setName("API Key")
      .setDesc("本地 Ollama 等无需密钥的服务可以留空。")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.addClass("obsidian-ai-wide-input");
        text.setValue(provider.apiKey).onChange(async (value) => {
          provider.apiKey = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(cardEl)
      .setName("模型名称")
      .setDesc("例如 qwen-plus、moonshot-v1-8k、claude-sonnet-4-20250514。")
      .addText((text) => {
        text.inputEl.addClass("obsidian-ai-wide-input");
        text.setValue(provider.model).onChange(async (value) => {
          provider.model = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(cardEl)
      .setName("Temperature")
      .setDesc("0 到 1，默认 0.7。")
      .addSlider((slider) => {
        slider
          .setLimits(0, 1, 0.1)
          .setValue(provider.temperature)
          .setDynamicTooltip()
          .onChange(async (value) => {
            provider.temperature = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(cardEl)
      .setName("Max Tokens")
      .setDesc("控制输出上限。")
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(provider.maxTokens)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          provider.maxTokens = Number.isFinite(parsed) && parsed > 0 ? parsed : 2048;
          await this.plugin.saveSettings();
        });
      });

    new Setting(cardEl)
      .setName("删除 Provider")
      .setDesc("移除当前配置。")
      .addButton((button) => {
        button.setWarning().setButtonText("删除").onClick(async () => {
          this.plugin.settings.providers = this.plugin.settings.providers.filter(
            (item) => item.id !== provider.id
          );

          if (this.plugin.settings.activeProviderId === provider.id) {
            this.plugin.settings.activeProviderId = this.plugin.settings.providers[0]?.id ?? "";
          }

          await this.plugin.saveSettings();
          this.display();
        });
      });
  }

  private applyPreset(provider: ProviderConfig, preset: ProviderPreset): void {
    provider.name = preset.name;
    provider.type = preset.type;
    provider.baseUrl = preset.baseUrl;
    provider.model = preset.model;
    if (typeof preset.temperature === "number") {
      provider.temperature = preset.temperature;
    }
  }
}

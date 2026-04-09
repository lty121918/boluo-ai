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
    name: isClaude ? "Claude" : "OpenAI 兼容接口",
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
      text: "配置"
    });
    new Setting(heroEl)
      .setName("Boluo AI")
      .setDesc("在这里配置服务接口、默认上下文策略和自动写回行为，让侧边栏保持一套稳定的工作流。")
      .setHeading()
      .settingEl.addClass("obsidian-ai-settings-main-heading");

    const generalSectionEl = containerEl.createDiv({ cls: "obsidian-ai-settings-section" });
    generalSectionEl.createDiv({
      cls: "obsidian-ai-section-label",
      text: "通用设置"
    });
    new Setting(generalSectionEl)
      .setName("默认工作方式")
      .setHeading()
      .settingEl.addClass("obsidian-ai-settings-section-heading");

    new Setting(generalSectionEl)
      .setName("默认附带当前笔记")
      .setDesc("在对话面板中默认勾选“附带当前笔记”。")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.attachCurrentNoteByDefault)
          .onChange((value) => {
            this.plugin.settings.attachCurrentNoteByDefault = value;
            void this.plugin.saveSettings();
          });
      });

    new Setting(generalSectionEl)
      .setName("当前默认接口")
      .setDesc("新打开侧边栏时使用的服务接口。")
      .addDropdown((dropdown) => {
        for (const provider of this.plugin.settings.providers) {
          dropdown.addOption(provider.id, provider.name);
        }

        const activeProviderId =
          this.plugin.settings.activeProviderId || this.plugin.settings.providers[0]?.id || "";

        dropdown.setValue(activeProviderId).onChange((value) => {
          this.plugin.settings.activeProviderId = value;
          void this.saveAndRedisplay();
        });
      });

    new Setting(generalSectionEl)
      .setName("自动应用当前笔记编辑")
      .setDesc("附带当前笔记时，检测到编辑型请求后自动把结果写回原笔记，并保留一次撤销。")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.autoApplyCurrentNoteEdits)
          .onChange((value) => {
            this.plugin.settings.autoApplyCurrentNoteEdits = value;
            void this.plugin.saveSettings();
          });
      });

    const addButtonsEl = containerEl.createDiv({ cls: "obsidian-ai-settings-actions" });
    addButtonsEl.createDiv({
      cls: "obsidian-ai-section-label",
      text: "提供方"
    });
    new Setting(addButtonsEl)
      .setName("接口列表")
      .setHeading()
      .settingEl.addClass("obsidian-ai-settings-section-heading");

    const buttonRow = addButtonsEl.createDiv({ cls: "obsidian-ai-settings-button-row" });
    const addOpenAIButton = buttonRow.createEl("button", {
      cls: "mod-cta",
      text: "添加 OpenAI 兼容接口"
    });
    addOpenAIButton.addEventListener("click", () => {
      void this.addProvider("openai");
    });

    const addClaudeButton = buttonRow.createEl("button", {
      text: "添加 Claude 接口"
    });
    addClaudeButton.addEventListener("click", () => {
      void this.addProvider("claude");
    });

    for (const provider of this.plugin.settings.providers) {
      this.renderProviderSection(containerEl, provider);
    }
  }

  private renderProviderSection(containerEl: HTMLElement, provider: ProviderConfig): void {
    const cardEl = containerEl.createDiv({ cls: "obsidian-ai-provider-card" });
    new Setting(cardEl)
      .setName(provider.name)
      .setHeading()
      .settingEl.addClass("obsidian-ai-provider-heading");

    new Setting(cardEl)
      .setName("显示名称")
      .setDesc("用于设置面板和侧边栏顶部展示。")
      .addText((text) => {
        text.setValue(provider.name).onChange((value) => {
          provider.name = value.trim() || "未命名接口";
          void this.plugin.saveSettings();
        });
      });

    new Setting(cardEl)
      .setName("接口类型")
      .setDesc("OpenAI 兼容接口或 Claude 原生接口。")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("openai", "OpenAI 兼容")
          .addOption("claude", "Claude")
          .setValue(provider.type)
          .onChange((value) => {
            const nextType = value as ProviderType;
            provider.type = nextType;
            provider.baseUrl =
              nextType === "claude"
                ? "https://api.anthropic.com/v1"
                : "https://api.openai.com/v1";
            void this.saveAndRedisplay();
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
      button.addEventListener("click", () => {
        this.applyPreset(provider, preset);
        void this.saveAndRedisplay();
      });
    }

    new Setting(cardEl)
      .setName("接口地址")
      .setDesc("例如 https://api.openai.com/v1 或 http://localhost:11434/v1")
      .addText((text) => {
        text.inputEl.addClass("obsidian-ai-wide-input");
        text.setValue(provider.baseUrl).onChange((value) => {
          provider.baseUrl = value.trim();
          void this.plugin.saveSettings();
        });
      });

    new Setting(cardEl)
      .setName("API 密钥")
      .setDesc("本地 Ollama 等无需密钥的服务可以留空。")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.addClass("obsidian-ai-wide-input");
        text.setValue(provider.apiKey).onChange((value) => {
          provider.apiKey = value.trim();
          void this.plugin.saveSettings();
        });
      });

    new Setting(cardEl)
      .setName("模型名称")
      .setDesc("例如 qwen-plus、moonshot-v1-8k、claude-sonnet-4-20250514。")
      .addText((text) => {
        text.inputEl.addClass("obsidian-ai-wide-input");
        text.setValue(provider.model).onChange((value) => {
          provider.model = value.trim();
          void this.plugin.saveSettings();
        });
      });

    new Setting(cardEl)
      .setName("采样温度")
      .setDesc("0 到 1，默认 0.7。")
      .addSlider((slider) => {
        slider
          .setLimits(0, 1, 0.1)
          .setValue(provider.temperature)
          .setDynamicTooltip()
          .onChange((value) => {
            provider.temperature = value;
            void this.plugin.saveSettings();
          });
      });

    new Setting(cardEl)
      .setName("最大 token 数")
      .setDesc("控制输出上限。")
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(provider.maxTokens)).onChange((value) => {
          const parsed = Number.parseInt(value, 10);
          provider.maxTokens = Number.isFinite(parsed) && parsed > 0 ? parsed : 2048;
          void this.plugin.saveSettings();
        });
      });

    new Setting(cardEl)
      .setName("删除接口")
      .setDesc("移除当前配置。")
      .addButton((button) => {
        button.setWarning().setButtonText("删除").onClick(() => {
          void this.removeProvider(provider.id);
        });
      });
  }

  private async addProvider(type: ProviderType): Promise<void> {
    this.plugin.settings.providers.push(createProvider(type));
    if (!this.plugin.settings.activeProviderId) {
      this.plugin.settings.activeProviderId = this.plugin.settings.providers[0]?.id ?? "";
    }

    await this.saveAndRedisplay();
  }

  private async removeProvider(providerId: string): Promise<void> {
    this.plugin.settings.providers = this.plugin.settings.providers.filter(
      (item) => item.id !== providerId
    );

    if (this.plugin.settings.activeProviderId === providerId) {
      this.plugin.settings.activeProviderId = this.plugin.settings.providers[0]?.id ?? "";
    }

    await this.saveAndRedisplay();
  }

  private async saveAndRedisplay(): Promise<void> {
    await this.plugin.saveSettings();
    this.display();
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

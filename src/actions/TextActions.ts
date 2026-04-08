import type { ChatMessage } from "../api/types";

export type TextActionKind = "summarize" | "polish" | "translate" | "continue" | "custom";

export interface TextActionDefinition {
  kind: TextActionKind;
  label: string;
  instruction: string;
}

export const TEXT_ACTIONS: TextActionDefinition[] = [
  {
    kind: "summarize",
    label: "总结",
    instruction: "请把选中文本压缩为清晰、准确、简洁的摘要，保留关键信息。"
  },
  {
    kind: "polish",
    label: "优化",
    instruction: "请改善选中文本的表达、逻辑和可读性，保持原意，不要额外扩写。"
  },
  {
    kind: "translate",
    label: "翻译",
    instruction: "请自动判断语言方向，在中文和英文之间自然互译，保持语气和格式。"
  },
  {
    kind: "continue",
    label: "续写",
    instruction: "请基于选中文本自然续写后文，不要重复原文，只返回续写内容。"
  },
  {
    kind: "custom",
    label: "自定义",
    instruction: ""
  }
];

export function getTextActionDefinition(kind: TextActionKind): TextActionDefinition {
  const action = TEXT_ACTIONS.find((item) => item.kind === kind);
  if (!action) {
    throw new Error(`Unknown action kind: ${kind}`);
  }

  return action;
}

export function buildTextActionMessages(
  selectedText: string,
  actionKind: TextActionKind,
  customInstruction?: string
): ChatMessage[] {
  const definition = getTextActionDefinition(actionKind);
  const instruction = actionKind === "custom" ? (customInstruction ?? "").trim() : definition.instruction;

  return [
    {
      role: "system",
      content:
        "你是一个在 Obsidian 内工作的写作助手。只返回处理后的正文内容，不要解释，不要加标题，不要使用代码块。"
    },
    {
      role: "user",
      content: `请按以下要求处理选中文本。\n\n要求：${instruction}\n\n选中文本：\n${selectedText}`
    }
  ];
}

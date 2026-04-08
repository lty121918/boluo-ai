export type NoteEditOperation =
  | {
      type: "append";
      text: string;
    }
  | {
      type: "prepend";
      text: string;
    }
  | {
      type: "insert_after";
      anchor: string;
      text: string;
    }
  | {
      type: "insert_before";
      anchor: string;
      text: string;
    }
  | {
      type: "replace_text";
      find: string;
      replace: string;
      all?: boolean;
    }
  | {
      type: "delete_text";
      find: string;
      all?: boolean;
    }
  | {
      type: "replace_all";
      content: string;
    };

export interface NoteEditPlan {
  summary?: string;
  operations: NoteEditOperation[];
}

function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("模型没有返回任何编辑结果。");
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`编辑指令缺少有效字段：${field}`);
  }

  return value;
}

function parseOperation(value: unknown): NoteEditOperation {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("编辑指令格式无效。");
  }

  switch (value.type) {
    case "append":
      return {
        type: "append",
        text: asNonEmptyString(value.text, "text")
      };
    case "prepend":
      return {
        type: "prepend",
        text: asNonEmptyString(value.text, "text")
      };
    case "insert_after":
      return {
        type: "insert_after",
        anchor: asNonEmptyString(value.anchor, "anchor"),
        text: asNonEmptyString(value.text, "text")
      };
    case "insert_before":
      return {
        type: "insert_before",
        anchor: asNonEmptyString(value.anchor, "anchor"),
        text: asNonEmptyString(value.text, "text")
      };
    case "replace_text":
      return {
        type: "replace_text",
        find: asNonEmptyString(value.find, "find"),
        replace: typeof value.replace === "string" ? value.replace : "",
        all: value.all === true
      };
    case "delete_text":
      return {
        type: "delete_text",
        find: asNonEmptyString(value.find, "find"),
        all: value.all === true
      };
    case "replace_all":
      return {
        type: "replace_all",
        content: typeof value.content === "string" ? value.content : ""
      };
    default:
      throw new Error(`不支持的编辑操作类型：${value.type}`);
  }
}

export function parseNoteEditPlan(raw: string): NoteEditPlan {
  const payload = JSON.parse(extractJsonPayload(raw)) as unknown;

  if (!isRecord(payload) || !Array.isArray(payload.operations)) {
    throw new Error("模型没有返回合法的编辑操作 JSON。");
  }

  return {
    summary: typeof payload.summary === "string" ? payload.summary : undefined,
    operations: payload.operations.map((operation) => parseOperation(operation))
  };
}

function replaceFirst(source: string, find: string, replace: string): string {
  const index = source.indexOf(find);
  if (index === -1) {
    throw new Error(`找不到要替换的文本：${find}`);
  }

  return source.slice(0, index) + replace + source.slice(index + find.length);
}

function replaceAllExact(source: string, find: string, replace: string): string {
  if (!source.includes(find)) {
    throw new Error(`找不到要替换的文本：${find}`);
  }

  return source.split(find).join(replace);
}

function insertRelative(source: string, anchor: string, text: string, mode: "before" | "after"): string {
  const index = source.indexOf(anchor);
  if (index === -1) {
    throw new Error(`找不到编辑锚点：${anchor}`);
  }

  if (mode === "before") {
    return source.slice(0, index) + text + source.slice(index);
  }

  return source.slice(0, index + anchor.length) + text + source.slice(index + anchor.length);
}

export function applyNoteEditPlan(original: string, plan: NoteEditPlan): string {
  let next = original;

  for (const operation of plan.operations) {
    switch (operation.type) {
      case "append":
        next += operation.text;
        break;
      case "prepend":
        next = operation.text + next;
        break;
      case "insert_after":
        next = insertRelative(next, operation.anchor, operation.text, "after");
        break;
      case "insert_before":
        next = insertRelative(next, operation.anchor, operation.text, "before");
        break;
      case "replace_text":
        next = operation.all
          ? replaceAllExact(next, operation.find, operation.replace)
          : replaceFirst(next, operation.find, operation.replace);
        break;
      case "delete_text":
        next = operation.all ? replaceAllExact(next, operation.find, "") : replaceFirst(next, operation.find, "");
        break;
      case "replace_all":
        next = operation.content;
        break;
    }
  }

  return next;
}

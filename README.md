<p align="right">
  <a href="./README.md">
    <img alt="English" src="https://img.shields.io/badge/English-111111?style=for-the-badge&logo=github&logoColor=white">
  </a>
  <a href="./README.zh-CN.md">
    <img alt="简体中文" src="https://img.shields.io/badge/简体中文-f59e0b?style=for-the-badge&logo=github&logoColor=white">
  </a>
</p>

# Boluo AI

Boluo AI is a community plugin for chatting with AI, transforming selected text, and writing results back into your notes.

## Features

- Chat with any configured OpenAI-compatible or Claude-compatible provider
- Attach the current note as context before sending a prompt
- Detect selected text in the active editor and use it as editable context
- Run rewrite, polish, translate, summarize, and continuation workflows
- Insert generated content back into the current note
- Auto-apply note edits for edit-style prompts and keep one-step undo

## Usage

1. Open the plugin settings and add at least one AI provider.
2. Open the Boluo AI sidebar from the ribbon icon or command palette.
3. Type a prompt directly, or attach the current note as context before sending.
4. Optionally select text in the editor to rewrite, polish, translate, or continue it.
5. Insert the result back into the current note or let the plugin apply supported edits automatically.

## Plugin Metadata

- Plugin ID: `boluo-ai`
- Name: `Boluo AI`
- Minimum Obsidian version: `1.5.0`

## Disclosures

- Requires network access to user-configured AI provider APIs
- Requires an API key or account for the AI provider you choose
- No telemetry
- No ads
- Open source

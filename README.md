<p align="right">
  <a href="./README.md">
    <img alt="English" src="https://img.shields.io/badge/English-111111?style=for-the-badge&logo=github&logoColor=white">
  </a>
  <a href="./README.zh-CN.md">
    <img alt="简体中文" src="https://img.shields.io/badge/简体中文-f59e0b?style=for-the-badge&logo=github&logoColor=white">
  </a>
</p>

# Obsidian Boluo AI

Obsidian Boluo AI is an Obsidian community plugin for chatting with AI, transforming selected text, and writing results back into your notes.

## Features

- Chat with any configured OpenAI-compatible or Claude-compatible provider
- Attach the current note as context before sending a prompt
- Detect selected text in the active editor and use it as editable context
- Run rewrite, polish, translate, summarize, and continuation workflows
- Insert generated content back into the current note
- Auto-apply note edits for edit-style prompts and keep one-step undo

## Plugin Metadata

- Plugin ID: `boluo-ai`
- Name: `Obsidian Boluo AI`
- Minimum Obsidian version: `1.5.0`

## Development

Install dependencies:

```bash
npm install
```

Build once:

```bash
npm run build
```

Watch for changes:

```bash
npm run dev
```

The build script outputs:

- `main.js`
- `styles.css`
- `manifest.json`
- `versions.json`
- `boluo-logo.svg`

If a local Obsidian vault plugin folder matching the plugin ID exists, the build script also copies the release files there for local testing.

## Release

To publish a release for the Obsidian community plugin store:

1. Bump the version in `manifest.json` and `package.json`
2. Update `versions.json`
3. Run `npm run build`
4. Create a GitHub release whose tag exactly matches the plugin version
5. Upload these release assets:
   - `main.js`
   - `manifest.json`
   - `styles.css`

## Repository Checklist

This repository includes the files expected for community plugin submission:

- `README.md`
- `LICENSE`
- `manifest.json`
- `versions.json`

## License

MIT

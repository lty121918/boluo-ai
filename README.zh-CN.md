<p align="right">
  <a href="./README.md">
    <img alt="English" src="https://img.shields.io/badge/English-111111?style=for-the-badge&logo=github&logoColor=white">
  </a>
  <a href="./README.zh-CN.md">
    <img alt="简体中文" src="https://img.shields.io/badge/简体中文-f59e0b?style=for-the-badge&logo=github&logoColor=white">
  </a>
</p>

# Obsidian Boluo AI

Obsidian Boluo AI 是一个 Obsidian 社区插件，支持在笔记中与 AI 对话、处理选中文本，并将生成结果直接写回笔记。

## 功能特性

- 支持任意已配置的 OpenAI 兼容接口或 Claude 兼容接口
- 发送问题前可附带当前笔记作为上下文
- 自动识别当前编辑器中的选中文本，并作为可编辑上下文使用
- 支持改写、润色、翻译、总结、续写等工作流
- 支持将生成内容插入回当前笔记
- 对编辑型请求支持自动写回当前笔记，并保留一步撤销

## 插件信息

- 插件 ID：`boluo-ai`
- 插件名称：`Obsidian Boluo AI`
- 最低 Obsidian 版本：`1.5.0`

## 开发

安装依赖：

```bash
npm install
```

构建一次：

```bash
npm run build
```

监听开发：

```bash
npm run dev
```

构建脚本会输出以下文件：

- `main.js`
- `styles.css`
- `manifest.json`
- `versions.json`
- `boluo-logo.svg`

如果本地存在与插件 ID 对应的 Obsidian 插件目录，构建脚本也会自动把这些文件同步过去，便于本地调试。

## 发布

如果要发布到 Obsidian 社区插件商店：

1. 更新 `manifest.json` 和 `package.json` 中的版本号
2. 更新 `versions.json`
3. 运行 `npm run build`
4. 在 GitHub 创建与插件版本完全一致的 tag/release
5. 在 release 中上传以下资产：
   - `main.js`
   - `manifest.json`
   - `styles.css`

## 仓库检查清单

本仓库已经包含社区插件提交所需的基础文件：

- `README.md`
- `README.zh-CN.md`
- `LICENSE`
- `manifest.json`
- `versions.json`

## 许可证

MIT

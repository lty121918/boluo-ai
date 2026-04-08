import esbuild from "esbuild";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const watch = process.argv.includes("--watch");
const outdir = ".";
const stylesSource = path.join("src", "ui", "styles.css");
const stylesTarget = path.join(outdir, "styles.css");
const deployFiles = ["main.js", "styles.css", "manifest.json", "versions.json", "boluo-logo.svg"];
const manifest = JSON.parse(readFileSync(path.join(".", "manifest.json"), "utf8"));
const pluginId = manifest.id;

const buildOptions = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: path.join(outdir, "main.js"),
  format: "cjs",
  platform: "browser",
  target: "es2020",
  sourcemap: watch ? "inline" : false,
  external: ["obsidian", "electron"],
  logLevel: "info"
};

function copyAssets() {
  copyFileSync(stylesSource, stylesTarget);
  deployPluginBuild();
}

function resolvePluginDeployDir() {
  if (process.env.OBSIDIAN_PLUGIN_DIR) {
    return process.env.OBSIDIAN_PLUGIN_DIR;
  }

  const candidates = [
    path.resolve("..", "Obsidian", ".obsidian", "plugins", pluginId),
    path.resolve("..", "..", "Obsidian", ".obsidian", "plugins", pluginId)
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function deployPluginBuild() {
  const pluginDeployDir = resolvePluginDeployDir();
  if (!existsSync(pluginDeployDir)) {
    return;
  }

  for (const file of deployFiles) {
    copyFileSync(path.join(outdir, file), path.join(pluginDeployDir, file));
  }
}

if (watch) {
  const context = await esbuild.context(buildOptions);
  await context.watch();
  copyAssets();
  console.log("Watching for changes...");
} else {
  await esbuild.build(buildOptions);
  copyAssets();
}

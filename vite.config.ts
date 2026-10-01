import { existsSync, readFileSync } from "node:fs";
import { resolve } from "path";
import { defineConfig, type Plugin } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import zipPack from "vite-plugin-zip-pack";
import fg from "fast-glob";

import vitePluginYamlI18n from "./yaml-plugin.js";
import { useLiveReload } from "./scripts/siyuan_live_reload.js";

const env = process.env;
const isSrcmap = env.VITE_SOURCEMAP === "inline";
const isDev = env.NODE_ENV === "development";
// 本插件无 kernel.js（docs/03 决策 #9）：仅 app target；kernel 死分支已于 26.3 移除

const outputDir = isDev ? "dev" : "dist";
const pluginManifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "plugin.json"), "utf8"));
const packageImageTargets = [
    ["icon", "icon.png"],
    ["preview", "preview.png"],
].flatMap(([field, legacyName]) => {
    const fileName = pluginManifest[field] || (existsSync(legacyName) ? legacyName : "");
    return fileName ? [{ src: `./${fileName}`, dest: "./" }] : [];
});
console.log("isDev=>", isDev);
console.log("outputDir=>", outputDir);

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(import.meta.dirname, "src"),
        }
    },

    plugins: [
        svelte(),

        vitePluginYamlI18n({
            inDir: "public/i18n",
            outDir: `${outputDir}/i18n`
        }),

        viteStaticCopy({
            targets: [
                ...packageImageTargets,
                { src: "./README*.md", dest: "./" },
                { src: "./plugin.json", dest: "./" },
            ],
        }),

        // 生产构建后打包 package.zip（26.3：单一发布命令；失败构建不留伪产物）
        ...(isDev ? [] : [zipPack({
            inDir: "./dist",
            outDir: "./",
            outFileName: "package.zip"
        })]),
    ],

    define: {
        "process.env.DEV_MODE": JSON.stringify(isDev),
        "process.env.NODE_ENV": JSON.stringify(env.NODE_ENV)
    },

    build: {
        outDir: outputDir,
        emptyOutDir: false,
        minify: true,
        sourcemap: isSrcmap ? "inline" : false,

        lib: {
            entry: resolve(import.meta.dirname, "src/index.ts"),
            fileName: () => "index.js",
            cssFileName: "index",
            formats: ["cjs"],
        },
        rollupOptions: {
            plugins: isDev ? [
                useLiveReload({ outputDir }),
                watchExternalFiles([
                    "public/i18n/**",
                    "./README*.md",
                    "./plugin.json"
                ])
            ] : [
                cleanupDistFiles({
                    patterns: ["i18n/*.yaml", "i18n/*.md"],
                    distDir: outputDir
                }),
            ],

            external: ["siyuan", "process"],

            output: {
                entryFileNames: "[name].js",
                assetFileNames: (assetInfo) => assetInfo.name ?? "asset",
            },
        },
    }
});

function watchExternalFiles(patterns: string[]): Plugin {
    return {
        name: "watch-external",
        async buildStart() {
            const files = await fg(patterns);
            for (const file of files) {
                this.addWatchFile(file);
            }
        }
    };
}

/**
 * Clean up some dist files after compiled
 * @author frostime
 */
function cleanupDistFiles(options: { patterns: string[]; distDir: string }): Plugin {
    const {
        patterns,
        distDir
    } = options;

    return {
        name: "rollup-plugin-cleanup",
        enforce: "post",
        writeBundle: {
            sequential: true,
            order: "post" as const,
            async handler() {
                const fg = await import("fast-glob");
                const fs = await import("fs");
                const distPatterns = patterns.map(pat => `${distDir}/${pat}`);
                const files = await fg.default(distPatterns, {
                    dot: true,
                    absolute: true,
                    onlyFiles: false
                });
                for (const file of files) {
                    try {
                        if (fs.default.existsSync(file)) {
                            const stat = fs.default.statSync(file);
                            if (stat.isDirectory()) {
                                fs.default.rmSync(file, { recursive: true });
                            } else {
                                fs.default.unlinkSync(file);
                            }
                        }
                    } catch (error) {
                        console.error("Failed to clean up:", file, error);
                    }
                }
            }
        }
    };
}

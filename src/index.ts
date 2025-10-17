import { execSync } from "node:child_process";
import path from "node:path";
import vitePluginRsync from "@moritzloewenstein/vite-plugin-rsync";
import sassGlobImports from "@moritzloewenstein/vite-plugin-sass-glob-import";
import vitePluginZip from "@moritzloewenstein/vite-plugin-zip";
import type { PluginOption, ViteDevServer } from "vite";

interface UserConfig {
	themeName: string;
	useZip: boolean;
	useRsync: boolean;
	rsync?: {
		target: {
			/**
			 * rsync target user
			 */
			user: string;
			/**
			 * rsync target host
			 */
			host: string;
			/**
			 * rsync target port
			 * @default 21
			 */
			port?: number;
			/**
			 * rsync target path
			 */
			path: string;
		};
	};
}

const INCLUDE = ["**/*"];
const EXCLUDE = [
	"**/*.scss",
	// blocks
	"blocks/_block/**/*",
	"blocks/*/block.js",
	// development
	"stubs/**/*",
	".vscode/**/*",
	".gitignore",
	".git/**/*",
	".github/**/*",
	"scripts/**/*",
	".php-cs-fixer.dist.php",
	//".env.example",
	"biome.json",
	"vite.config.js",
	"phpstan.neon.dist",
	// dependencies
	"node_modules/**/*",
	"vendor/**/*",
	// docs & other
	"readme.md",
	"package.json",
	"package-lock.json",
];

export function getVitePlugins(config: UserConfig): PluginOption[] {
	const plugins = [];
	const sassGlob = sassGlobImports({
		autoInvalidation: true,
		ignorePaths: ["blocks/_block/block.scss"],
	});
	plugins.push(sassGlob);

	const phpReload: PluginOption = {
		name: "reload",
		apply: "serve",
		configureServer(server: ViteDevServer) {
			const { ws, watcher } = server;
			watcher.on("change", (file) => {
				console.log(file);
				if (file.endsWith(".php")) {
					ws.send({
						type: "full-reload",
					});
				}
			});
		},
	};
	plugins.push(phpReload);

	if (config.useZip) {
		const zip = vitePluginZip({
			zipName: `${config.themeName}.zip`,
			include: INCLUDE,
			exclude: EXCLUDE,
			beforeClose(archive) {
				// add composer prod dependencies to zip
				const cwd = process.cwd();
				const distVendor = path.join(cwd, "dist", "vendor");
				execSync("composer install --no-dev --optimize-autoloader --quiet", {
					cwd,
					env: {
						...process.env,
						COMPOSER_VENDOR_DIR: distVendor,
					},
				});
				archive.directory(distVendor, "vendor");
			},
		});
		plugins.push(zip);
	}

	if (config.useRsync) {
		if (!config?.rsync?.target) {
			console.warn("config.rsync.target is missing, rsync is not enabled");
		} else {
			const rsync = vitePluginRsync({
				target: config.rsync.target,
				include: INCLUDE,
				exclude: EXCLUDE,
			});
			plugins.push(rsync);
		}
	}

	return plugins;
}

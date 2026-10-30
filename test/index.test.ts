import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { VitePluginRsync } from "@moritzloewenstein/vite-plugin-rsync";
import type { VitePluginZip } from "@moritzloewenstein/vite-plugin-zip";
import type { ResolvedConfig } from "vite";
import { getVitePlugins } from "../src/index.ts";

describe("getVitePlugins deployment configuration", () => {
	it("forwards an SSH password to rsync without placing it in arguments", async () => {
		const directory = mkdtempSync(path.join(os.tmpdir(), "vite-wp-theme-"));
		const capturePath = path.join(directory, "capture.json");
		const executablePath = path.join(directory, "rsync");
		const originalPath = process.env.PATH;
		const originalCapturePath = process.env.TEST_RSYNC_CAPTURE;
		const originalSshpass = process.env.SSHPASS;

		writeFileSync(
			executablePath,
			'#!/usr/bin/env node\nconst { writeFileSync } = require("node:fs");\nwriteFileSync(process.env.TEST_RSYNC_CAPTURE, JSON.stringify({ args: process.argv.slice(2), password: process.env.SSHPASS }));\n',
		);
		chmodSync(executablePath, 0o755);
		process.env.PATH = `${directory}${path.delimiter}${originalPath ?? ""}`;
		process.env.TEST_RSYNC_CAPTURE = capturePath;
		delete process.env.SSHPASS;

		try {
			const plugin = getVitePlugins({
				themeName: "test-theme",
				useZip: false,
				useRsync: true,
				exclude: ["task.md"],
				rsync: {
					target: {
						user: "testuser",
						host: "example.com",
						path: "/var/www",
						password: "test-password",
					},
				},
			}).find(
				(candidate) =>
					typeof candidate === "object" &&
					candidate !== null &&
					!Array.isArray(candidate) &&
					"name" in candidate &&
					candidate.name === "moritzloewenstein:vite-plugin-rsync",
			) as VitePluginRsync | undefined;

			assert.ok(plugin);
			plugin.configResolved({
				root: directory,
				logger: {
					error: () => {},
					info: () => {},
				},
			} as unknown as ResolvedConfig);
			await plugin.closeBundle.handler();

			const result = JSON.parse(readFileSync(capturePath, "utf8")) as {
				args: string[];
				password?: string;
			};
			assert.ok(result.args.includes("--rsh=sshpass -e ssh -p 22"));
			assert.ok(result.args.some((argument) => argument.includes("task.md")));
			assert.equal(result.password, "test-password");
			assert.ok(
				result.args.every((argument) => !argument.includes("test-password")),
			);
		} finally {
			if (originalPath === undefined) delete process.env.PATH;
			else process.env.PATH = originalPath;
			if (originalCapturePath === undefined)
				delete process.env.TEST_RSYNC_CAPTURE;
			else process.env.TEST_RSYNC_CAPTURE = originalCapturePath;
			if (originalSshpass === undefined) delete process.env.SSHPASS;
			else process.env.SSHPASS = originalSshpass;
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("applies additional exclusions to theme archives", async () => {
		const directory = mkdtempSync(path.join(os.tmpdir(), "vite-wp-theme-"));
		const binDirectory = path.join(directory, "bin");
		const distDirectory = path.join(directory, "dist");
		const vendorDirectory = path.join(distDirectory, "vendor");
		const composerPath = path.join(binDirectory, "composer");
		const originalPath = process.env.PATH;

		mkdirSync(binDirectory, { recursive: true });
		mkdirSync(vendorDirectory, { recursive: true });
		mkdirSync(path.join(directory, ".local"), { recursive: true });
		mkdirSync(path.join(directory, ".amp"), { recursive: true });
		mkdirSync(path.join(directory, "blocks", "sample"), { recursive: true });
		writeFileSync(composerPath, "#!/bin/sh\nexit 0\n");
		chmodSync(composerPath, 0o755);
		writeFileSync(path.join(directory, "index.php"), "<?php\n");
		writeFileSync(path.join(directory, "task.md"), "private task notes\n");
		writeFileSync(
			path.join(directory, ".local", "credentials.txt"),
			"secret\n",
		);
		writeFileSync(path.join(directory, ".amp", "thread.txt"), "private\n");
		writeFileSync(path.join(directory, ".DS_Store"), "metadata\n");
		writeFileSync(path.join(directory, ".php-cs-fixer.cache"), "cache\n");
		writeFileSync(path.join(directory, ".prettierrc"), "{}\n");
		writeFileSync(path.join(directory, "tsconfig.json"), "{}\n");
		writeFileSync(
			path.join(directory, "vite-env.d.ts"),
			"declare const x: string;\n",
		);
		writeFileSync(
			path.join(directory, "blocks", "sample", "block.js"),
			"export {};\n",
		);
		writeFileSync(
			path.join(directory, "blocks", "sample", "block.ts"),
			"export {};\n",
		);
		writeFileSync(path.join(vendorDirectory, "autoload.php"), "<?php\n");
		writeFileSync(path.join(distDirectory, "test-theme.zip"), "old archive\n");
		process.env.PATH = `${binDirectory}${path.delimiter}${originalPath ?? ""}`;

		try {
			const plugin = getVitePlugins({
				themeName: "test-theme",
				useZip: true,
				useRsync: false,
				exclude: ["task.md"],
			}).find(
				(candidate) =>
					typeof candidate === "object" &&
					candidate !== null &&
					!Array.isArray(candidate) &&
					"name" in candidate &&
					candidate.name === "moritzloewenstein:vite-plugin-zip",
			) as VitePluginZip | undefined;

			assert.ok(plugin);
			plugin.configResolved({
				root: directory,
				build: { outDir: "dist" },
			} as unknown as ResolvedConfig);
			await plugin.closeBundle.handler();

			const archivePath = path.join(distDirectory, "test-theme.zip");
			const entries = execFileSync("unzip", ["-Z1", archivePath], {
				encoding: "utf8",
			});
			const archivedFiles = entries.split("\n");
			assert.ok(archivedFiles.includes("index.php"));
			for (const excludedFile of [
				"task.md",
				".local/credentials.txt",
				".amp/thread.txt",
				".DS_Store",
				".php-cs-fixer.cache",
				".prettierrc",
				"tsconfig.json",
				"vite-env.d.ts",
				"blocks/sample/block.js",
				"blocks/sample/block.ts",
				"dist/test-theme.zip",
			]) {
				assert.ok(
					!archivedFiles.includes(excludedFile),
					`${excludedFile} should not be included in the theme archive`,
				);
			}
		} finally {
			if (originalPath === undefined) delete process.env.PATH;
			else process.env.PATH = originalPath;
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

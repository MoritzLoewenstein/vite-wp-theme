import assert from "node:assert/strict";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { VitePluginRsync } from "@moritzloewenstein/vite-plugin-rsync";
import type { ResolvedConfig } from "vite";
import { getVitePlugins } from "../src/index.ts";

describe("getVitePlugins rsync configuration", () => {
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
});

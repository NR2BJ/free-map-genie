#!/usr/bin/env node
/**
 * Signs the built Firefox package on addons.mozilla.org and drops the signed
 * `.xpi` into `release-assets/`.
 *
 * Credentials come from https://addons.mozilla.org/developers/addon/api/key/:
 *
 *   export WEB_EXT_API_KEY="user:12345678:123"
 *   export WEB_EXT_API_SECRET="0123456789abcdef..."
 *   node tools/sign-firefox.mjs
 *
 * `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` are accepted as aliases. Use
 * `AMO_CHANNEL=listed` for a public listing; the default `unlisted` channel
 * self-distributes the signed XPI without a store listing.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(repoRoot, ".output/firefox-mv3");
const artifactsDir = join(repoRoot, ".output/amo");
const releaseDir = join(repoRoot, "release-assets");

const apiKey = process.env.WEB_EXT_API_KEY ?? process.env.AMO_JWT_ISSUER;
const apiSecret = process.env.WEB_EXT_API_SECRET ?? process.env.AMO_JWT_SECRET;
const channel = process.env.AMO_CHANNEL ?? "unlisted";

const readVersion = async () =>
  JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")).version;

const sha256 = async (path) =>
  createHash("sha256").update(await readFile(path)).digest("hex");

const assertBuilt = async () => {
  try {
    await stat(join(sourceDir, "manifest.json"));
  } catch {
    throw new Error(
      "No Firefox build found. Run `yarn build:firefox` before signing."
    );
  }
};

const updateChecksums = async () => {
  const version = await readVersion();
  const names = [
    `fmg-${version}-chrome.zip`,
    `fmg-${version}-firefox.xpi`,
    `fmg-${version}-sources.zip`,
  ];
  const lines = [];
  for (const name of names) {
    const path = join(releaseDir, name);
    try {
      lines.push(`${await sha256(path)}  ${name}`);
    } catch {
      // artifact not built yet, skip it
    }
  }
  if (lines.length > 0) {
    await writeFile(join(releaseDir, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
    console.log(`\nUpdated SHA256SUMS.txt:\n${lines.join("\n")}`);
  }
};

const main = async () => {
  if (!apiKey || !apiSecret) {
    console.error(
      [
        "Missing AMO credentials.",
        "",
        "Create them at https://addons.mozilla.org/developers/addon/api/key/ then:",
        '  export WEB_EXT_API_KEY="user:12345678:123"',
        '  export WEB_EXT_API_SECRET="..."',
        "  node tools/sign-firefox.mjs",
        "",
        "Without credentials the unsigned packages still work for local testing:",
        "  yarn zip && yarn zip:firefox",
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }

  await assertBuilt();
  await rm(artifactsDir, { recursive: true, force: true });
  await mkdir(artifactsDir, { recursive: true });
  await mkdir(releaseDir, { recursive: true });

  console.log(`Signing ${sourceDir} on AMO (${channel})...`);
  execFileSync(
    "npx",
    [
      "--yes",
      "web-ext@8",
      "sign",
      "--source-dir",
      sourceDir,
      "--artifacts-dir",
      artifactsDir,
      "--channel",
      channel,
      "--api-key",
      apiKey,
      "--api-secret",
      apiSecret,
    ],
    { stdio: "inherit", cwd: repoRoot }
  );

  const xpi = (await readdir(artifactsDir)).find((name) => name.endsWith(".xpi"));
  if (!xpi) throw new Error("AMO signing finished but produced no .xpi.");

  const version = await readVersion();
  const target = join(releaseDir, `fmg-${version}-firefox.xpi`);
  await copyFile(join(artifactsDir, xpi), target);
  console.log(`\nSigned package -> ${target}`);
  await updateChecksums();
};

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});

#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const vm = require("vm");

async function main() {
  const inputArg = process.argv[2];

  if (!inputArg) {
    throw new Error("Usage: node scripts/validate-inline-scripts.cjs <html-file>");
  }

  const inputPath = path.resolve(process.cwd(), inputArg);
  const html = await fs.readFile(inputPath, "utf8");
  const scriptPattern = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  const failures = [];
  let count = 0;
  let match;

  while ((match = scriptPattern.exec(html)) !== null) {
    count += 1;
    const source = String(match[1] || "").trim();
    if (!source) continue;
    try {
      new vm.Script(source, { filename: `${path.basename(inputPath)}:inline-script-${count}` });
    } catch (error) {
      failures.push({
        index: count,
        message: error && error.message ? error.message : String(error)
      });
    }
  }

  if (failures.length) {
    failures.forEach((failure) => {
      console.error(`Inline script ${failure.index} failed syntax validation: ${failure.message}`);
    });
    process.exit(1);
  }

  console.log(`Validated ${count} inline script blocks in ${path.relative(process.cwd(), inputPath)}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

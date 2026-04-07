#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { minify } = require("html-minifier-terser");
const terser = require("terser");

async function minifyInlineJs(code, inline) {
  const result = await terser.minify(code, {
    compress: false,
    mangle: false,
    parse: inline ? { bare_returns: true } : {},
    format: {
      beautify: false,
      comments: false,
      semicolons: true
    }
  });

  if (result.error) {
    throw result.error;
  }

  return result.code || "";
}

async function main() {
  const inputArg = process.argv[2] || "webapp/index.html";
  const outputArg = process.argv[3] || inputArg;
  const cwd = process.cwd();
  const inputPath = path.resolve(cwd, inputArg);
  const outputPath = path.resolve(cwd, outputArg);

  const source = await fs.readFile(inputPath, "utf8");
  const minified = await minify(source, {
    caseSensitive: true,
    collapseWhitespace: true,
    conservativeCollapse: true,
    html5: true,
    keepClosingSlash: true,
    minifyCSS: true,
    minifyJS: (code, inline) => minifyInlineJs(code, inline),
    removeComments: true,
    removeEmptyAttributes: false,
    removeOptionalTags: false,
    removeRedundantAttributes: false,
    removeScriptTypeAttributes: false,
    removeStyleLinkTypeAttributes: false,
    useShortDoctype: true
  });

  await fs.writeFile(outputPath, minified, "utf8");
  console.log(`Minified ${path.relative(cwd, inputPath)} -> ${path.relative(cwd, outputPath)}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

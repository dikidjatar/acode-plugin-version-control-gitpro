import { exec } from "child_process";
import * as esbuild from "esbuild";
import { sassPlugin } from "esbuild-sass-plugin";

const isServe = process.argv.includes("--serve");

// Function to pack the ZIP file
function packZip() {
  exec("node ./pack-zip.js", (err, stdout, stderr) => {
    if (err) {
      console.error("Error packing zip:", err);
      return;
    }
    console.log(stdout.trim());
  });
}

// Custom plugin to pack ZIP after build or rebuild
const zipPlugin = {
  name: "zip-plugin",
  setup(build) {
    build.onEnd(() => {
      packZip();
    });
  },
};

// Custom plugin to redirect CodeMirror dependencies to Acode's global acode.require system
const codemirrorExternalPlugin = {
  name: "codemirror-external",
  setup(build) {
    build.onResolve({ filter: /^@codemirror\/(state|view|language|autocomplete|commands|lint|search)$|^codemirror$/ }, (args) => {
      return { path: args.path, namespace: "codemirror-external" };
    });
    build.onLoad({ filter: /.*/, namespace: "codemirror-external" }, (args) => {
      return {
        contents: `module.exports = acode.require('${args.path}');`,
        loader: "js",
      };
    });
  },
};

// Base build configuration
let buildConfig = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  minify: !isServe,
  logLevel: "info",
  color: true,
  outdir: "dist",
  plugins: [codemirrorExternalPlugin, zipPlugin, sassPlugin()],
  resolveExtensions: ['.ts', '.d.ts']
};

// Main function to handle both serve and production builds
(async function () {
  if (isServe) {
    console.log("Starting development server...");

    // Watch and Serve Mode
    const ctx = await esbuild.context(buildConfig);

    await ctx.watch();
    const { host, port } = await ctx.serve({
      servedir: ".",
      port: 3000,
    });

  } else {
    console.log("Building for production...");
    await esbuild.build(buildConfig);
    console.log("Production build complete.");
  }
})();
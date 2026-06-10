const fs = require("fs");
const path = require("path");

const targets = ["dist/main.js", "dist/main.css", "plugin.zip", "dist.zip"];

for (const target of targets) {
  const targetPath = path.join(process.cwd(), target);
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

console.log("Clean completed.");

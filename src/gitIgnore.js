// Copyright (c) [2025] [Diki Djatar]
// SPDX-License-Identifier: MIT

import git from "./git";
import { runWorkers } from "./utils";

let isProcessing = false;
const pendingFiles = new Set();

export default { checkIgnoredFiles, isIgnored }

async function checkIgnoredFiles(filepaths, concurrency = 50) {
  const results = new Map();

  if (filepaths.length > 0) {
    await runWorkers(filepaths.length, async (index) => {
      const filepath = filepaths[index];
      try {
        const isIgnored = await git.post('/isIgnored', { filepath });
        results.set(filepath, isIgnored);
      } catch (error) {
        results.set(filepath, false);
      }
    }, concurrency);
  }

  return results;
}

async function isIgnored(filepaths) {
  if (isProcessing) {
    filepaths.forEach(fp => pendingFiles.add(fp));
    return;
  }

  isProcessing = true;

  try {
    const allFiles = [...new Set([...filepaths, ...pendingFiles])];
    pendingFiles.clear();

    const results = await checkIgnoredFiles(allFiles, 100);
    return results;
  } finally {
    isProcessing = false;

    if (pendingFiles.size > 0) {
      setTimeout(() => isIgnored([]), 100);
    }
  }
}
// Copyright (c) [2025] [Diki Djatar]
// SPDX-License-Identifier: MIT

import BaseError, { InvalidUri, UnsupportedUri, UriNotAllowed } from "./errors";

const PACKAGE_NAME = window.BuildInfo
  ? window.BuildInfo.packageName
  : window.IS_FREE_VERSION
    ? 'com.foxdebug.acodefree'
    : 'com.foxdebug.acode';

const TERMUX_PREFIX = 'content://com.termux.documents/tree/';
const ANDROID_EXTERNAL_PREFIX = 'content://com.android.externalstorage.documents/tree/';
const ACODE_PREFIX = `content://${PACKAGE_NAME}.documents/tree/`;
const FILE_PREFIX = 'file://';
const TERMUX_HOME_PREFIX = '/data/data/com.termux/files/home';
const TERMUX_STORAGE_PREFIX = `${TERMUX_HOME_PREFIX}/storage`;
const TERMUX_SHARED_PREFIX = `${TERMUX_STORAGE_PREFIX}/shared`;

export function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try { new URL(url); return true; } catch (e) { return false; }
}

/**
 * @param {string} uri
 * @returns {string} resolved path
 */
export function resolveRepoDir(uri) {
  if (!uri || typeof uri !== 'string') {
    throw new InvalidUri(uri);
  }

  const decoded = decodeURIComponent(uri.trim());

  if (decoded.startsWith(TERMUX_PREFIX)) {
    return resolveTermuxUri(decoded);
  }
  if (decoded.startsWith(ANDROID_EXTERNAL_PREFIX)) {
    return resolveAndroidExternalUri(decoded);
  }
  if (decoded.startsWith(FILE_PREFIX)) {
    return resolveFileUri(decoded);
  }
  if (decoded.startsWith(ACODE_PREFIX)) {
    return resolveAcodeUri(decoded);
  }

  throw new UnsupportedUri(uri);
}

function resolveTermuxUri(decodedUri) {
  const after = decodedUri.slice(TERMUX_PREFIX.length);
  // must contain '::' with a specific path;
  // plain home-only references are disallowed
  if (!after.includes('::')) {
    throw new UriNotAllowed('termux home directory');
  }

  const path = after.split('::')[1];
  if (
    path === TERMUX_HOME_PREFIX ||
    path === TERMUX_STORAGE_PREFIX ||
    path === TERMUX_SHARED_PREFIX
  ) {
    throw new UriNotAllowed(path);
  }

  return path;
}

function resolveAndroidExternalUri(decodedUri) {
  const after = decodedUri.slice(ANDROID_EXTERNAL_PREFIX.length);
  const parts = after.split('::').map(s => s.trim()).filter(Boolean);

  const rootSpec = parsePrimarySpec(parts[0]);
  if (!rootSpec) throw new InvalidUri('Invalid Android external root spec');

  const rootName = rootSpec.rest.split('/')[0];
  if (!rootName) {
    throw new InvalidUri('Invalid Android external root folder');
  }

  const base = `/sdcard/${rootName}`;

  if (parts.length === 1) {
    const abs = removeTrailingSlash(base);
    return abs;
  }

  // parts[1] contains the detailed right-side spec
  let rightSpec = parsePrimarySpec(parts[1]);
  let rightRest = rightSpec ? rightSpec.rest : parts[0] || '';
  rightRest = rightRest.replace(/^\/+/, '');

  if (rightRest.startsWith(rootName + '/')) {
    rightRest = rightRest.slice(rootName.length + 1);
  } else if (rightRest === rootName) {
    rightRest = '';
  }

  const joined = rightRest ? `${base}/${rightRest}` : base;
  const abs = removeTrailingSlash(joined);
  return abs;
}

function resolveFileUri(decodedUri) {
  let pathPart = decodedUri.slice(FILE_PREFIX.length);
  const storageEmulatedPrefix = '/storage/emulated/0';
  if (pathPart.startsWith(storageEmulatedPrefix + '/')) {
    const rest = pathPart.slice(storageEmulatedPrefix.length);
    return removeTrailingSlash('/sdcard' + rest);
  }

  return removeTrailingSlash(pathPart);
}

/**
 * @param {string} uri 
 */
function resolveAcodeUri(uri) {
  let after = uri.slice(ACODE_PREFIX.length);
  if (!after.includes('::')) {
    throw new UriNotAllowed('acode home directory');
  }
  return after.split('::')[1];
}

function removeTrailingSlash(p) {
  if (p === '/') return p;
  return p.replace(/\/+$/, '');
}

function parsePrimarySpec(spec) {
  const idx = spec.indexOf(':');
  if (idx === -1) return null;
  const storageType = spec.slice(0, idx);
  const rest = spec.slice(idx + 1);
  return { storageType, rest };
}

/**
 * @param {string} filename 
 * @param {Acode.FileOptions} options
 * @returns {Promise<Acode.EditorFile>}
 */
export function openFileAndAwait(filename, options = {}) {
  return new Promise((resolve) => {
    const EditorFile = acode.require('editorFile');
    /** @type {Acode.EditorFile} */
    const file = new EditorFile(filename, options);
    file.makeActive();
    file.on('close', e => {
      file.off('close');
      resolve(e.target);
    });
  });
}

export function getModeForFile(filename) {
  const { getModeForPath } = ace.require('ace/ext/modelist');
  const { name } = getModeForPath(filename);
  return `ace/mode/${name}`;
}

function kindFromMatrix(head, workdir, stage, notStage = false) {
  if (head === 0 && workdir === 2) {
    return stage === 3 && notStage ? 'modified' : 'new file';
  };
  if (head === 1 && workdir === 2) return 'modified';
  if (head === 1 && workdir === 0) return 'deleted';
  return 'changed';
}

/**
 * @param {string} path 
 * @param {StatusRow[]} statusRows 
 * @param {string} branch 
 */
export function createCommitTemplate(statusRows = [], branch = '') {
  const staged = [];
  const notStaged = [];
  const untracked = [];

  for (const row of statusRows) {
    const [fp, head, workdir, stage] = row;

    if (head === 0 && workdir === 2 && stage === 0) {
      untracked.push(fp);
      continue;
    }

    const isStaged = (
      (stage === 2 || stage === 3) ||
      (head === 1 && stage === 0 && workdir === 0)
    );
    const isUnstaged = (
      (workdir === 2 && (stage === 0 || stage === 1)) ||
      (head === 1 && workdir === 0 && stage === 1) ||
      (stage === 3 && workdir === 2)
    );

    if (isStaged) staged.push({
      path: fp,
      kind: kindFromMatrix(head, workdir, stage)
    });

    if (isUnstaged) notStaged.push({
      path: fp,
      kind: kindFromMatrix(head, workdir, stage, true)
    });
  }

  const lines = [];
  lines.push('\n# Please enter the commit message for your changes. Lines starting');
  lines.push('# with \'#\' will be ignored, and an empty message aborts the commit.');
  lines.push('# ')
  lines.push(`# On branch ${branch}`);
  lines.push(`# Changes to be committed:`);

  if (staged.length > 0) {
    for (const e of staged) {
      lines.push(`# ${e.kind}: ${e.path}`);
    }
  }

  if (notStaged.length > 0) {
    lines.push('# ');
    lines.push('# Changes not staged for commit:');
    for (const e of notStaged) {
      lines.push(`# ${e.kind}: ${e.path}`);
    }
  }

  if (untracked.length > 0) {
    lines.push('# ')
    lines.push('# Untracked files:');
    for (const e of untracked) {
      lines.push(`# ${e}`);
    }
  }

  lines.push('#');
  lines.push('');

  return lines.join('\n');
}

/**
 * parse file: remove comment lines (starting with '#')
 * @param {string} content 
 * @returns {string} 
 */
function parseCommitMessage(content) {
  const lines = content.split(/\r?\n/).map(l => l.trim());
  const contentLines = lines.filter(l => !l.startsWith('#'));
  return contentLines.join('\n').trim();
}

/**
 * @param {string} gitDir
 */
export async function openCOMMIT_EDITMSG(gitDir, content = '') {
  const fs = acode.require('fs');
  const filename = 'COMMIT_EDITMSG';
  const filepath = `${gitDir}/${filename}`;
  const commitEditMsgFile = fs(filepath);
  if (!(await commitEditMsgFile.exists())) {
    await fs(gitDir).createFile(filename);
  }
  await commitEditMsgFile.writeFile(content);
  const file = await openFileAndAwait(filename, { uri: filepath });
  const messageContent = await fs(file.uri).readFile('utf-8');
  return parseCommitMessage(messageContent);
}

export function getErrorDetails(error) {
  try {
    if (error instanceof BaseError) {
      return JSON.stringify(error.toJSON(), null, 2);
    }
    return JSON.stringify({
      message: error.message,
      stack: error.stack
    }, null, 2);
  } catch (error) {
    return String(error);
  }
}

export function logError(error, details) {
  console.groupCollapsed('[VersionControl] Error');
  console.error(error);
  console.log(details);
  console.groupEnd();
}

/**
 * Lightweight concurrency limiter (worker pool).
 * Takes a workCount and an async worker function that receives index.
 * This avoids building large intermediate arrays when processing many files.
 *
 * @param {number} count total items
 * @param {function(number): Promise<any>} worker async fn called with index until all processed
 * @param {number} concurrency max parallel workers
 */
export async function runWorkers(count, worker, concurrency = 100) {
  const limit = Math.max(1, Math.min(concurrency, count));
  let next = 0;
  const results = [];
  const workers = new Array(limit).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= count) return;
      try {
        results[i] = await worker(i);
      } catch (err) {
        results[i] = { error: err };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export function isFileInRepo(repoDir, fileUri) {
  try {
    const resolvedPath = resolveRepoDir(fileUri);
    return resolvedPath.startsWith(repoDir);
  } catch (error) {
    return false;
  }
}

export function hasStagedDiffersFromHead(oids) {
  const { headOid, workdirOid, stageOid } = oids;
  if (!stageOid) return false;
  if (stageOid === headOid || stageOid === workdirOid) {
    return false;
  }
  return true;
}

/**
 * Deletes multiple files concurrently with optimized performance
 * @param {Array<string>} filepaths Array of file paths to delete
 */
export async function deleteFiles(filepaths, batchSize = 10, delay = 10) {
  const fs = acode.require('fs');
  const deletePromises = filepaths.map(async (fp) => {
    try {
      // Add delay between batches to prevent overwhelming system
      await new Promise(resolve => setTimeout(resolve, delay));
      await fs(fp).delete();
    } catch (e) { }
  });
  for (let i = 0; i < deletePromises.length; i += batchSize) {
    const batch = deletePromises.slice(i, i + batchSize);
    await Promise.all(batch);
  }
}
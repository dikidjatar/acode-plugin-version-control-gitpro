// Copyright (c) [2025] [Diki Djatar]
// SPDX-License-Identifier: MIT

import git from "./git";
import settings from "./settings";
import { resolveRepoDir, runWorkers } from "./utils";

const Url = acode.require('url');

const GIT_SYMBOLS = ['A', 'M', 'U', 'D'];
const GIT_CLASSES = GIT_SYMBOLS.map(s => `git-status-${s}`);
const GIT_FOLDER_PRIORITY = GIT_SYMBOLS.slice(0, 3);

/** @type {Map<string, FileStatus>} */
const pathMap = new Map();

/** @type {Map<string, boolean>} */
const ignoreMap = new Map();

export default {
  syncWithGit: sync,
  syncIgnoreOnly,
  getVisibleFilePaths,
  isActive,
  clear,
  observeFileTreeForExpands
}

/**
 * @param {HTMLElement} targetNode 
 * @param {Map<string, boolean>} ignoreStatus
 */
async function sync(targetNode, ignoreStatus = null) {
  pathMap.clear();

  if (!settings.gitDecorations) {
    clearAllDecorations(targetNode);
    return;
  };

  const repoDir = git.getRepoDir();
  const filepaths = getVisibleFilePaths(targetNode);
  const files = (await git.status({ filepaths })).files;

  for (const s of files) {
    if (!s || !s.filepath) continue;
    const p = Url.join(repoDir, s.filepath);
    pathMap.set(p, s);
  }

  if (ignoreStatus) {
    for (const [fp, isIgnored] of ignoreStatus.entries()) {
      const fullPath = Url.join(repoDir, fp);
      ignoreMap.set(fullPath, isIgnored);
    }
  }

  const visibleTiles = getVisibleTiles(targetNode);
  const folderCounts = calculateFolderCounts(repoDir);

  await runWorkers(visibleTiles.length, async (index) => {
    const $tile = visibleTiles[index];
    if (!$tile) return;

    const isFolder = $tile.dataset.type === 'dir';
    if (isFolder) {
      updateFolder($tile, folderCounts);
    } else {
      updateFile($tile);
    }
  });
}

async function syncIgnoreOnly(targetNode, ignoreStatus) {
  if (!ignoreStatus || !settings.gitDecorations) return;

  const repoDir = git.getRepoDir();

  // Update ignore map
  for (const [filepath, isIgnored] of ignoreStatus.entries()) {
    const fullPath = Url.join(repoDir, filepath);
    ignoreMap.set(fullPath, isIgnored);
  }

  const visibleTiles = getVisibleTiles(targetNode);
  await runWorkers(visibleTiles.length, async (index) => {
    const $tile = visibleTiles[index];
    if (!$tile) return;

    const isFolder = $tile.dataset.type === 'dir';
    if (!isFolder) {
      updateFileIgnoreStatus($tile);
    } else {
      updateFolderIgnoreStatus($tile);
    }
  });
}

function getVisibleTiles(targetNode) {
  return Array.from(targetNode.querySelectorAll('.tile[data-url]'));
}

function getVisibleFilePaths(targetNode) {
  const visibleTiles = getVisibleTiles(targetNode);
  const repoDir = git.getRepoDir();
  const filePaths = [];

  for (const tile of visibleTiles) {
    try {
      const isFolder = tile.dataset.type === 'dir';
      const tilePath = resolveRepoDir(tile.dataset.url || '');
      if (tilePath && tilePath.startsWith(repoDir)) {
        const relativePath = tilePath.slice(repoDir.length + 1);
        if (!relativePath) continue;
        filePaths.push(isFolder ? relativePath + '/' : relativePath);
      }
    } catch (e) { }
  }

  return filePaths;
}

/**
 * Update file ignore status only
 */
function updateFileIgnoreStatus($tile) {
  const $text = getTextElement($tile);
  const tilePath = getTilePath($tile);
  if (!$text || !tilePath) return;

  const isIgnored = ignoreMap.get(tilePath);

  $text.classList.remove('git-status-I');
  if (isIgnored === true) {
    $text.classList.add('git-status-I');
  }
}

/**
 * Update folder ignore status only
 */
function updateFolderIgnoreStatus($tile) {
  const $text = getTextElement($tile);
  const tilePath = getTilePath($tile);
  if (!$text || !tilePath) return;

  const isFolder = $tile.dataset.type === 'dir';
  const hasIgnoredFiles = ignoreMap.get(isFolder ? tilePath + '/' : tilePath);

  $text.classList.remove('git-status-I');
  if (hasIgnoredFiles === true) {
    $text.classList.add('git-status-I');
  }
}

/**
 * @param {HTMLElement} $tile 
 */
function updateFolder($tile, folderCounts) {
  const $text = getTextElement($tile);
  const tilePath = getTilePath($tile);
  clearGitClasses($text);

  if (!$text || !tilePath) return;

  const counts = folderCounts.get(tilePath);
  if (counts && counts.total > 0) {
    const dominant = computeDominantStatus(counts);
    if (dominant) {
      $text.classList.add(`git-status-${dominant}`);
    }
  }

  const isIgnored = ignoreMap.get(tilePath);
  if (isIgnored === true) {
    $text.classList.add('git-status-I');
  }
}

/**
 * @param {HTMLElement} $tile 
 */
function updateFile($tile) {
  const $text = getTextElement($tile);
  const tilePath = getTilePath($tile);
  if (!$text) return;
  if (!tilePath) {
    clearGitClasses($text);
    return;
  }

  const isParentCollapsed = _isParentCollapsed($tile);

  if (isParentCollapsed) {
    clearGitClasses($text);
    const $statusSym = $tile.querySelector(':scope > .git-status-sym');
    if ($statusSym) $statusSym.remove();
  } else {
    const fStatus = pathMap.get(tilePath);
    const isIgnored = ignoreMap.get(tilePath);

    clearGitClasses($text);

    let $statusSym = $tile.querySelector(':scope > .git-status-sym');
    if (fStatus) {
      $text.classList.add(`git-status-${fStatus.symbol}`);
      const sym = fStatus.symbol || '';
      if ($statusSym) {
        $statusSym.textContent = sym;
        $statusSym.className = `git-status-sym git-status-${sym}`;
      } else {
        $statusSym = tag('span', {
          className: `git-status-sym git-status-${sym}`,
          innerText: sym,
          style: {
            fontSize: '1em',
            height: '30px',
            minWidth: '30px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }
        });

        const $textEl = $tile.querySelector('.text');
        if ($textEl && $textEl.nextSibling) {
          $tile.insertBefore($statusSym, $textEl.nextSibling);
        } else {
          $tile.appendChild($statusSym);
        }
      }
    } else if (isIgnored === true) {
      $text.classList.add('git-status-I');
    } else if ($statusSym) {
      $statusSym.remove();
    }
  }
}

/**
 * @param {HTMLElement} $tile
 */
function getTextElement($tile) {
  return $tile.querySelector('.text');
}

function getTilePath($tile) {
  try {
    return resolveRepoDir($tile.dataset.url || '')
  } catch (e) {
    return null;
  }
}

function calculateFolderCounts(repoDir) {
  const folderCounts = new Map();

  for (const [filePath, status] of pathMap.entries()) {
    const sym = status.symbol || '';
    const idx = filePath.lastIndexOf('/');
    const fileFolder = idx > 0 ? filePath.slice(0, idx) : '/';
    const ancestors = [fileFolder, ...getFileAncestors(filePath, repoDir)];

    for (const folder of ancestors) {
      let cnt = folderCounts.get(folder);
      if (!cnt) {
        cnt = { M: 0, A: 0, U: 0, total: 0 };
        folderCounts.set(folder, cnt);
      }
      else if (cnt.hasOwnProperty(sym)) cnt[sym]++;
      cnt.total++;
    }
  }

  return folderCounts;
}

function getFileAncestors(filepath, repoRootDir) {
  const parts = filepath.split('/').filter(Boolean);
  const ancestors = [];
  for (let i = parts.length - 1; i > 0; i--) {
    const parent = '/' + parts.slice(0, i).join('/');
    if (parent === repoRootDir || parent.startsWith(repoRootDir + '/')) {
      ancestors.push(parent);
    } else if (repoRootDir.startsWith(parent)) {
      continue;
    } else {
      break;
    }
  }
  return ancestors;
}

function computeDominantStatus(counts) {
  if (!counts || counts.total === 0) return null;
  let best = null, bestCount = -1;
  for (const k of GIT_FOLDER_PRIORITY) {
    const c = counts[k] || 0;
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  if (bestCount <= 0) {
    const keys = Object
      .keys(counts)
      .filter(k => k !== 'total');
    for (const k of keys) {
      if ((counts[k] || 0) > 0) {
        best = k;
        break;
      }
    }
  }
  return best;
}

function _isParentCollapsed(tile) {
  const parentCollapsible = tile.closest('.list.collapsible');
  return parentCollapsible && parentCollapsible.classList.contains('hidden');
}

function clearGitClasses($el) {
  if (!$el) return;
  $el.classList.remove(...GIT_CLASSES);
}

function clearAllDecorations(targetNode) {
  const visibleTiles = getVisibleTiles(targetNode);
  for (const $tile of visibleTiles) {
    const $text = getTextElement($tile);
    clearGitClasses($text);
    const $statusSym = $tile.querySelector(':scope > .git-status-sym');
    if ($statusSym) $statusSym.remove();
  }
}

function isActive() {
  const doc = document.querySelector('[data-id="files"]');
  return doc ? doc.classList.contains('active') : false;
}

function clear() {
  pathMap.clear();
  ignoreMap.clear();
}

/**
 * @param {(target: Node | HTMLElement) => void} onExpandedCallback
 */
function observeFileTreeForExpands(onExpandedCallback) {
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        const target = m.target;
        if (
          target.classList &&
          target.classList.contains('list') &&
          target.classList.contains('collapsible')
        ) {
          if (!target.classList.contains('hidden')) {
            Promise.resolve().then(() => {
              if (typeof onExpandedCallback === 'function') {
                onExpandedCallback(target);
              }
            });
          }
        }
      }
    }
  });
  return observer;
}
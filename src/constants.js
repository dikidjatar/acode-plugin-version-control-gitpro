// Copyright (c) [2025] [Diki Djatar]
// SPDX-License-Identifier: MIT

export const STATUS_MAP = new Map([
  // [head-workdir-stage]
  ['0-2-0', { symbol: 'U', isStaged: false, isUnstaged: true, desc: 'New, Untracked' }],
  ['0-2-2', { symbol: 'A', isStaged: true, isUnstaged: false, desc: 'Added, staged' }],
  ['0-0-3', { symbol: 'D', isStaged: true, isUnstaged: true, desc: 'Added, deleted' }],
  ['0-2-3', { symbol: 'M', isStaged: true, isUnstaged: true, desc: 'Added, staged, with unstaged changes' }],
  ['1-1-1', { symbol: ' ', isStaged: false, isUnstaged: false, desc: 'Unmodified' }],
  ['1-2-1', { symbol: 'M', isStaged: false, isUnstaged: true, desc: 'Modified, unstaged' }],
  ['1-2-2', { symbol: 'M', isStaged: true, isUnstaged: false, desc: 'Modified, staged' }],
  ['1-2-3', { symbol: 'M', isStaged: true, isUnstaged: true, desc: 'Modified, staged, with unstaged changes' }],
  ['1-0-1', { symbol: 'D', isStaged: false, isUnstaged: true, desc: 'Deleted, unstaged' }],
  ['1-0-0', { symbol: 'D', isStaged: true, isUnstaged: false, desc: 'Deleted, staged' }],
  ['1-2-0', { symbol: 'D', isStaged: true, isUnstaged: true, desc: 'Deleted, staged, with unstaged-modified changes' }],
  ['1-1-0', { symbol: 'D', isStaged: true, isUnstaged: true, desc: 'Deleted, staged, with unstaged changes' }],
]);
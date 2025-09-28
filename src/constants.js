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

export const Icons = {
  GIT_BRANCH: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`,
  CHECK: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.4315 3.3232L5.96151 13.3232L5.1708 13.2874L1.8208 8.5174L2.63915 7.94268L5.61697 12.1827L13.6684 2.67688L14.4315 3.3232Z" fill="rgba(223, 223, 223, 1)"/></svg>`
}

export const DEFAULT_SETTINGS = {
  serverUrl: 'http://localhost:3080',
  autoRefresh: true,
  githubToken: '',
  defaultBranchName: 'master',
  gitConfigUsername: '',
  gitConfigUserEmail: ''
};
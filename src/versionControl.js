// Copyright (c) [2025] [Diki Djatar]
// SPDX-License-Identifier: MIT

import acodeFileTree from './acodeFileTree';
import branch from './branch';
import { confirmDiscardChanges } from './components';
import BaseError, { MultipleFolderSelected, NoFolderSelected, NoRemotesConfigured, RepositoryNotFound } from './errors';
import git from './git';
import gitIgnore from './gitIgnore';
import settings, { DEFAULT_SETTINGS } from './settings';
import sourceControl from './sourceControl';
import startServer from './startServer';
import './styles/style.scss';
import {
  createCommitTemplate,
  deleteFiles,
  getErrorDetails,
  getModeForFile,
  openCOMMIT_EDITMSG,
  resolveRepoDir
} from './utils';

const Alert = acode.require('alert');
const Confirm = acode.require('confirm');
const Select = acode.require('select');
const Loader = acode.require("loader");
const Prompt = acode.require('prompt');
const MultiPrompt = acode.require('multiPrompt');
const fileBrowser = acode.require('fileBrowser');
const Url = acode.require('Url');
const openFolder = acode.require('openFolder');
const appSettings = acode.require('settings');
const sidebarApps = acode.require('sidebarApps');

/**
 * Url.join when the root is an Acode SAF uri may produce an invalid uri. For example:
 * "content://com.foxdebug.acodefree.documents/tree/%2Fdata%2Fuser%2F0%2Fcom.foxdebug.acodefree%2Ffiles%2Fpublic::/data/user/0/com.foxdebug.acodefree/files/public/Acode-main:/.git"
 */
Url.joinSafe = function (...pathnames) {
  let url = Url.join(...pathnames);
  
  if (url.startsWith('content://com.foxdebug.acodefree.documents/tree/')) {
    const parts = url.split('::');
    if (parts.length > 1) {
      // Remove ':' if followed by ':/'
      url = parts[0] + '::' + parts[1].replace(':/', '/'); 
    }
  }

  return url;
}

export default class VersionControl {

  constructor(plugin) {
    const values = appSettings.value;
    if (!values[plugin.id]) {
      values[plugin.id] = DEFAULT_SETTINGS;
      appSettings.update();
    }
    this.plugin = plugin;
    this.isLoading = false;
  }

  async init() {
    try {
      this.$mainStyle = tag('link', { rel: "stylesheet", href: this.baseUrl + "main.css" });
      document.head.appendChild(this.$mainStyle);

      acode.addIcon('vcsp-icon', this.baseUrl + 'assets/source-control.svg');
      acode.addIcon('vcsp-dash', this.baseUrl + 'assets/dash.svg');
      acode.addIcon('vcsp-branch', this.baseUrl + 'assets/git-branch.svg');
      acode.addIcon('vcsp-remote', this.baseUrl + 'assets/remote.svg');

      editorManager.on('remove-folder', this._clearState.bind(this));
      editorManager.on('add-folder', this.gitStatus.bind(this));
      window.addEventListener('click', this.refresh.bind(this));
      this.registerObserveFileTree();

      git.updateServerUrl(`http://localhost:${settings.serverPort}`);
      appSettings.on(`update:${this.plugin.id}`, (value) => {
        git.updateServerUrl(`http://localhost:${value.serverPort}`);
      });

      sidebarApps.add(
        'vcsp-icon',
        'vcsp-sidebar',
        'Source Control',
        (app) => sourceControl.init(app),
        false,
        sourceControl.fixScroll
      );

      sourceControl.$refreshButton.onclick = this.gitStatus.bind(this);
      sourceControl.$initializeBtn.onclick = this.gitInit.bind(this);
      sourceControl.$cloneBtn.onclick = this.gitClone.bind(this);
      sourceControl.$branchBtn.onclick = this.gitCheckout.bind(this);
      sourceControl.$menuBtn.onclick = this.showGitCommands.bind(this);
      sourceControl.$commitBtn.onclick = async () => await this.gitCommit();
      sourceControl.$openFolderBtn.onclick = this.handleOpenFolder.bind(this);
      sourceControl.$startServerBtn.onclick = () => {
        sourceControl.hide();
        startServer();
      };
      sourceControl.$stagedList.$ul.onclick =
        sourceControl.$unstagedList.$ul.onclick =
        this.handleFileClick.bind(this);
      sourceControl.$stagedList.$title.addEventListener('click', async () => {
        if (!sourceControl.$stagedList.collapsed) {
          await this.gitStatus().catch(this.handleError);
        }
      });
      sourceControl.$unstagedList.$title.addEventListener('click', async () => {
        if (!sourceControl.$unstagedList.collapsed) {
          await this.gitStatus().catch(this.handleError);
        }
      });
      sourceControl.$stagedList.$actions.onclick =
        sourceControl.$unstagedList.$actions.onclick =
        this.handleFleListAction.bind(this);
    } catch (error) {
      console.log('[Version Control] Error initialize plugin', error)
    }
  }

  async showGitCommands() {
    try {
      const tail = () => tag('span', { className: 'icon keyboard_arrow_right' });
      const command = await Select('Git Commands', [
        ['pull', 'Pull'],
        ['push', 'Push'],
        ['clone', 'Clone'],
        ['checkout', 'Checkout to...'],
        ['fetch', 'Fetch'],
        { value: 'commit', text: 'Commit', tailElement: tail() },
        { value: 'changes', text: 'Changes', tailElement: tail() },
        { value: 'pullPush', text: 'Pull, Push', tailElement: tail() },
        { value: 'branch', text: 'Branch', tailElement: tail() },
        { value: 'remote', text: 'Remote', tailElement: tail() },
        { value: 'config', text: 'Config', tailElement: tail() }
      ]);

      const commands = {
        pull: () => this.gitPull(),
        push: () => this.gitPush(),
        clone: () => this.gitClone(),
        checkout: () => this.gitCheckout(),
        fetch: () => this.gitFetch(),
        commit: () => this.showCommitMenu(),
        changes: () => this.showChangesMenu(),
        pullPush: () => this.showPullPushMenu(),
        branch: () => this.showBranchMenu(),
        remote: () => this.showRemoteMenu(),
        config: () => this.showGitConfigMenu()
      }

      const handler = commands[command];
      if (handler) {
        await handler();
      }
    } catch (e) {
      this.handleError(e);
    }
  }

  async showCommitMenu() {
    const option = await Select('Commit', [
      ['commit', 'Commit'],
      ['undoLastCommit', 'Undo Last Commit', null, false],
      ['commitAmend', 'Commit (Amend)']
    ]);
    const handlers = {
      commit: () => this.gitCommit(),
      commitAmend: () => this.gitCommit(true)
    };
    const handler = handlers[option];
    if (handler) {
      await handler();
    }
  }

  async showChangesMenu() {
    const option = await Select('Changes', [
      ['stageAll', 'Stage All Changes'],
      ['unstageAll', 'Unstage All Changes'],
      ['discardAll', 'Discard All Changes'],
    ]);
    const handlers = {
      stageAll: () => this.stageAllChanges(),
      unstageAll: () => this.unstageAllChanges(),
      discardAll: () => this.discardChanges()
    };
    const handler = handlers[option];
    if (handler) {
      await handler();
    }
  }

  async showPullPushMenu() {
    const option = await Select('Pull, Push', [
      ['pull', 'Pull'],
      ['pullFrom', 'Pull from...'],
      ['push', 'Push'],
      ['pushTo', 'Push to...'],
      ['fetch', 'Fetch'],
      ['fetchPrune', 'Fetch (Prune)']
    ]);

    const handlers = {
      pull: () => this.gitPull(),
      pullFrom: () => this.gitPull(true),
      push: () => this.gitPush(),
      pushTo: () => this.gitPush(true),
      fetch: () => this.gitFetch(),
      fetchPrune: () => this.gitFetch({ prune: true })
    };

    const handler = handlers[option];
    if (handler) {
      await handler();
    }
  }

  async showBranchMenu() {
    const option = await Select('Branch', [
      ['merge', 'Merge', 'letters', false, 'M'],
      ['create', 'Create Branch', 'add'],
      ['rename', 'Rename Branch', 'edit'],
      ['delete', 'Delete Branch', 'delete'],
    ]);

    const handlers = {
      create: () => branch.createBranch(),
      rename: () => branch.renameBranch(),
      delete: () => branch.deleteBranch()
    };

    const handler = handlers[option];
    if (handler) {
      try {
        await handler();
        await this.gitStatus();
      } catch (error) {
        this.handleError(error);
      }
    }
  }

  async gitInit() {
    try {
      await git.init({ defaultBranch: settings.defaultBranchName });
      await this.gitStatus();
    } catch (error) {
      this.handleError(error);
    }
  }

  async gitClone() {
    const [loader, handlers] = this.createHandlerForLoader('Cloning...');
    loader?.hide();
    try {
      let data = await MultiPrompt('Clone Configuration', [
        { type: 'url', id: 'url', placeholder: 'URL Repository', required: true },
        { type: 'number', id: 'depth', placeholder: 'Depth (number)' },
        { type: 'checkbox', id: 'singleBranch', placeholder: 'Single Branch' },
        { type: 'checkbox', id: 'noCheckout', placeholder: 'No Checkout' },
        { type: 'checkbox', id: 'noTags', placeholder: 'No Tags' }
      ]);
      if (!data) return;

      let {
        url: repoUrl,
        depth = undefined,
        singleBranch = false,
        noCheckout = false,
        noTags = false
      } = data;

      if (typeof depth === 'string') {
        const trimmed = depth.trim();
        if (/^\d+$/.test(trimmed)) {
          depth = Number(trimmed);
        } else {
          depth = undefined;
        }
      }

      const selectedFolder = await fileBrowser('folder', 'Select Folder', true);
      if (!selectedFolder || selectedFolder.type === 'file') return;

      const { url: targetDir } = selectedFolder;
      const dest = Url.joinSafe(targetDir, repoUrl.match(/\/([^\/]+?)(\.git)?$/)?.[1] || '');
      const repoDir = resolveRepoDir(dest);

      let options = {
        dir: repoDir,
        url: repoUrl,
        singleBranch,
        noCheckout,
        noTags
      }
      if (depth) options.depth = depth;

      loader?.show();

      await git.clone({ ...options, ...handlers });
      window.toast('Done.', 3000);
    } catch (error) {
      this.handleError(error);
    } finally {
      loader.destroy();
    }
  }

  async gitPull(selectRemote = false) {
    const [loader, handlers] = this.createHandlerForLoader('Pulling...');
    try {
      const remotes = await git.listRemotes();
      if (remotes.length === 0) {
        throw new NoRemotesConfigured('pull from');
      }

      const branch = await git.branch();
      let { remote, remoteRef } = await git.branchUpstream(branch);

      if (selectRemote || !remote) {
        if (remotes.length === 1 && !selectRemote) {
          remote = remotes[0].remote;
        } else {
          loader?.hide();
          const selectedRemote = await this.selectRemote('Select a remote to pull', false, remotes);
          if (!selectedRemote) {
            loader.destroy();
            return;
          }
          remote = selectedRemote;
        }
      }
      await this._pull({ remote, remoteRef, ref: branch, ...handlers });
    } catch (error) {
      this.handleError(error);
    } finally {
      loader.destroy();
    }
  }

  async gitPush(selectRemote = false) {
    const [loader, handlers] = this.createHandlerForLoader('Pushing...');
    try {
      let remotes = await git.listRemotes();
      let hasHead = await git.hasHEAD();
      if (remotes.length === 0) throw new NoRemotesConfigured('push to');
      if (!hasHead) {
        acode.pushNotification('Error', 'No branch to push. Make your first commit before pushing.', { type: 'error' });
        loader.destroy();
        return;
      }

      const branch = await git.branch();
      let { remote, remoteRef } = await git.branchUpstream(branch);

      if (selectRemote || !remote) {
        if (remotes.length === 1 && !selectRemote) {
          remote = remotes[0].remote;
        } else {
          loader?.hide();
          remote = await this.selectRemote('Select a remote to push', false, remotes);
          loader?.show();
        }
      }

      const result = await git.push({ remote, remoteRef: remoteRef, ref: branch, ...handlers });
      console.log(result);
      window.toast(`[push to '${remote}/${branch}'] Done`)
    } catch (error) {
      this.handleError(error);
    } finally {
      loader.destroy();
    }
  }

  async gitFetch(options = {}) {
    const [loader, handlers] = this.createHandlerForLoader('Fetching...');
    try {
      const remotes = await git.listRemotes();
      if (remotes.length === 0) {
        throw new NoRemotesConfigured('fetch from');
      }
      let selectedRemote;
      if (remotes.length === 1) {
        selectedRemote = remotes[0].remote;
      } else {
        loader?.hide();
        selectedRemote = await this.selectRemote('Select a remote to fetch', false, remotes);
        if (!selectedRemote) return;
        loader?.show();
      }

      const result = await git.fetch({ remote: selectedRemote, ...options, ...handlers });
      console.log(result);
      window.toast(`[fetch from '${selectedRemote}'] Done`, 3000);
      await this.gitStatus();
    } catch (error) {
      this.handleError(error);
    } finally {
      loader.destroy();
    }
  }

  async _pull(options = {}) {
    try {
      await git.pull(options);
      window.toast('[pull] done.', 3000);
    } catch (error) {
      if (error.code === 'MissingNameError') {
        const author = await this.getAuthor();
        if (!author) return;
        await git.pull({ author, ...options });
      } else {
        throw error;
      }
    }
  }

  async gitStatus() {
    if (this.isLoading) return;
    this.isLoading = true;
    try {
      git.setRepoDir(this.currentDir);
      const isRepo = await git.isRepo();
      if (!isRepo) {
        throw new RepositoryNotFound(this.currentDir);
      }

      if (sourceControl.isActive()) {
        await sourceControl.updateStatus();
      }

      if (acodeFileTree.isActive()) {
        const targetNode = this.currentFolder.$node;
        await acodeFileTree.syncWithGit(targetNode);
        this.processIgnoreFilesForFileTree(targetNode);
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      this.isLoading = false;
    }
  }

  async processIgnoreFilesForFileTree(targetNode) {
    try {
      setTimeout(async () => {
        const visibleFilePaths = acodeFileTree.getVisibleFilePaths(targetNode);
        if (visibleFilePaths.length > 0) {
          const ignoreResults = await gitIgnore.isIgnored(visibleFilePaths);
          await acodeFileTree.syncIgnoreOnly(targetNode, ignoreResults);
        };
        try {
        } catch (error) { }
      }, 100);
    } catch (error) { }
  }

  async gitCommit(amend = false) {
    if (this.isLoading) return;
    this.isLoading = true;

    let message = sourceControl.getCommitMessage();
    sourceControl.$commitBtn.disabled = true;

    try {
      let statusRows = await git.statusMatrix();
      const FILE = 0, HEAD = 1, WORKDIR = 2, STAGE = 3;

      const stagedRows = statusRows.filter(row => row[HEAD] !== row[STAGE]);
      let addAll = false;
      if (!stagedRows.length) {
        const promptMsg = 'There are no staged changes to commit. Would you like to stage all your changes and commit them directly?';
        const confirm = await Confirm('WARNING', promptMsg);
        if (!confirm) return;

        addAll = confirm;
        await git.addAll();
      }

      if (!message) {
        const gitDir = Url.joinSafe(this.currentFolder.url, '.git');
        const branch = await git.branch();
        if (addAll) {
          statusRows = await git.statusMatrix();
        }

        sourceControl.hide();
        const commitTemplate = createCommitTemplate(statusRows, branch);
        message = await openCOMMIT_EDITMSG(gitDir, commitTemplate);
        if (!message) {
          acode.pushNotification('Empy commit message', 'Commit operation was cancelled due to empty commit message.');
          return;
        }
      }

      try {
        await git.commit({ message, amend });
      } catch (error) {
        if (error.code === 'MissingNameError') {
          const author = await this.getAuthor();
          if (!author) return;
          await git.commit({ message, author, amend });
        } else throw error;
      }

      sourceControl.setCommitMessage('');
    } catch (error) {
      this.handleError(error);
    } finally {
      this.isLoading = false;
      sourceControl.$commitBtn.disabled = false;
      await this.gitStatus();
    }
  }

  async gitCheckout() {
    if (this.isLoading) return;
    this.isLoading = true;
    try {
      await branch.checkout();
      await this.gitStatus();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.isLoading = false;
    }
  }

  createHandlerForLoader(message) {
    /** @type {Loader} */
    const loader = Loader.create('Loading', message);
    const handlers = {
      onProgress: (progress) => {
        if (!progress) return;
        let loaded = Number(progress.loaded || 0);
        let total = Number(progress.total || 0);
        let phase = progress.phase;
        let percent = total ? Math.round((loaded / total) * 100) : (progress.percent || 0);
        loader?.setTitle(phase);
        loader?.setMessage(`working (${percent})%`);
      },
      onMessage: (message) => {
        loader?.setMessage(message);
      },
      onAuth: async (url, auth) => {
        loader?.hide();
        const credential = await this.getCredential(url, auth);
        loader?.show();
        return credential;
      }
    }
    return [loader, handlers];
  }

  async addRemote() {
    const { remote, url } = await MultiPrompt('Add Remote', [
      { type: 'text', id: 'remote', placeholder: 'Remote name', required: true },
      { type: 'url', id: 'url', placeholder: 'Repository URL', required: true },
    ]);
    if (!remote || !url) return;
    await git.addRemote(remote, url);
  }

  /**
   * @param {string} title 
   * @param {Array<{remote: string, url: string}>} remotes 
   */
  async selectRemote(
    title = 'Select Remote',
    selectIfOne = false,
    remotes = [],
    extraRemoteOptions = []
  ) {
    const listRemotes = remotes.length > 0
      ? remotes
      : await git.listRemotes();
    if (!listRemotes.length) {
      throw new NoRemotesConfigured();
    }
    if (selectIfOne && listRemotes.length === 1) {
      return listRemotes[0].remote;
    }
    const remoteOptions = listRemotes.map(remote => {
      return [remote.remote, `
        <p><strong>${remote.remote}</strong></p>
        <p><i><small>${remote.url}</small></i></p>
      `, 'vcsp-remote'];
    });
    if (extraRemoteOptions.length > 0) {
      remoteOptions.unshift(...extraRemoteOptions);
    }
    return await Select(title, remoteOptions);
  }

  async showRemoteMenu() {
    try {
      const option = await Select('Remote', [
        ['add', 'Add Remote', 'add'],
        ['remove', 'Remove Remote', 'delete'],
      ]);
      if (option === 'add') {
        await this.addRemote();
      } else if (option === 'remove') {
        const deletedRemote = await this.selectRemote('Remove Remote');
        if (deletedRemote) {
          await git.deleteRemote(deletedRemote);
        }
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  async getCredential(url, auth) {
    let token = settings.githubToken;
    if (!token) {
      token = await Prompt('Token', '', 'text', {
        required: true,
        placeholder: 'Enter your github token'
      });
      if (token) {
        const saveToken = await Confirm(
          'Info',
          'Do you want to save the token for future use?'
        );
        if (saveToken) {
          settings.githubToken = token;
        }
      }
    }
    return { username: token };
  }

  async refresh(e) {
    if (!e.target || !settings.autoRefresh) return;
    const target = e.target;
    const dataId = target.dataset.id;
    const dataAction = target.dataset.action;
    const isSidebarActive = sourceControl.isActive();
    const isFileTreeActive = acodeFileTree.isActive();

    const shouldLoad = (
      e.type === 'touchend' && (isSidebarActive || isFileTreeActive) ||
      (dataAction === 'sidebar-app' && (dataId === 'vcsp-sidebar' || dataId === 'files')) ||
      (target.getAttribute('action') === 'toggle-sidebar' && (isSidebarActive || isFileTreeActive))
    );

    if (shouldLoad) {
      if (!this._fileExpandedObserver) {
        this.registerObserveFileTree();
      }
      sourceControl.fixScroll();
      await this.gitStatus();
    }
  }

  async handleFileClick(e) {
    const $target = e.target;
    if (!($target instanceof HTMLElement)) return;
    const type = $target.dataset.type;
    if (!type || type !== 'file') return;

    const filepath = $target.dataset.filepath;
    const action = $target.dataset.action;
    const isStaged = $target.dataset.staged === 'true';
    const isUnstaged = $target.dataset.unstaged === 'true';

    const actions = [
      ['open-file', 'Open File'],
      ['open-file-head', 'Open File (HEAD)']
    ];

    if (isStaged && action === 'staged') {
      actions.push(['unstage', 'Unstage Changes']);
    }
    if (isUnstaged && action === 'unstaged') {
      actions.push(['stage', 'Stage Changes']);
      actions.push(['discard', 'Discard Changes']);
    }

    const options = actions;
    const option = await Select(filepath, options);

    if (!option) return;

    const filepaths = [filepath];

    try {
      switch (option) {
        case 'stage':
          await git.addAll({ filepaths: filepaths });
          await this.gitStatus();
          break;
        case 'unstage':
          await git.rmCached(filepaths);
          await this.gitStatus();
          break;
        case 'discard':
          await this.discardChanges(filepaths);
          break;
        case 'open-file':
          acode.newEditorFile(Url.basename(filepath), {
            uri: Url.joinSafe(this.currentFolder.url, filepath)
          });
          sourceControl.hide();
          break;
        case 'open-file-head':
          await this.openFileHead(filepath);
          break;
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  async openFileHead(filepath) {
    const content = await git.readFile({ filepath, ref: 'HEAD' });
    const filename = Url.basename(filepath);
    if (!content) {
      acode.pushNotification('', `HEAD version of "${filename}" is not available.`, {
        type: 'warning'
      });
      return;
    }
    const EditorFile = acode.require('editorFile');
    const file = new EditorFile(`${filename} (HEAD)`, { text: content, editable: false });
    file.setMode(getModeForFile(filename));
    file.makeActive();
    sourceControl.hide();
  }

  async handleFleListAction(e) {
    e.stopPropagation();
    const $target = e.target;
    if (!$target) return;

    const action = $target.dataset.action;

    switch (action) {
      case 'stage-all':
        await this.stageAllChanges();
        break;
      case 'unstage-all':
        await this.unstageAllChanges();
        break;
    }
  }

  async stageAllChanges() {
    if (this.isLoading) return;
    this.isLoading = true;
    try {
      const confirm = await Confirm('WARNING', 'Are you sure you want to stage all changes in this repository? This action will add all modified, deleted, and untracked files to the staging area. Continue?');
      if (confirm) {
        Loader.create('Loading', 'Stage all changes');
        await git.addAll();
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      this.isLoading = false;
      Loader.destroy();
      await this.gitStatus();
    }
  }

  async unstageAllChanges() {
    if (this.isLoading) return;
    this.isLoading = true;
    try {
      const confirm = await Confirm('WARNING', 'Are you sure you want to unstage all changes in this repository? This will move all staged changes back to the working directory. Continue?');
      if (confirm) {
        Loader.create('Loading', 'Unstage all changes');
        const matrix = await git.statusMatrix();
        const filepaths = matrix
          .filter(git.isHEAD)
          .map(row => row[0]);
        await git.rmCached(filepaths);
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      this.isLoading = false;
      Loader.destroy();
      await this.gitStatus();
    }
  }

  async discardChanges(filepaths = ['.']) {
    if (this.isLoading) return;
    this.isLoading = true;
    Loader.create('Loading', 'Discard changes');
    try {
      const rows = await git.statusMatrix({ filepaths });

      let untrackedFiles = [];
      let modifiedFiles = [];

      for (const row of rows) {
        const fp = row[0];
        if (git.isUntracked(row)) {
          untrackedFiles.push(fp);
        }
        if (
          git.isModifiedUnstaged(row) ||
          git.isDeletedUnstaged(row)
        ) {
          modifiedFiles.push(fp);
        }
      }

      if (untrackedFiles.length === 0 && modifiedFiles.length === 0) {
        return;
      }

      Loader.hide();
      const confirm = await confirmDiscardChanges(untrackedFiles, modifiedFiles);
      if (!confirm) return;
      Loader.show();

      const untrackedCount = untrackedFiles.length;
      const modifiedCount = modifiedFiles.length;

      const discardModified = async () => {
        const hasHead = await git.hasHEAD();
        if (hasHead) {
          const oids = Object.entries(await git.collectOids(modifiedFiles));
          const headFiles = oids.filter(([, o]) => o.headOid).map(([f]) => f);
          const notHeadFiles = oids.filter(([, o]) => !o.headOid).map(([f]) => f);
          await Promise.all([
            git.checkout({ filepaths: headFiles, force: true }),
            git.discardFiles(notHeadFiles)
          ]);
        } else {
          await git.discardFiles(modifiedFiles);
        }
      }

      if (modifiedCount > 0 && untrackedCount > 0) {
        Loader.hide();
        const action = await Select('', [
          ['discard', `Discard all ${modifiedCount} Tracked Files`],
          ['delete', `Discard all ${untrackedCount} Files`]
        ]);
        Loader.show();
        if (action === 'discard') {
          await discardModified();
        } else if (action === 'delete') {
          await this.deleteUntrackedFiles(untrackedFiles);
        }
      } else if (untrackedCount > 0) {
        await this.deleteUntrackedFiles(untrackedFiles);
      } else if (modifiedCount > 0) {
        await discardModified();
      }

      this.isLoading = false;
      Loader.destroy();
      await this.gitStatus();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.isLoading = false;
      Loader.destroy();
    }
  }

  async showGitConfigMenu() {
    try {
      const options = [
        ['setConfig', 'Set Config'],
        ['openConfigFile', 'Open Config File']
      ];
      const configAction = await Select('Git Config', options, { hideOnSelect: true });
      if (configAction === 'setConfig') {
        const config = await MultiPrompt('Enter path & value',
          [
            { type: 'text', id: 'path', placeholder: 'user.name', required: true },
            { type: 'text', id: 'value', placeholder: 'Enter value', required: true }
          ],
          "config will be an object like { path: 'user.name', value: 'John Doe' }"
        );
        const path = config['path'].toLowerCase();
        const value = config['value'];
        await git.setConfig(path, value);
        return;
      }

      if (configAction === 'openConfigFile') {
        const uri = Url.joinSafe(this.currentFolder.url, '.git/config');
        acode.newEditorFile('Config', { editable: true, uri });
        sourceControl.hide();
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  async getAuthor() {
    try {
      let name = await git.getConfig('user.name');
      let email = await git.getConfig('user.email');

      if (name) return { name, email };

      name = settings.gitConfigUsername;
      email = settings.gitConfigUserEmail;

      if (!name) {
        const opts = [{ type: 'text', id: 'name', placeholder: 'name', required: true }];
        if (!email) {
          opts.push({ type: 'email', id: 'email', placeholder: 'Email', required: false });
        }
        const data = await MultiPrompt('Enter username & email', opts);
        if (!data) return null;
        name = data['name'];
        email = data['email'] || email;

        settings.gitConfigUsername = name;
        settings.gitConfigUserEmail = email;
      }

      return { name, email };
    } catch (error) {
      return null;
    }
  }

  async deleteUntrackedFiles(filepaths) {
    const baseUrl = this.currentFolder.url;
    const uris = filepaths.map(fp => Url.joinSafe(baseUrl, fp));
    await deleteFiles(uris, 50, 3);
  }

  registerObserveFileTree() {
    try {
      const observer = acodeFileTree.observeFileTreeForExpands(async (target) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        if (!await git.isRepo()) return;
        await acodeFileTree.syncWithGit(target);

        // Process ignore files for expanded folder
        if (acodeFileTree.isActive()) {
          this.processIgnoreFilesForFileTree(target);
        }
      });
      observer.observe(this.currentFolder.$node, {
        attributes: true,
        subtree: true,
        attributeFilter: ['class']
      });
      this._fileExpandedObserver = observer;
    } catch (e) { }
  }

  async handleOpenFolder() {
    try {
      const selectedFolder = await fileBrowser('folder', 'Open Folder', true);
      if (!selectedFolder) return;
      const { url, name } = selectedFolder;
      openFolder(url, { name, saveState: true, reloadOnResume: true });
    } catch (e) {
      this.handleError(e);
    }
  }

  get currentDir() {
    const uri = this.currentFolder.url;
    let resolvedDir = resolveRepoDir(uri);
    return resolvedDir;
  }

  get currentFolder() {
    const folders = window.addedFolder;
    if (!folders || folders.length < 1) {
      throw new NoFolderSelected();
    }
    if (folders.length > 1) {
      throw new MultipleFolderSelected(folders.map(f => f.url));
    }
    return folders[0];
  }

  handleError(error) {
    if (!error) return;
    const message = error.message;
    const details = getErrorDetails(error);

    console.groupCollapsed('[VersionControl] Error');
    console.error(error);
    console.log(details);
    console.groupEnd();

    if (error instanceof BaseError) {
      const code = error.code;
      const repoError = sourceControl.$repoError;

      const errorHandlers = {
        'ServerUnreachable': () => {
          sourceControl.showRepoError(message);
          repoError.appendChild(sourceControl.$startServerBtn);
        },
        'MultipleFolderSelected': () => sourceControl.showRepoError(message),
        'NoFolderSelected': () => {
          sourceControl.showRepoError(message);
          repoError.append(sourceControl.$openFolderBtn, sourceControl.$cloneBtn);
        },
        'RepositoryNotFound': () => {
          sourceControl.showRepoError(message);
          repoError.append(sourceControl.$initializeBtn, sourceControl.$cloneBtn);
        },
        'NoRemotesConfigured': () => notify(code, message),
        'RemoteNotFound': () => notify(code, message),
        'default': () => {
          if (sourceControl.isActive()) {
            Alert(code, message);
          }
        }
      };

      const handler = errorHandlers[code] || errorHandlers.default;
      handler();
    }

    function notify(code, message) {
      acode.pushNotification(code, message, { type: 'error' });
    }
  }

  _clearState() {
    sourceControl.clearState();
    acodeFileTree.clear();
    this.isLoading = false;
    if (this._fileExpandedObserver) {
      this._fileExpandedObserver.disconnect();
      this._fileExpandedObserver = null;
    }
  }

  _resetState() {
    this._clearState();
    this.registerObserveFileTree();
  }

  getSettings() { return settings.getSettingObj(); }

  async destroy() {
    this._clearState();
    this.$mainStyle.remove();
    sidebarApps.remove('vcsp-sidebar');

    const pluginId = this.plugin.id;
    appSettings.off(`update:${pluginId}`);
    delete appSettings.value[pluginId];
    appSettings.update(false);
  }
}
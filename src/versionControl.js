// Copyright (c) [2025] [Diki Djatar]
// SPDX-License-Identifier: MIT

import acodeFileTree from './acodeFileTree';
import { confirmDiscardChanges } from './components';
import { DEFAULT_SETTINGS } from './constants';
import BaseError, { MultipleFolderSelected, NoFolderSelected, NoRemotesConfigured, RepositoryNotFound } from './errors';
import git from './git';
import gitIgnore from './gitIgnore';
import sourceControl from './sourceControl';
import './styles/style.scss';
import {
  createCommitTemplate,
  deleteFiles,
  getErrorDetails,
  getModeForFile,
  isValidUrl,
  logError,
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
const appSettings = acode.require('settings');
const Url = acode.require('Url');
const openFolder = acode.require('openFolder');
const sidebarApps = acode.require('sidebarApps');

export default class VersionControl {

  constructor(plugin) {
    if (!appSettings.value[plugin.id]) {
      appSettings.value[plugin.id] = DEFAULT_SETTINGS;
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

      editorManager.on('remove-folder', this._clearState.bind(this));
      editorManager.on('add-folder', this.gitStatus.bind(this));
      window.addEventListener('click', this.refresh.bind(this));
      this.registerObserveFileTree();

      git.updateServerUrl(this.settings.serverUrl);

      sidebarApps.add(
        'vcsp-icon',
        'vcsp-sidebar',
        'Source Control',
        (app) => sourceControl.init(app, {
          onRefreshButtonClick: this.gitStatus.bind(this),
          onInitButtonClick: this.gitInit.bind(this),
          onCloneButtonClick: this.gitClone.bind(this),
          onBranchButtonClick: this.gitCheckout.bind(this),
          onCollapsibleExpand: this.gitStatus.bind(this),
          onFileClick: this.handleFileClick.bind(this),
          onCommitButtonClick: async () => await this.gitCommit(),
          onFileListActionButtonClick: this.handleFleListAction.bind(this),
          onMoreButtonClick: this.showGitCommands.bind(this),
          onOpenFolderButtonClick: this.handleOpenFolder.bind(this),
          onStartServerButtonClick: () => {
            console.log('Start server...');
          }
        })
      );
    } catch (error) {
      console.log('[Version Control] Error initialize plugin', error)
    }
  }

  async showGitCommands() {
    try {
      const command = await Select('Git Commands', [
        ['pull', 'Pull'],
        ['push', 'Push'],
        ['clone', 'Clone'],
        ['checkout', 'Checkout to...'],
        ['fetch', 'Fetch'],
        ['commit', 'Commit', 'keyboard_arrow_right'],
        ['changes', 'Changes', 'keyboard_arrow_right'],
        ['pullPush', 'Pull, Push', 'keyboard_arrow_right'],
        ['branch', 'Branch', 'keyboard_arrow_right'],
        ['remote', 'Remote', 'keyboard_arrow_right'],
        ['config', 'Config', 'keyboard_arrow_right']
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
        remote: () => this.gitRemote(),
        config: () => this.gitConfig()
      }

      const handler = commands[command];
      if (handler) {
        await handler();
      }
    } catch (e) {
      this._handleError(e);
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
      create: () => this.gitCreateBranch(),
      rename: () => this.gitRenameBranch(),
      delete: () => this.gitDeleteBranch()
    };

    const handler = handlers[option];
    if (handler) {
      await handler();
    }
  }

  async gitInit() {
    try {
      const defaultBranch = this.settings.defaultBranchName;
      await git.init({ defaultBranch });
      await this.gitStatus();
    } catch (error) {
      this._handleError(error);
    }
  }

  async gitClone() {
    const [loader, handlers] = this._createHandlerForLoader('Cloning...');
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

      if (!isValidUrl(repoUrl)) {
        Alert('Error', `Invalid URL: ${repoUrl}`);
        return;
      }

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
      const dest = Url.join(targetDir, repoUrl.match(/\/([^\/]+?)(\.git)?$/)?.[1] || '');
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
      this._handleError(error);
    } finally {
      loader.destroy();
    }
  }

  async gitPull(selectRemote = false) {
    const [loader, handlers] = this._createHandlerForLoader('Pulling...');
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
      this._handleError(error);
    } finally {
      loader.destroy();
    }
  }

  async gitPush(selectRemote = false) {
    const [loader, handlers] = this._createHandlerForLoader('Pushing...');
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
      this._handleError(error);
    } finally {
      loader.destroy();
    }
  }

  async gitFetch(options = {}) {
    const [loader, handlers] = this._createHandlerForLoader('Fetching...');
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
      this._handleError(error);
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
        this.processIgnoreFilesForFileTree(targetNode).catch(this._handleError);
      }
    } catch (error) {
      this._handleError(error);
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
        const gitDir = Url.join(this.currentFolder.url, '.git');
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
      this._handleError(error);
    } finally {
      this.isLoading = false;
      sourceControl.$commitBtn.disabled = false;
      await this.gitStatus();
    }
  }

  _createHandlerForLoader(message) {
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

  async gitCheckout() {
    const [loader, handlers] = this._createHandlerForLoader('Checkout...');
    try {
      const branches = await git.listBranches();
      const options = branches.map(b => [b, b, 'vcsp-branch']);
      options.unshift(['create new branch', 'Create new branch', 'add']);

      loader?.hide();
      const selectedBranch = await Select('Select a branch to checkout', options);
      if (selectedBranch === 'create new branch') {
        await this.gitCreateBranch(true);
      } else if (selectedBranch) {
        loader?.show();
        await git.checkout({ ref: selectedBranch, ...handlers });
        window.toast(`Checked out to ${selectedBranch}`, 3000);
        await this.gitStatus();
      }
    } catch (error) {
      if (error.code === 'CheckoutConflictError') {
        const data = error.data.data;
        const files = data.filepaths;
        let message = `
          <p>Your local changes to the following files would be overwritten by checkout:</p>
          <div style="margin-left: 20px;">
            ${files.map(file => `<p><strong>${file}</strong></p>`).join('')}
          </div>
          <p>Please commit your changes or stash them before you switch branches.</p>
        `;
        Alert(error.code, message);
        return;
      }
      this._handleError(error);
    } finally {
      loader.destroy();
    }
  }

  async gitCreateBranch(checkout = false) {
    const branch = await Prompt('Branch name', '', 'text', {
      required: true,
      placeholder: 'Please provide a new branch name'
    });
    if (!branch) return;
    await git.createBranch(branch);
    if (checkout) {
      await git.checkout({ ref: branch });
      window.toast(`Checked out to ${branch}`, 3000);
    }
    await this.gitStatus();
  }

  async gitDeleteBranch() {
    const branches = await git.listBranches();
    const currentBranch = await git.branch();
    const options = branches
      .filter(b => b !== currentBranch)
      .map(b => [b, b, 'delete']);
    options.unshift([currentBranch, currentBranch, 'delete', false]);
    const selectedBranch = await Select('Select a branch to delete', options);
    if (selectedBranch) {
      const confirm = await Confirm('WARNING', `Are you sure you want to delete branch '${selectedBranch}'`);
      if (confirm) {
        await git.deleteBranch(selectedBranch);
        window.toast('Done', 3000);
        await this.gitDeleteBranch();
      }
    }
  }

  async gitRenameBranch() {
    const currentBranch = await git.branch();
    const newBranch = await Prompt(
      'Branch name',
      currentBranch ? currentBranch : this.settings.defaultBranchName,
      'text',
      {
        required: true,
        placeholder: 'Please provide a new branch name'
      }
    );
    if (currentBranch && newBranch) {
      await git.renameBranch(currentBranch, newBranch);
      await this.gitStatus();
    }
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
      `];
    });
    if (extraRemoteOptions.length > 0) {
      remoteOptions.unshift(...extraRemoteOptions);
    }
    return await Select(title, remoteOptions);
  }

  async gitRemote() {
    try {
      const option = await Select('Remote', [
        ['add', 'Add Remote'],
        ['remove', 'Remove Remote'],
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
      this._handleError(error);
    }
  }

  async getCredential(url, auth) {
    let token = this.settings.githubToken;
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
          this.updateSetting('githubToken', token);
        }
      }
    }
    return { username: token };
  }

  /**
   * 
   * @param {Event} e 
   */
  async refresh(e) {
    if (!e.target || !this.settings.autoRefresh) return;
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
      await this.gitStatus();
    }
  }

  /**
   * Handle when file click
   * @param {FileStatus} file 
   * @param {'staged' | 'unstaged'} from 
   */
  async handleFileClick(file, from) {
    const actions = [
      ['open-file', 'Open File'],
      ['open-file-head', 'Open File (HEAD)']
    ];

    if (file.isStaged && from === 'staged') {
      actions.push(['unstage', 'Unstage Changes']);
    }
    if (file.isUnstaged && from === 'unstaged') {
      actions.push(['stage', 'Stage Changes']);
      actions.push(['discard', 'Discard Changes']);
    }

    const options = actions;
    const action = await Select(file.filepath, options);

    if (!action) return;

    const filepath = file.filepath;
    const filepaths = [filepath];

    try {
      switch (action) {
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
            uri: Url.join(this.currentFolder.url, filepath)
          });
          sourceControl.hide();
          break;
        case 'open-file-head':
          await this.openFileHead(filepath);
          break;
      }
    } catch (error) {
      this._handleError(error);
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

  /**
   * @param {'stage-all' | 'unstage-all'} action 
   */
  async handleFleListAction(action) {
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
      this._handleError(error);
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
      this._handleError(error);
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
      this._handleError(error);
    } finally {
      this.isLoading = false;
      Loader.destroy();
    }
  }

  async gitConfig() {
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
        const uri = Url.join(this.currentFolder.url, '.git/config');
        acode.newEditorFile('Config', { editable: true, uri });
        sourceControl.hide();
      }
    } catch (error) {
      this._handleError(error);
    }
  }

  async getAuthor() {
    try {
      let name = await git.getConfig('user.name');
      let email = await git.getConfig('user.email');

      if (name) return { name, email };

      name = this.settings.gitConfigUsername;
      email = this.settings.gitConfigUserEmail;

      if (!name) {
        const opts = [{ type: 'text', id: 'name', placeholder: 'name', required: true }];
        if (!email) {
          opts.push({ type: 'email', id: 'email', placeholder: 'Email', required: false });
        }
        const data = await MultiPrompt('Enter username & email', opts);
        if (!data) return null;
        name = data['name'];
        email = data['email'] || email;
        this.saveAuthor(name, email);
      }

      return { name, email };
    } catch (error) {
      return null;
    }
  }

  saveAuthor(name, email) {
    if (name) this.updateSetting('gitConfigUsername', name);
    if (email) this.updateSetting('gitConfigUserEmail', email);
  }

  async deleteUntrackedFiles(filepaths) {
    const baseUrl = this.currentFolder.url;
    const uris = filepaths.map(fp => Url.join(baseUrl, fp));
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
          this.processIgnoreFilesForFileTree(target).catch(this._handleError);
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
      this._handleError(e);
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

  _handleError(error) {
    const message = error.message;
    const details = getErrorDetails(error);

    logError(error, details);

    if (error instanceof BaseError) {
      const code = error.code;
      const repoError = sourceControl.$repoError;

      const errorHandlers = {
        'ServerUnreachable': () => {
          sourceControl.showRepoError(message),
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

  get settings() {
    return appSettings.value[this.plugin.id];
  }

  updateSetting(key, value) {
    this.settings[key] = value;
    appSettings.update();
  }

  getSettings() {
    return {
      list: [
        {
          key: 'serverUrl',
          text: 'Git: Server URL',
          info: 'URL of the Git server used by this plugin.',
          value: this.settings.serverUrl,
          prompt: 'Enter server URL',
          promptType: 'text',
          promptOptions: [{ required: true }]
        },
        {
          key: 'autoRefresh',
          text: 'Git: Autorefresh',
          checkbox: this.settings.autoRefresh
        },
        {
          key: 'githubToken',
          text: 'Git: Github Token',
          info: 'Github token for authentication',
          value: this.settings.githubToken,
          prompt: 'Github Token',
          promptType: 'text',
          promptOption: [{ require: true }]
        },
        {
          key: 'defaultBranchName',
          text: 'Git: Default Branch Name',
          info: 'The name of the default branch when initializing a new Git repository. When set to empty, the default branc name configurd in Git will be used.',
          value: this.settings.defaultBranchName,
          prompt: 'Default Branch Name',
          promptType: 'text'
        },
        {
          key: 'gitConfigUsername',
          text: 'Git:Config:User: name',
          info: 'Sets the git config user.name',
          value: this.settings.gitConfigUsername,
          prompt: 'Enter username',
          promptType: 'text',
          promptOption: [{ require: true }]
        },
        {
          key: 'gitConfigUserEmail',
          text: 'Git:Config:User: email',
          info: 'Sets the git config user.email',
          value: this.settings.gitConfigUserEmail,
          prompt: 'Enter email',
          promptType: 'email'
        }
      ],
      cb: async (key, value) => {
        if (key === 'serverUrl') {
          git.updateServerUrl(value);
        }
        this.updateSetting(key, value);
      }
    }
  }

  async destroy() {
    this._clearState();
    this.$mainStyle.remove();
    sidebarApps.remove('vcsp-sidebar');

    if (this.plugin) {
      const pluginId = this.plugin.id;
      appSettings.off(`update:${pluginId}`);
      delete appSettings.value[pluginId];
      appSettings.update(false);
    }
  }
}
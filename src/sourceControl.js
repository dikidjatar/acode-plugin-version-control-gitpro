import git from "./git";

const Url = acode.require('Url');
const helpers = acode.require('helpers');

/** @type {Map<string, FileList>} */
const collapsibles = new Map();

/** @type {HTMLDivElement} */
let $header;

/** @type {HTMLElement} */
let $repoError;

/** @type {HTMLParagraphElement} */
let $errorMessage;

/** @type {HTMLDivElement} */
let $sourceControl;

/** @type {HTMLDivElement} */
let $repositoryBar;

/** @type {HTMLDivElement} */
let $commitMessageArea;

/** @type {HTMLDivElement} */
let $listFiles;

/** @type {HTMLButtonElement} */
let $initializeBtn;

/** @type {HTMLButtonElement} */
let $cloneBtn;

/** @type {HTMLButtonElement} */
let $openFolderBtn;

/** @type {HTMLButtonElement} */
let $startServerBtn;

/** @type {HTMLTextAreaElement} */
let $commitMsg;

/** @type {HTMLButtonElement} */
let $commitBtn;

let _onFileListActionButtonClick = null;
let _onFileClick = null;
let _onCollapsibleExpand = null;

/**
 * @param {HTMLElement} app 
 * @param {SidebarInitOptions} param0 
 */
function init(app, {
  onRefreshButtonClick,
  onInitButtonClick,
  onCloneButtonClick,
  onBranchButtonClick,
  onCollapsibleExpand,
  onFileClick,
  onCommitButtonClick,
  onFileListActionButtonClick,
  onMoreButtonClick,
  onOpenFolderButtonClick,
  onStartServerButtonClick
}) {
  app.classList.add('vcsp');

  _onFileListActionButtonClick = onFileListActionButtonClick;
  _onFileClick = onFileClick;
  _onCollapsibleExpand = onCollapsibleExpand;

  $header = tag('div', { className: 'vcsp-header' });
  $repoError = tag('section', { className: 'repo-error' });
  $errorMessage = tag('p', { innerText: 'Error' });
  $sourceControl = tag('div', { className: 'container source-control' });
  $repositoryBar = tag('div', { className: 'vcsp-repo-bar' });
  $commitMessageArea = tag('div', { className: 'commit-area' });
  $listFiles = tag('div', { className: 'container list-files' });

  $initializeBtn = tag('button', {
    innerText: 'Initialize Repository',
    onclick: onInitButtonClick
  });
  $cloneBtn = tag('button', {
    innerText: 'Clone Repository',
    onclick: onCloneButtonClick
  });
  $openFolderBtn = tag('button', {
    innerText: 'Open Folder',
    onclick: onOpenFolderButtonClick
  });
  $startServerBtn = tag('button', {
    innerText: 'Start Server',
    onclick: onStartServerButtonClick
  });

  setupHeader();
  setupRepositoryBar();
  setupCommitMsg();

  app.append($header, $sourceControl);

  function setupHeader() {
    const title = tag('div', { className: 'title', innerText: 'Version Control' });
    const actions = tag('div', { className: 'actions' });

    const $refreshButton = tag('span', {
      className: 'icon replay',
      onclick: onRefreshButtonClick,
      style: { padding: '5px' }
    });

    actions.appendChild($refreshButton);
    $header.append(title, actions);
  }

  function setupRepositoryBar() {
    const branchButton = tag('div', {
      className: 'action-button branch-button',
      innerHTML: `<div><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg></div>
        <span class="branch-name"></span>
        <span class="branch-symbol"></span>
      `,
      onclick: onBranchButtonClick
    });

    const menuButton = tag('span', {
      className: 'icon more_vert',
      onclick: onMoreButtonClick,
      style: {
        padding: '5px',
        backgroundSize: '28px'
      }
    });

    const actions = tag('div', { className: 'actions', children: [menuButton] });
    $repositoryBar.append(branchButton, actions);
  }

  function setupCommitMsg() {
    $commitMsg = tag('textarea', {
      id: 'commit-message',
      placeholder: 'Commit message',
      rows: 1,
      style: {
        width: '100%',
        border: 'none',
        borderRadius: '2px',
        outline: '1px solid var(--button-background-color)'
      },
      oninput: () => {
        $commitMsg.style.height = 'auto';
        $commitMsg.style.height = $commitMsg.scrollHeight + 'px';
      },
    });
    $commitBtn = tag('button', {
      className: 'commit-btn',
      innerHTML: `<div class="icon-check"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.4315 3.3232L5.96151 13.3232L5.1708 13.2874L1.8208 8.5174L2.63915 7.94268L5.61697 12.1827L13.6684 2.67688L14.4315 3.3232Z" fill="rgba(223, 223, 223, 1)"/></svg></div><span>Commit</span>`,
      onclick: () => onCommitButtonClick($commitMsg?.value)
    });
    $commitMessageArea.append($commitMsg, $commitBtn);
  }
}

function setCommitMessage(message) {
  if ($commitMsg) {
    $commitMsg.value = message ? message : '';
  }
}

function getCommitMessage() {
  return $commitMsg?.value;
}

/**
  * @param {FileStatus[]} stagedFiles 
  * @param {FileStatus[]} unstagedFiles 
  */
function renderFileStatus(stagedFiles, unstagedFiles) {
  if (!$listFiles) return;
  $listFiles.innerHTML = '';

  const stagedKey = 'staged-changes';
  const unstagedKey = 'unstaged-changes';

  const $stagedList = createFileList(stagedKey, 'Staged Changes');
  const $unstagedList = createFileList(unstagedKey, 'Changes');

  $stagedList.addActions([
    {
      className: 'icon vcsp-dash',
      onclick: () => _onFileListActionButtonClick('unstage-all')
    },
    {
      className: 'file-status-length',
      innerHTML: `<span>${stagedFiles.length}</span>`
    }
  ]);
  $unstagedList.addActions([
    {
      className: 'icon add',
      onclick: () => _onFileListActionButtonClick('stage-all')
    },
    {
      className: 'file-status-length',
      innerHTML: `<span>${unstagedFiles.length}</span>`
    }
  ]);

  $listFiles.append($stagedList.$wrapper, $unstagedList.$wrapper);

  $stagedList.setItems(stagedFiles, (f) => {
    return createListItem(f, {
      strikeOnDelete: false,
      onclick: (file) => _onFileClick(file, 'staged')
    });
  });

  $unstagedList.setItems(unstagedFiles, (f) => {
    return createListItem(f, {
      strikeOnDelete: true,
      onclick: (file) => _onFileClick(file, 'unstaged')
    });
  });
}

/**
  * 
  * @param {string} key 
  * @param {string} title 
  * @returns {FileList}
  */
function createFileList(key, title) {
  if (collapsibles.has(key)) {
    return collapsibles.get(key);
  }
  const wrapper = new FileList(title, {
    className: key,
    onExpand: _onCollapsibleExpand
  });

  collapsibles.set(key, wrapper);
  return wrapper;
}

/**
  * 
  * @param {FileStatus} file
  * @param {Object} param1 
  * @param {boolean} [param1.strikeOnDelete=false] 
  * @param {(file: any) => void} [param1.onclick=(file) => { }] 
  * @returns {HTMLLIElement}
  */
function createListItem(file, { strikeOnDelete = false, onclick = (file) => { } }) {
  const $item = tag('li', {
    className: 'tile',
    onclick: () => onclick(file),
    dataset: {
      url: file.filepath
    }
  });

  const $icon = tag('span', {
    className: helpers.getIconForFile(Url.basename(file.filepath))
  });
  const $status = tag('span', {
    className: `git-status-sym git-status-${file.symbol}`,
    innerText: file.symbol
  });
  const $label = tag('span', {
    className: 'text',
    innerText: Url.basename(file.filepath),
    style: strikeOnDelete && file.isUnstaged && file.symbol === 'D' ? {
      textDecoration: 'line-through'
    } : undefined
  });

  $item.append($icon, $label, $status);
  return $item;
}

function updateBranch(branch) {
  const branchNameEl = $repositoryBar.querySelector('.branch-name');
  if (branchNameEl) {
    branchNameEl.innerHTML = branch;
  }
}

function setListLoading(key, isLoading) {
  const wrapper = collapsibles.get(key);
  if (wrapper && !wrapper.collapsed) {
    wrapper.setLoading(!!isLoading);
  }
}

function updateBranchSymbol(symbol) {
  const branchSymbolEl = $repositoryBar.querySelector('.branch-symbol');
  if (branchSymbolEl) {
    branchSymbolEl.innerHTML = symbol;
  }
}

async function updateStatus() {
  showSourceControl();
  setListLoading('staged-changes', true);
  setListLoading('unstaged-changes', true);

  try {
    const branch = await git.branch();
    updateBranch(branch);
    const { staged, unstaged, branchSymbol, totalCount } = await git.status({ split: true });
    updateBranchSymbol(branchSymbol);
    renderFileStatus(staged, unstaged);
    $commitBtn.disabled = totalCount === 0;
  } catch (error) {
    throw error;
  } finally {
    setListLoading('staged-changes', false);
    setListLoading('unstaged-changes', false);
  }
}

function clearRepoError() { $repoError.innerHTML = ''; }
function clearSourceControl() { $sourceControl.innerHTML = ''; }

function showSourceControl() {
  clearRepoError();
  clearSourceControl();
  $sourceControl.append(
    $repositoryBar,
    $commitMessageArea,
    $listFiles
  );
}

function showRepoError(message) {
  clearRepoError();
  clearSourceControl();
  $errorMessage.textContent = message || 'Error';
  $repoError.appendChild($errorMessage);
  $sourceControl.appendChild($repoError);
}

function isActive() {
  const vcspIcon = document.querySelector('[data-id="vcsp-sidebar"]');
  return vcspIcon ? vcspIcon.classList.contains('active') : false;
}

function hide() {
  if (!isActive()) return;
  const mask = document.querySelector('span.mask');
  if (mask) {
    mask.click();
  }
}

function clearState() {
  if ($listFiles) $listFiles.innerHTML = '';
  for (const [, wrapper] of collapsibles) {
    wrapper.clear();
    if (wrapper.parentElement) wrapper.remove();
  }
  collapsibles.clear();
}

export default {
  init,
  setCommitMessage,
  getCommitMessage,
  updateStatus,
  updateBranch,
  updateBranchSymbol,
  setListLoading,
  showSourceControl,
  showRepoError,
  isActive,
  hide,
  clearState,
  get $repoError() { return $repoError; },
  get $commitBtn() { return $commitBtn; },
  get $cloneBtn() { return $cloneBtn; },
  get $initializeBtn() { return $initializeBtn; },
  get $openFolderBtn() { return $openFolderBtn; },
  get $startServerBtn() { return $startServerBtn; }
}

class FileList {

  /**
   * @param {string} title 
   * @param {Object} options
   * @param {string} [options.className]
   * @param {boolean} [options.initiallyOpen=true]
   * @param {(oldData: FileStatus, newData: FileStatus) => boolean} [options.shouldUpdateItem]
   * @param {(item: FileStatus, index: number) => string} [options.keyFn]
   * @param {() => void} [options.onExpand]
   */
  constructor(title, options = {}) {
    const {
      className = '',
      initialOpen = true,
      shouldUpdateItem = defaultShouldUpdateItem,
      keyFn = (it) => it && it.filepath,
      onExpand = null
    } = options;

    this.$wrapper = tag('div', { className: `list collapsible ${className}` });
    this.$ul = tag('ul', {
      className: 'scroll',
      onscroll: () => {
        this.onscroll();
      }
    });
    this.$actions = tag('div', {
      className: 'actions',
      style: { paddingLeft: '8px', paddingRight: '8px' },
    });
    this.$tile = tag('div', {
      className: 'tile light',
      dataset: { 'type': 'root' },
      onclick: () => {
        this.toggle();
      }
    });
    const indicator = tag('span', { className: 'icon indicator' });
    const label = tag('span', {
      className: 'text',
      innerText: title,
      style: {
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis'
      }
    });
    this.$tile.append(indicator, label, this.$actions);

    this._actionButtons = new Map();
    this._itemMap = new Map();
    this._order = [];
    this._onExpanded = onExpand;

    this._shouldUpdateItem = shouldUpdateItem;
    this._keyFn = keyFn;
    if (!initialOpen) {
      this.$wrapper.classList.add('hidden');
    }

    this.$wrapper.append(this.$tile, this.$ul);
  }

  get collapsed() {
    return this.$wrapper.classList.contains('hidden');
  }

  onscroll() {
    this.$ul.dataset.scrollTop = this.$ul.scrollTop;
  }

  get scrollTop() { return this.$ul.dataset.scrollTop || 0 }
  set scrollTop(val) {
    this.$ul.dataset.scrollTop = val;
    this.$ul.scrollTop = val;
  }

  collapse() {
    this.$wrapper.classList.add('hidden');
    delete this.$ul.dataset.scrollTop;
  }

  expand() {
    this.$wrapper.classList.remove('hidden');
    if (typeof this._onExpanded === 'function') {
      this._onExpanded();
    }
  }

  toggle() {
    if (this.collapsed) {
      this.expand();
    } else {
      this.collapse();
    }
  }

  addActions(actions = []) {
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      this.addAction(action);
    }
  }

  addAction({ className = '', onclick = () => { }, ...options }) {
    const key = className || '';
    if (this._actionButtons.has(key)) {
      const ex = this._actionButtons.get(key);
      ex.remove();
      this._actionButtons.delete(key);
    }
    const btn = tag('span', {
      className: `action-button ${className}`,
      onclick: (e) => {
        e.stopPropagation();
        if (typeof onclick === 'function') {
          onclick();
        }
      },
      style: {
        pointerEvents: 'all',
        paddingLeft: '8px',
        paddingRight: '8px'
      },
      ...options
    });
    this.$actions.appendChild(btn);
    this._actionButtons.set(className, btn);
    return btn;
  }

  setLoading(loading) {
    this.$tile.classList[loading ? 'add' : 'remove']('loading');
  }

  /**
   * 
   * @param {FileStatus[]} items 
   * @param {(item: FileStatus, index: number) => HTMLElement} createItemFn 
   * @param {(item: FileStatus) => string | null} keyFnOverride 
   */
  setItems(items = [], createItemFn, keyFnOverride = null) {
    const keyFn = keyFnOverride || this._keyFn;
    const newKeys = []
    const newMap = new Map();

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const k = keyFn(it);
      if (!k) continue;
      newKeys.push(k);
      newMap.set(k, it);
    }

    for (const existingKey of Array.from(this._itemMap.keys())) {
      if (!newMap.has(existingKey)) {
        const { el } = this._itemMap.get(existingKey);
        if (el && el.parentElement) el.remove();
        this._itemMap.delete(existingKey);
        const idx = this._order.indexOf(existingKey);
        if (idx !== -1) this._order.splice(idx, 1);
      }
    }

    let insertBeforeEl = this.$ul.firstChild;
    const frag = document.createDocumentFragment();

    for (let i = 0; i < newKeys.length; i++) {
      const key = newKeys[i];
      const item = newMap.get(key);
      const existing = this._itemMap.get(key);

      if (existing) {
        const oldData = existing.data;
        if (this._shouldUpdateItem(oldData, item)) {
          this.updateListItem(existing.el, item);
          existing.data = item;
        }

        if (insertBeforeEl !== existing.el) {
          this.$ul.insertBefore(existing.el, insertBeforeEl);
          insertBeforeEl = existing.el.nextSibling;
        } else {
          insertBeforeEl = existing.el.nextSibling;
        }
      } else {
        const newEl = createItemFn(item, i);
        if (!newEl.dataset || !newEl.dataset.url) newEl.dataset.url = key;
        this._itemMap.set(key, { el: newEl, data: item });
        this._order.push(key);
        frag.appendChild(newEl);
      }
    }

    if (frag.childNodes.length > 0) {
      this.$ul.insertBefore(frag, insertBeforeEl);
    }

    const newOrder = [];
    for (let child = this.$ul.firstElementChild; child; child = child.nextElementSibling) {
      const k = (child.dataset && (child.dataset.url || child.dataset.key));
      if (k) newOrder.push(k);
    }
    this._order.length = 0;
    Array.prototype.push.apply(this._order, newOrder);
  }

  updateListItem($li, data) {
    if (!$li) return;
    const $text = $li.querySelector('.text');
    if ($text) {
      const newLabel = data.filepath ? Url.basename(data.filepath) : '';
      if ($text.innerText !== newLabel) {
        $text.innerText = newLabel;
      }
    }

    const $status = $li.querySelector('.git-status-sym');
    if (data && !data.isIgnored && data.symbol) {
      if ($status) {
        const sym = data.symbol;
        $status.textContent = sym;
        $status.className = `git-status-sym git-status-${sym}`;
      }
    } else {
      if ($status) $status.remove();
    }
  }

  clear() {
    this.$ul.innerHTML = '';
    for (const btn of this._actionButtons.values()) btn.remove();
    this._actionButtons.clear();
    this._itemMap.clear();
    this._order.length = 0;
  }
}

function defaultShouldUpdateItem(oldData = {}, newData = {}) {
  if (!oldData || !newData) return true;
  if (oldData.symbol !== newData.symbol) return true;
  if (!!oldData.isIgnored !== !!newData.isIgnored) return true;
  if ((oldData.filepath || '') !== (newData.filepath || '')) return true;
  return false;
}
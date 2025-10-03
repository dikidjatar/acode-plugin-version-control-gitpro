import git from "./git";

const Url = acode.require('Url');
const helpers = acode.require('helpers');

/** @type {HTMLElement} */
let $container;

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

/** @type {FileList} */
let $stagedList;

/** @type {FileList} */
let $unstagedList;

/** @type {HTMLButtonElement} */
let $refreshButton;

/** @type {HTMLDivElement} */
let $branchBtn;

/** @type {HTMLSpanElement} */
let $menuBtn;

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

function init(app) {
  $container = app;
  $container.classList.add('vcsp');

  $header = tag('div', { className: 'vcsp-header' });
  $repoError = tag('section', { className: 'repo-error' });
  $errorMessage = tag('p', { innerText: 'Error' });
  $sourceControl = tag('div', { className: 'container source-control' });
  $repositoryBar = tag('div', { className: 'vcsp-repo-bar' });
  $commitMessageArea = tag('div', { className: 'commit-area' });
  $listFiles = tag('div', { className: 'container list' });

  $stagedList = new FileList('Staged Changes', { key: 'staged' });
  $unstagedList = new FileList('Changes', { key: 'unstaged', strikeOnDelete: true });

  $stagedList.addAction({ action: 'unstage-all', className: 'icon vcsp-dash' });
  $stagedList.addAction({ className: 'file-status-length' });
  $unstagedList.addAction({ action: 'stage-all', className: 'icon add' });
  $unstagedList.addAction({ className: 'file-status-length' });

  const $scroll = tag('ul', {
    className: 'scroll',
    style: { maxHeight: '100%', height: '100%', },
    onscroll: () => {
      $scroll.dataset.scrollTop = $scroll.scrollTop;
    }
  });
  $scroll.append($stagedList.$wrapper, $unstagedList.$wrapper);
  $listFiles.appendChild($scroll);

  $initializeBtn = tag('button', { innerText: 'Initialize Repository' });
  $cloneBtn = tag('button', { innerText: 'Clone Repository' });
  $openFolderBtn = tag('button', { innerText: 'Open Folder' });
  $startServerBtn = tag('button', { innerText: 'Start Server' });

  setupHeader();
  setupRepositoryBar();
  setupCommitMsg();

  $sourceControl.append(
    $repositoryBar,
    $commitMessageArea,
    $listFiles
  );
  $container.append($header, $repoError, $sourceControl);

  function setupHeader() {
    const title = tag('div', { className: 'title', innerText: 'Version Control' });
    const actions = tag('div', { className: 'actions' });

    $refreshButton = tag('span', {
      className: 'icon replay',
      style: { padding: '5px' }
    });

    actions.appendChild($refreshButton);
    $header.append(title, actions);
  }

  function setupRepositoryBar() {
    $branchBtn = tag('div', {
      className: 'action-button branch-button',
      innerHTML: `<div><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg></div>
        <span class="branch-name"></span>
        <span class="branch-symbol"></span>
      `,
    });

    $menuBtn = tag('span', {
      className: 'icon more_vert',
      style: { padding: '5px', backgroundSize: '28px' }
    });

    const actions = tag('div', { className: 'actions', children: [$menuBtn] });
    $repositoryBar.append($branchBtn, actions);
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
    });
    $commitMessageArea.append($commitMsg, $commitBtn);
  }
}

function fixScroll(el) {
  const $scrollableLists = $container.getAll(":scope .scroll[data-scroll-top]");
  $scrollableLists.forEach(($el) => {
    $el.scrollTop = $el.dataset.scrollTop;
  });
}

function setCommitMessage(message) {
  if ($commitMsg) {
    $commitMsg.value = message ? message : '';
  }
}

function getCommitMessage() {
  return $commitMsg?.value;
}

function updateBranch(branch) {
  const branchNameEl = $repositoryBar.querySelector('.branch-name');
  if (branchNameEl) {
    branchNameEl.innerHTML = branch;
  }
}

function updateBranchSymbol(symbol) {
  const branchSymbolEl = $repositoryBar.querySelector('.branch-symbol');
  if (branchSymbolEl) {
    branchSymbolEl.innerHTML = symbol;
  }
}

async function updateStatus() {
  $repoError.innerHTML = '';
  $repoError.classList.add('hidden');
  $sourceControl.classList.remove('hidden');

  $stagedList.setLoading(!$stagedList.collapsed);
  $unstagedList.setLoading(!$unstagedList.collapsed);

  try {
    const branch = await git.branch();
    updateBranch(branch);
    const { staged, unstaged, branchSymbol, totalCount } = await git.status({ split: true });
    updateBranchSymbol(branchSymbol);

    $stagedList.setItems(staged);
    $unstagedList.setItems(unstaged);

    const $stagedLength = $stagedList.$actions.querySelector('.file-status-length');
    const $unstagedLength = $unstagedList.$actions.querySelector('.file-status-length');

    if ($stagedLength) $stagedLength.innerHTML = staged.length;
    if ($unstagedLength) $unstagedLength.innerHTML = unstaged.length;

    $commitBtn.disabled = totalCount === 0;
  } catch (error) {
    throw error;
  } finally {
    $stagedList.setLoading(false);
    $unstagedList.setLoading(false);
  }
}

function showRepoError(message) {
  $sourceControl.classList.add('hidden');
  $repoError.classList.remove('hidden');
  $repoError.innerHTML = '';
  $errorMessage.textContent = message || 'Error';
  $repoError.appendChild($errorMessage);
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
  $stagedList.clear();
  $unstagedList.clear();
}

export default {
  init,
  setCommitMessage,
  getCommitMessage,
  updateStatus,
  updateBranch,
  updateBranchSymbol,
  showRepoError,
  isActive,
  hide,
  clearState,
  fixScroll,
  get $listFiles() { return $listFiles; },
  get $stagedList() { return $stagedList; },
  get $unstagedList() { return $unstagedList; },
  get $repoError() { return $repoError; },
  get $commitBtn() { return $commitBtn; },
  get $branchBtn() { return $branchBtn; },
  get $menuBtn() { return $menuBtn; },
  get $refreshButton() { return $refreshButton; },
  get $cloneBtn() { return $cloneBtn; },
  get $initializeBtn() { return $initializeBtn; },
  get $openFolderBtn() { return $openFolderBtn; },
  get $startServerBtn() { return $startServerBtn; }
}

class FileList {

  constructor(title, { key = '', strikeOnDelete = false } = {}) {
    this.key = key;
    this.strikeOnDelete = strikeOnDelete;
    this.actionButtons = new Map();
    this.itemMap = new Map();
    this.order = [];

    this.$wrapper = tag('div', { className: `list collapsible` });
    this.$ul = tag('ul');
    this.$actions = tag('div', {
      className: 'actions',
      style: { paddingLeft: '8px', paddingRight: '8px' },
    });
    this.$title = tag('div', {
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
    this.$title.append(indicator, label, this.$actions);
    this.$wrapper.append(this.$title, this.$ul);
  }

  get collapsed() {
    return this.$wrapper.classList.contains('hidden');
  }

  collapse() {
    this.$wrapper.classList.add('hidden');
  }

  expand() {
    this.$wrapper.classList.remove('hidden');
  }

  toggle() {
    if (this.collapsed) {
      this.expand();
    } else {
      this.collapse();
    }
  }

  addAction({ action, className } = {}) {
    const btn = tag('span', {
      className: `action-button ${className ? className : ''}`,
      style: {
        pointerEvents: 'all',
        paddingLeft: '8px',
        paddingRight: '8px'
      },
      dataset: { action }
    });
    this.$actions.appendChild(btn);
  }

  setLoading(loading) {
    this.$title.classList[loading ? 'add' : 'remove']('loading');
  }

  setItems(items = []) {
    const newKeys = []
    const newMap = new Map();

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const k = it.filepath;
      newKeys.push(k);
      newMap.set(k, it);
    }

    for (const existingKey of Array.from(this.itemMap.keys())) {
      if (!newMap.has(existingKey)) {
        const { el } = this.itemMap.get(existingKey);
        if (el && el.parentElement) el.remove();
        this.itemMap.delete(existingKey);
        const idx = this.order.indexOf(existingKey);
        if (idx !== -1) this.order.splice(idx, 1);
      }
    }

    let insertBeforeEl = this.$ul.firstChild;
    const frag = document.createDocumentFragment();

    for (let i = 0; i < newKeys.length; i++) {
      const key = newKeys[i];
      const item = newMap.get(key);
      const existing = this.itemMap.get(key);

      if (existing) {
        const oldData = existing.data;
        if (this.shouldUpdateItem(oldData, item)) {
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
        const newEl = this.createListItem(item);
        if (!newEl.dataset || !newEl.dataset.url) newEl.dataset.url = key;
        this.itemMap.set(key, { el: newEl, data: item });
        this.order.push(key);
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
    this.order.length = 0;
    Array.prototype.push.apply(this.order, newOrder);
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
    if (data) {
      if ($status) {
        const sym = data.symbol;
        $status.textContent = sym;
        $status.className = `git-status-sym git-status-${sym}`;
      }
    } else {
      if ($status) $status.remove();
    }
  }

  createListItem(item) {
    const $item = tag('li', {
      className: 'tile',
      dataset: {
        type: 'file',
        action: this.key,
        filepath: item.filepath,
        staged: item.isStaged,
        unstaged: item.isUnstaged
      }
    });

    const $icon = tag('span', {
      className: helpers.getIconForFile(Url.basename(item.filepath))
    });

    const $label = tag('span', {
      className: 'text',
      innerText: Url.basename(item.filepath),
      style: this.strikeOnDelete && item.isUnstaged && item.symbol === 'D' ? {
        textDecoration: 'line-through'
      } : undefined
    });

    const $status = tag('span', {
      className: `git-status-sym git-status-${item.symbol}`,
      innerText: item.symbol
    });

    $item.append($icon, $label, $status);
    return $item;
  }

  shouldUpdateItem(oldData = {}, newData = {}) {
    if (!oldData || !newData) return true;
    if (oldData.symbol !== newData.symbol) return true;
    if (!!oldData.isIgnored !== !!newData.isIgnored) return true;
    if ((oldData.filepath || '') !== (newData.filepath || '')) return true;
    return false;
  }

  clear() {
    this.$ul.innerHTML = '';
    for (const btn of this.actionButtons.values()) btn.remove();
    this.actionButtons.clear();
    this.itemMap.clear();
    this.order.length = 0;
  }
}
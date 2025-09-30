import git from "./git.js";

const prompt = acode.require('prompt');
const confirm = acode.require('confirm');
const actionStack = acode.require('actionStack');
const Loader = acode.require('loader');

export default {
  checkout,
  createBranch,
  renameBranch,
  deleteBranch,
  listBranches
};

async function checkout() {
  const [branches, remoteBranches] = await Promise.all([listBranches(), listRemoteBranches()]);

  const options = [{ value: 'create:new', icon: 'add', text: 'Create new branch' }];
  const selectedBranch = await selectBranch('Select a branch to checkout', branches, remoteBranches, options);

  if (selectedBranch === 'create:new') {
    await createBranch(true);
  } else {
    const loader = Loader.create('Loading', 'Checkout');

    const handlers = {
      onProgress: (progress) => {
        if (!progress) return;
        let loaded = Number(progress.loaded || 0);
        let total = Number(progress.total || 0);
        let phase = progress.phase;
        let percent = total ? Math.round((loaded / total) * 100) : (progress.percent || 0);
        loader?.setTitle(phase);
        loader?.setMessage(`working (${percent})%`);
      }
    }

    try {
      const branchName = selectedBranch.name;
      if (selectedBranch.remote) {
        await git.checkout({ ref: branchName, remote: selectedBranch.remote, ...handlers });
        window.toast(`Checked out to ${branchName} (tracking ${selectedBranch.remote}/${branchName})`, 3000);
      } else {
        await git.checkout({ ref: branchName, ...handlers });
        window.toast(`Checked out to ${branchName}`, 3000);
      }
    } catch (error) {
      if (error.code === 'CheckoutConflictError') {
        const data = error.data.data || error.data;
        const files = data.filepaths || [];
        let message = `
          <p>Your local changes to the following files would be overwritten by checkout:</p>
          <div style="margin-left: 20px;">
            ${files.map(file => `<p><strong>${file}</strong></p>`).join('')}
          </div>
          <p>Please commit your changes or stash them before you switch branches.</p>
        `;
        acode.require('alert')(error.code, message);
      } else throw error;
    } finally {
      loader.destroy();
    }
  }
}

async function createBranch(checkout = false) {
  const branch = await prompt('Branch name', '', 'text', {
    required: true,
    placeholder: 'Please provide a new branch name'
  });
  if (!branch) return;
  await git.createBranch(branch);
  if (checkout) {
    await git.checkout({ ref: branch });
    window.toast(`Checked out to ${branch}`, 3000);
  }
}

async function renameBranch() {
  const currentBranch = await git.branch();
  const newBranch = await prompt(
    'Branch name',
    currentBranch ? currentBranch : '',
    'text',
    {
      required: true,
      placeholder: 'Please provide a new branch name'
    }
  );
  if (currentBranch && newBranch) {
    await git.renameBranch(currentBranch, newBranch);
  }
}

async function deleteBranch() {
  const branches = await listBranches();
  const selectedBranch = await selectBranch('Select a branch to delete', branches.filter(b => !b.isCurrent));

  if (selectedBranch) {
    const confirmation = await confirm('WARNING', `Are you sure you want to delete branch '${selectedBranch.name}'`);
    if (confirmation) {
      await git.deleteBranch(selectedBranch.name);
      window.toast('Done', 3000);
    }
  }
}

/**
 * @see https://github.com/Acode-Foundation/acode-plugin/blob/main/src/dialogs/select.js
 */
async function selectBranch(title, branches, remoteBranches = [], extraOptions = []) {
  return new Promise((resolve, reject) => {
    const $mask = tag('span', { className: 'mask', onclick: cancel })
    const $list = tag('ul', { className: `scroll` });
    const $titleSpan = tag('strong', { className: 'title', innerText: title });
    const $select = tag('div', {
      className: 'prompt select-branch',
      children: [$titleSpan, $list]
    });

    for (const option of extraOptions) {
      const icon = option.icon ? tag('i', { className: `icon ${option.icon}` }) : null;
      const $item = tag('li', {
        className: 'tile',
        children: [
          icon,
          tag('span', {
            className: 'text',
            innerHTML: option.text || ''
          })
        ],
        style: { textTransform: 'initial !important' }
      });
      $item.tabIndex = "0";
      $item.onclick = function (e) {
        let target = e.target;
        while (target && target !== $item) {
          target = target.parentElement;
        }
        hide();
        resolve(option.value);
      }
      $list.append($item);
    }

    if (branches.length > 0) {
      $list.append(createTitle('branches'));
      branches.map(branch => {
        const $item = createBranchItem(branch);
        $list.append($item);
      });
    }

    if (Object.values(remoteBranches).length > 0) {
      $list.append(createTitle('remote branches'));
      for (const [, branches] of Object.entries(remoteBranches)) {
        if (!branches.length) continue;
        for (const branch of branches) {
          const $item = createBranchItem(branch);
          $list.append($item);
        }
      }
    }

    actionStack.push({
      id: 'select-branch',
      action: cancel
    });

    app.append($select, $mask);

    function createTitle(title) {
      return tag('p', {
        innerText: title,
        style: {
          width: '100%',
          marginTop: '5px',
          fontSize: '0.9em',
          textAlign: 'end'
        }
      });
    }

    function createBranchItem(branch) {
      const isRemote = !!branch.remote,
        commit = branch.lastCommit,
        oid = commit ? commit.oid.slice(0, 7) : null,
        author = commit ? commit.author : null,
        date = commit ? formatTime(commit.timestamp) : '',
        message = commit ? commit.message : '',
        badges = (branch.ahead || branch.behind)
          ? `${branch.behind}↓ ${branch.ahead}↑ •`
          : '';

      const $item = tag('li', {
        className: 'tile',
        children: [
          tag('i', { className: `icon vcsp-${isRemote ? 'remote' : 'branch'}` }),
          tag('span', {
            className: 'text',
            innerHTML: `
              <p>${isRemote ? branch.fullName : branch.name}<small> ${badges} ${date}</small></p>
              <p><small>${author ? `${author} •` : ''} ${oid ? `${oid} •` : ''} ${message}</small></p>
            `
          })
        ],
        style: { textTransform: 'initial !important' }
      });

      $item.tabIndex = "0";
      $item.onclick = function (e) {
        let target = e.target;
        while (target && target !== $item) {
          target = target.parentElement;
        }
        hide();
        resolve(branch);
      }

      return $item;
    }

    function cancel() {
      hide();
      reject();
    }

    function hide() {
      actionStack.remove('select-branch');
      $select.classList.add('hide');
      setTimeout(() => {
        $select.remove();
        $mask.remove();
      }, 300);
    }
  });
}

function formatTime(timestamp) {
  const now = Date.now();
  const diff = Math.floor((now - timestamp) / 1000);

  if (diff < 45) return `${diff} now`;
  if (diff < 90) return `1 minute ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} days ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)} months ago`;
  return `${Math.floor(diff / 31536000)} years ago`;
}

async function listRemoteBranches() {
  const remoteList = await git.listRemotes();

  const remoteBranches = [];
  for (const { remote } of remoteList) {
    const branches = (await git.listBranches(remote))
      .filter(branch => branch !== 'HEAD')
      .map(async branch => ({
        name: branch,
        remote,
        fullName: `${remote}/${branch}`,
        lastCommit: await getLastCommit(branch, remote)
      }));
    remoteBranches[remote] = await Promise.all(branches);
  }
  return remoteBranches;
}

async function listBranches(aheadBehindDepth = 200) {
  const currentBranch = await git.branch();
  const localBranches = await git.listBranches();

  const branches = [];
  for (const name of localBranches) {
    const meta = {
      name,
      isLocal: true,
      remotes: [],
      isCurrent: name === currentBranch,
      upstream: null,
      ahead: 0,
      behind: 0,
      lastCommit: await getLastCommit(name)
    };

    try {
      const remoteCfg = await git.getConfig(`branch.${name}.remote`);
      const mergeCfg = await git.getConfig(`branch.${name}.merge`);
      if (remoteCfg && mergeCfg) {
        meta.upstream = { remote: remoteCfg, remoteBranch: mergeCfg.replace('refs/heads/', '') };
        meta.remotes = [remoteCfg];
      }
    } catch (e) { }

    if (meta.upstream) {
      const depth = Math.max(1, Math.min(aheadBehindDepth, 200));
      const upstreamRef = `${meta.upstream.remote}/${meta.upstream.remoteBranch}`;
      const { ahead, behind } = await getAheadBehindCount(name, upstreamRef, depth);
      meta.ahead = ahead;
      meta.behind = behind;
    }

    branches.push(meta);
  }

  branches.sort((a, b) => {
    if (a.isCurrent && !b.isCurrent) return -1;
    if (!a.isCurrent && b.isCurrent) return 1;
    return a.name.localeCompare(b.name);
  });

  return branches;
}

async function getLastCommit(branch, remote) {
  const refs = remote ? [
    `${remote}/${branch}`,
    `refs/remotes/${remote}/${branch}`,
    `refs/heads/${branch}`
  ] : [branch];
  for (const ref of refs) {
    try {
      const log = await git.post('/log', { ref, depth: 1 });
      if (log.length) {
        const c = log[0];
        return {
          oid: c.oid || c.commit.tree,
          message: c.commit.message,
          author: c.commit.author.name,
          timestamp: c.commit.author.timestamp * 1000
        }
      }
    } catch (e) { }
  }
  return null;
}

/**
 * @returns {Promise<{ahead: number, behind: number}}
 */
async function getAheadBehindCount(branch, remoteRef, depth = 100) {
  try {
    const [localCommits, remoteCommits] = await Promise.all([
      git.post('/log', { ref: branch, depth }),
      git.post('/log', { ref: remoteRef, depth })
    ]);

    const localOids = new Set((localCommits || []).map(l => l.oid));
    const remoteOids = new Set((remoteCommits || []).map(l => l.oid));

    const ahead = localCommits.filter(c => !remoteOids.has(c.oid)).length;
    const behind = remoteCommits.filter(c => !localOids.has(c.oid)).length;

    return { ahead, behind };
  } catch (e) {
    return { ahead: 0, behind: 0 }
  }
}
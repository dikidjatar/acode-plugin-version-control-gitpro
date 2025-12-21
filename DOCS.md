# Documentation

## Table of Contents

1. [Installation](#installation)
2. [Getting Started](#getting-started)
7. [API Reference](#api-reference)

## Installation

#### 1. Install Git

```bash
apk add git
```

#### 2. Install Plugin

1. Open Acode → Settings → Plugins
2. Search "Git SCM" or "Version Control GitPro"
3. Install plugin
4. Restart

#### 4. Optional: Install inotify-tools

For automatic file change detection:

```bash
apk add inotify-tools
```

Enable in plugin settings `GIt: Use inotifywait` and restart

## Getting Started

### Opening a Git Repository

#### Method 1: Open Existing Repository

1. Open a folder containing Git repository (`.git` folder)
2. Select folder
3. Plugin will automatically detect the repository

#### Method 2: Clone Repository

1. Open Command Palette (`Ctrl+Shift+P`)
2. Type `Git: Clone`
3. Enter repository URL
4. Choose destination folder
5. Wait for clone to complete

#### Method 3: Initialize New Repository

1. Open a folder
2. Open Command Palette and type `Git: Initialize Repository`
3. Or click "Initialize Repository" button

### Understanding the SCM Panel

**Components:**
- **Input Box**: For writing commit messages
- **Action Buttons**: Commit, Sync, More Actions
- **Repository Info**: Branch name, ahead/behind commits
- **Changes**: Unstaged files
- **Staged Changes**: Files ready to commit

## API Reference

### Git API

Access the Git API:

```javascript
const gitPlugin = acode.require('git');
const git = gitPlugin.getAPI(1);
```

#### API Interface

```typescript
interface API {
  readonly state: 'initialized' | 'uninitialized';
  readonly git: Git;
  readonly repositories: Repository[];
  
  readonly onDidOpenRepository: Event<Repository>;
  readonly onDidCloseRepository: Event<Repository>;
  readonly onDidChangeState: Event<'initialized' | 'uninitialized'>;
  readonly onDidPublish: Event<PublishEvent>;
  
  getRepository(uri: string): Repository | null;
  getRepositoryRoot(uri: string): Promise<string | null>;
  init(root: string, options?: InitOptions): Promise<Repository | null>;
  openRepository(root: string): Promise<Repository | null>;
  
  registerRemoteSourcePublisher(publisher: RemoteSourcePublisher): Disposable;
  registerCredentialsProvider(provider: CredentialsProvider): Disposable;
  registerPushErrorHandler(handler: PushErrorHandler): Disposable;
}
```

#### Repository Interface

```typescript
interface Repository {
  readonly rootUri: string;
  readonly inputBox: InputBox;
  readonly state: RepositoryState;
  readonly ui: RepositoryUIState;
  
  readonly onDidCommit: Event<void>;
  readonly onDidCheckout: Event<void>;
  
  // Configuration
  getConfig(key: string): Promise<string>;
  setConfig(key: string, value: string): Promise<string>;
  getGlobalConfig(key: string): Promise<string>;
  
  // Staging
  add(paths: string[]): Promise<void>;
  revert(paths: string[]): Promise<void>;
  clean(paths: string[]): Promise<void>;
  
  // Commits
  commit(message: string, opts?: CommitOptions): Promise<void>;
  getCommit(ref: string): Promise<Commit>;
  log(options?: LogOptions): Promise<Commit[]>;
  
  // Branches
  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
  deleteBranch(name: string, force?: boolean): Promise<void>;
  getBranch(name: string): Promise<Branch>;
  getBranches(query: BranchQuery): Promise<Ref[]>;
  checkout(treeish: string): Promise<void>;
  
  // Remotes
  addRemote(name: string, url: string): Promise<void>;
  removeRemote(name: string): Promise<void>;
  renameRemote(name: string, newName: string): Promise<void>;
  fetch(options?: FetchOptions): Promise<void>;
  pull(unshallow?: boolean): Promise<void>;
  push(remoteName?: string, branchName?: string, setUpstream?: boolean, force?: ForcePushMode): Promise<void>;
  
  // Tags
  tag(name: string, upstream: string): Promise<void>;
  deleteTag(name: string): Promise<void>;
  getRefs(query: RefQuery): Promise<Ref[]>;
  
  // Merge
  merge(ref: string): Promise<void>;
  mergeAbort(): Promise<void>;
  
  // Other
  status(): Promise<void>;
  apply(patch: string, reverse?: boolean): Promise<void>;
  checkIgnore(paths: string[]): Promise<Set<string>>;
}
```

#### Repository State

```typescript
interface RepositoryState {
  readonly HEAD: Branch | undefined;
  readonly remotes: Remote[];
  readonly submodules: Submodule[];
  readonly rebaseCommit: Commit | undefined;
  
  readonly mergeChanges: Change[];
  readonly indexChanges: Change[];
  readonly workingTreeChanges: Change[];
  readonly untrackedChanges: Change[];
  
  readonly onDidChange: Event<void>;
}
```

### SCM API

Access the SCM API:

```javascript
const scm = acode.require('scm');
```

#### Create Source Control

```javascript
const sourceControl = scm.createSourceControl(
  'my-scm-id',      // Unique ID
  'My SCM Label'    // Display label,
  '/public'         // Root URI
);

// Set icon
sourceControl.icon = 'git-branch';

// Set root URI
sourceControl.rootUri = '/path/to/repo';
```

#### Create Resource Groups

```javascript
const changes = sourceControl.createResourceGroup(
  'workingTree',
  'Changes'
);

const staged = sourceControl.createResourceGroup(
  'index',
  'Staged Changes'
);

changes.hideWhenEmpty = false;
```

#### Add Resources

```javascript
changes.resourceStates = [
  {
    resourceUri: '/path/to/file1.js',
    decorations: {
      letter: 'M',
      color: '#ffa500',
      strikeThrough: false,
      icon: 'modified'
    }
  },
  {
    resourceUri: '/path/to/file2.js',
    decorations: {
      letter: 'A',
      color: '#00ff00'
    }
  }
];
```

#### Input Box

```javascript
// Set input box properties
sourceControl.inputBox.value = 'Initial commit';
sourceControl.inputBox.placeholder = 'Message';
sourceControl.inputBox.enabled = true;

// Listen to changes
sourceControl.inputBox.onDidChange(value => {
  console.log('Input changed:', value);
});
```

#### Command Actions

```javascript
sourceControl.commandActions = [
  {
    id: 'command.commit',
    title: 'Commit',
    arguments: []
  },
  {
    id: 'command.push',
    title: 'Push',
    arguments: ['origin', 'main']
  }
];
```

#### Action Button

```javascript
sourceControl.actionButton = {
  command: {
    id: 'command.sync',
    title: 'Sync Changes'
  },
  secondaryCommands: [
    [
      {
        id: 'command.pull',
        title: 'Pull'
      },
      {
        id: 'command.push',
        title: 'Push'
      }
    ]
  ],
  enabled: true
};
```

#### Events

```javascript
// Repository selection changed
sourceControl.onDidChangeSelection(selected => {
  if (selected) {
    console.log('Repository selected');
  }
});
```

## Configuration

### Plugin Settings

All settings accessible via: **Settings → Plugins → Git SCM**

#### Core Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable Git integration |
| `defaultBranchName` | string | `"master"` | Default branch name for new repositories |
| `autoRepositoryDetection` | boolean/string | `true` | Auto-detect Git repositories (`true`, `false`, `subFolders`) |
| `repositoryScanMaxDepth` | number | `1` | Max depth for repository scanning (-1 = unlimited) |
| `repositoryScanIgnoredFolders` | string[] | `["node_modules"]` | Folders to ignore during scan |

#### Display Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `decorationsEnabled` | boolean | `true` | Show file decorations in explorer |
| `showCommitInput` | boolean | `true` | Show commit input box in SCM panel |
| `alwaysShowStagedChangesResourceGroup` | boolean | `false` | Always show staged changes group |
| `showReferenceDetails` | boolean | `true` | Show details in branch/tag pickers |

#### Behavior Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `autorefresh` | boolean | `true` | Automatically refresh repository status |
| `useInotifywait` | boolean | `true` | Use inotifywait for file watching |
| `showProgress` | boolean | `true` | Show progress for Git operations |
| `statusLimit` | number | `200` | Max number of changes to display (0 = unlimited) |
| `untrackedChanges` | string | `"mixed"` | How to show untracked files (`mixed`, `separate`, `hidden`) |

#### Commit Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `useEditorAsCommitInput` | boolean | `true` | Use Acode editor for commit messages |
| `promptToSaveFilesBeforeCommit` | string | `"always"` | Prompt to save before commit (`always`, `staged`, `never`) |
| `enableSmartCommit` | boolean | `false` | Commit all changes when nothing staged |
| `smartCommitChanges` | string | `"all"` | What to include in smart commit (`all`, `tracked`) |
| `suggestSmartCommit` | boolean | `true` | Suggest enabling smart commit |
| `verboseCommit` | boolean | `false` | Enable verbose commit output |
| `requireGitUserConfig` | boolean | `true` | Require Git user configuration |
| `confirmEmptyCommits` | boolean | `true` | Confirm empty commits |
| `allowNoVerifyCommit` | boolean | `false` | Allow commits without verification |
| `confirmNoVerifyCommit` | boolean | `true` | Confirm no-verify commits |

#### Branch Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `branchWhitespaceChar` | string | `"-"` | Character to replace whitespace in branch names |
| `branchPrefix` | string | `""` | Prefix for new branches |
| `branchValidationRegex` | string | `""` | Regex to validate branch names |
| `branchSortOrder` | string | `"committerdate"` | Branch sort order (`alphabetically`, `committerdate`) |
| `checkoutType` | string | `"all"` | Refs shown in checkout (`all`, `local`, `remote`, `tags`) |
| `pullBeforeCheckout` | boolean | `false` | Pull before checking out branch |

#### Remote Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `autofetch` | boolean/string | `true` | Auto-fetch from remote (`true`, `false`, `all`) |
| `autofetchPeriod` | number | `180` | Auto-fetch interval in seconds |
| `fetchOnPull` | boolean | `false` | Fetch all branches when pulling |
| `pullTags` | boolean | `true` | Fetch tags when pulling |
| `pruneOnFetch` | boolean | `false` | Prune deleted branches when fetching |
| `enableStatusBarSync` | boolean | `true` | Show sync button in status bar |

#### Push/Pull Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `allowForcePush` | boolean | `false` | Allow force push operations |
| `useForcePushWithLease` | boolean | `true` | Use safer force-with-lease |
| `useForcePushIfIncludes` | boolean | `true` | Use force-if-includes (Git 2.30+) |
| `confirmForcePush` | boolean | `true` | Confirm before force pushing |
| `confirmSync` | boolean | `true` | Confirm sync operation |
| `rebaseWhenSync` | boolean | `false` | Use rebase instead of merge for sync |
| `followTagsWhenSync` | boolean | `false` | Push tags during sync |
| `autoStash` | boolean | `false` | Auto-stash changes before pull |
| `replaceTagsWhenPull` | boolean | `false` | Replace local tags with remote |
| `ignoreRebaseWarning` | boolean | `false` | Ignore rebase warnings |

#### Advanced Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `useIntegratedAskPass` | boolean | `true` | Use integrated credential prompt |
| `detectSubmodules` | boolean | `true` | Automatically detect submodules |
| `detectSubmodulesLimit` | number | `10` | Max submodules to detect |
| `ignoreSubmodules` | boolean | `false` | Ignore submodule modifications |
| `similarityThreshold` | number | `50` | Threshold for rename detection (Git 2.18+) |
| `commandsToLog` | string[] | `[]` | Git commands to log output |
| `commitShortHashLength` | number | `7` | Length of short commit hashes |
| `ignoreLimitWarning` | boolean | `false` | Ignore warnings about too many changes |
| `ignoreLegacyWarning` | boolean | `false` | Ignore legacy Git warnings |
| `ignoreMissingGitWarning` | boolean | `false` | Ignore missing Git warning |
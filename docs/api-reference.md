# Plugin Public API Reference

This plugin exposes two public APIs reachable by any other Acode plugin:

- [`git`](#git-api) — Git operations (commit, push, diff, branches, remotes, etc.)
- [`scm`](#scm-api) — Source Control UI (register custom SCM providers, menus)

---

## Git API

Access via `acode.require("git")`:

```js
const gitPlugin = acode.require("git");
const api = gitPlugin.getAPI(1);
```

### `GitExtension`

| Property | Type | Description |
|---|---|---|
| `enabled` | `boolean` | Whether Git is available |
| `onDidChangeEnablement` | `Event<boolean>` | Fires when enabled state changes |
| `getAPI(version)` | `API` | Returns versioned API (currently only `1`) |

### `API`

| Property | Type | Description |
|---|---|---|
| `state` | `'uninitialized' \| 'initialized'` | Plugin initialization state |
| `onDidChangeState` | `Event<APIState>` | Fires on state change |
| `onDidPublish` | `Event<PublishEvent>` | Fires when a repository is published |
| `git` | `Git` | Git executable info (`{ path: string }`) |
| `repositories` | `Repository[]` | All open repositories |
| `onDidOpenRepository` | `Event<Repository>` | Fires when a repo is opened |
| `onDidCloseRepository` | `Event<Repository>` | Fires when a repo is closed |

| Method | Returns | Description |
|---|---|---|
| `toGitUri(uri, ref)` | `string` | Convert a file URI to a `git://` URI for a given ref |
| `getRepository(uri)` | `Repository \| null` | Get repository containing the given path |
| `getRepositoryRoot(uri)` | `Promise<string \| null>` | Get repository root path for a file |
| `init(root, options?)` | `Promise<Repository \| null>` | Initialize a new Git repo |
| `openRepository(root)` | `Promise<Repository \| null>` | Open and track an existing repo |
| `registerRemoteSourcePublisher(publisher)` | `IDisposable` | Register a remote source publisher |
| `registerRemoteSourceProvider(provider)` | `IDisposable` | Register a remote source provider |
| `registerCredentialsProvider(provider)` | `IDisposable` | Register a credential provider |
| `registerPushErrorHandler(handler)` | `IDisposable` | Register a push error handler |
| `pickRemoteSource(options)` | `Promise<string \| undefined>` | Show remote source picker |

### `Repository`

| Property | Type | Description |
|---|---|---|
| `rootUri` | `string` | Absolute path to the repository root |
| `inputBox` | `InputBox` | Commit message input box |
| `state` | `RepositoryState` | Current repo state (HEAD, branches, changes) |
| `ui` | `RepositoryUIState` | UI selection state |
| `onDidCommit` | `Event<void>` | Fires after a commit |
| `onDidCheckout` | `Event<void>` | Fires after a checkout |

#### Config

| Method | Returns | Description |
|---|---|---|
| `getConfigs()` | `Promise<{ key, value }[]>` | Get all repo config values |
| `getConfig(key)` | `Promise<string>` | Get a config value |
| `setConfig(key, value)` | `Promise<string>` | Set a config value |
| `unsetConfig(key)` | `Promise<string>` | Unset a config value |
| `getGlobalConfig(key)` | `Promise<string>` | Get a global Git config value |

#### Object / Data

| Method | Returns | Description |
|---|---|---|
| `getObjectDetails(treeish, path)` | `Promise<{ mode, object, size }>` | Get file mode, object hash, and size |
| `buffer(ref, path)` | `Promise<any>` | Get raw file contents at a given ref |
| `getCommit(ref)` | `Promise<Commit>` | Get commit details by hash |

#### Working Tree / Staging

| Method | Returns | Description |
|---|---|---|
| `add(paths)` | `Promise<void>` | Stage files |
| `revert(paths)` | `Promise<void>` | Revert unstaged changes |
| `clean(paths)` | `Promise<void>` | Discard working tree changes |
| `apply(patch, reverse?)` | `Promise<void>` | Apply a patch |

#### Diff

| Method | Returns | Description |
|---|---|---|
| `diffWithHEAD()` | `Promise<Change[]>` | List all changes vs HEAD |
| `diffWithHEAD(path)` | `Promise<string>` | Raw diff of a single file vs HEAD |
| `diffIndexWithHEAD()` | `Promise<Change[]>` | List staged changes vs HEAD |
| `diffIndexWithHEAD(path)` | `Promise<string>` | Raw diff of a staged file vs HEAD |

#### Branches

| Method | Returns | Description |
|---|---|---|
| `createBranch(name, checkout, ref?)` | `Promise<void>` | Create (and optionally checkout) a branch |
| `deleteBranch(name, force?)` | `Promise<void>` | Delete a branch |
| `getBranch(name)` | `Promise<Branch>` | Get branch info |
| `getBranches(query)` | `Promise<Ref[]>` | List branches matching query |
| `setBranchUpstream(name, upstream)` | `Promise<void>` | Set upstream branch |
| `checkIgnore(paths)` | `Promise<Set<string>>` | Check which paths are gitignored |
| `getRefs(query)` | `Promise<Ref[]>` | List refs matching query |
| `checkout(treeish)` | `Promise<void>` | Checkout a branch or ref |

#### Remotes

| Method | Returns | Description |
|---|---|---|
| `addRemote(name, url)` | `Promise<void>` | Add a remote |
| `removeRemote(name)` | `Promise<void>` | Remove a remote |
| `renameRemote(name, newName)` | `Promise<void>` | Rename a remote |

#### Sync

| Method | Returns | Description |
|---|---|---|
| `fetch(options?)` | `Promise<void>` | Fetch from remote(s) |
| `pull(unshallow?)` | `Promise<void>` | Pull from upstream |
| `push(remoteName?, branchName?, setUpstream?, force?)` | `Promise<void>` | Push to remote |

#### History

| Method | Returns | Description |
|---|---|---|
| `log(options?)` | `Promise<Commit[]>` | Get commit log |

#### Commits

| Method | Returns | Description |
|---|---|---|
| `commit(message, opts?)` | `Promise<void>` | Create a commit |

#### Merging

| Method | Returns | Description |
|---|---|---|
| `merge(ref)` | `Promise<void>` | Merge a branch/ref |
| `mergeAbort()` | `Promise<void>` | Abort an in-progress merge |

#### Misc

| Method | Returns | Description |
|---|---|---|
| `status()` | `Promise<void>` | Refresh repository status |
| `tag(name, message, ref?)` | `Promise<void>` | Create a tag |
| `deleteTag(name)` | `Promise<void>` | Delete a tag |

---

## SCM API

Access via `acode.require("scm")`:

```js
const scm = acode.require("scm");
```

### `SCMModule`

| Method | Returns | Description |
|---|---|---|
| `createSourceControl(id, label, rootUri?, icon?)` | `SourceControl` | Register a new SCM provider in the UI |
| `getViewContainer()` | `SourceControlViewContainer` | Get the SCM view container |
| `registerMenuItems(menuId, items)` | `IDisposable` | Register SCM context menu items |
| `setContext(id, value)` | `void` | Set a context value |
| `getContext(id, defaultValue)` | `unknown` | Get a context value |

### `SourceControl`

| Property/Method | Type/Returns | Description |
|---|---|---|
| `id` | `string` | Unique provider ID |
| `label` | `string` | Display name |
| `rootUri` | `string \| undefined` | Root URI of the provider |
| `inputBox` | `SourceControlInputBox` | Input box for commit messages |
| `count` | `number \| undefined` | Badge count |
| `contextValue` | `string \| undefined` | Context value |
| `commandActions` | `SourceControlCommandAction[] \| undefined` | Title menu actions |
| `actionButton` | `SourceControlActionButton \| undefined` | Action button descriptor |
| `selected` | `boolean` | Whether this provider is selected |
| `createResourceGroup(id, label)` | `SourceControlResourceGroup` | Create a resource group |
| `onDidChangeSelection` | `Event<boolean>` | Fires when selection changes |
| `dispose()` | `void` | Dispose the provider |

### `SourceControlResourceGroup`

| Property/Method | Type/Returns | Description |
|---|---|---|
| `id` | `string` | Unique group ID |
| `label` | `string` | Display label |
| `hideWhenEmpty` | `boolean \| undefined` | Hide when no resources |
| `contextValue` | `string \| undefined` | Context value |
| `resourceStates` | `SourceControlResourceState[]` | Resources in this group |
| `dispose()` | `void` | Dispose the group |

### `SourceControlResourceState`

| Property | Type | Description |
|---|---|---|
| `resourceUri` | `string` | URI of the resource |
| `decorations` | `SourceControlResourceDecorations \| undefined` | Icon and strikethrough |
| `command` | `SourceControlCommandAction \| undefined` | Command to execute on click |
| `contextValue` | `string \| undefined` | Context value |

### `SourceControlViewContainer`

| Method | Returns | Description |
|---|---|---|
| `registerViewWelcomeContent(viewContent)` | `any` | Register welcome content |
| `updateViews()` | `void` | Refresh the view |
| `getProgress()` | `SourceControlProgess` | Show/hide progress indicator |

### Menu Items

`SourceControlMenuItem` structure:

| Property | Type | Description |
|---|---|---|
| `command` | `SourceControlCommandAction` | Command to execute |
| `group` | `'navigation' \| string \| undefined` | Menu group |
| `submenu` | `boolean \| undefined` | Is a submenu |
| `enablement` | `(() => boolean) \| undefined` | Dynamic enablement |
| `when` | `((context: SourceControlMenuContext) => boolean) \| undefined` | Visibility condition |

---

## Shared Types

### `Event<T>`

```ts
interface Event<T> {
  (listener: (e: T) => any, thisArgs?: any, disposables?: IDisposable[]): IDisposable;
}
```

### `IDisposable`

```ts
interface IDisposable {
  dispose(): void;
}
```

### `Change`

```ts
interface Change {
  readonly uri: string;
  readonly originalUri: string;
  readonly renameUri: string | undefined;
  readonly status: Status;
}
```

### `Commit`

```ts
interface Commit {
  readonly hash: string;
  readonly message: string;
  readonly parents: string[];
  readonly authorDate?: Date;
  readonly authorName?: string;
  readonly authorEmail?: string;
  readonly commitDate?: Date;
  readonly shortStat?: CommitShortStat;
}
```

### Status enum

`Status` values cover index states (`INDEX_MODIFIED`, `INDEX_ADDED`, `INDEX_DELETED`, `INDEX_RENAMED`, `INDEX_COPIED`), working tree states (`MODIFIED`, `DELETED`, `UNTRACKED`, `IGNORED`, etc.), and merge conflict states (`ADDED_BY_US`, `ADDED_BY_THEM`, `BOTH_MODIFIED`, etc.).

---

See also the TypeScript declaration files for complete type information:

- [`src/git/api/git.d.ts`](../src/git/api/git.d.ts) — Git API types
- [`src/scm/api/sourceControl.d.ts`](../src/scm/api/sourceControl.d.ts) — SCM API types

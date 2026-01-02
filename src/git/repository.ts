import { App } from "../base/app";
import { config } from "../base/config";
import { debounce, memoize, throttle } from "../base/decorators";
import { Disposable, IDisposable } from "../base/disposable";
import { Emitter, Event } from "../base/event";
import { uriToPath } from "../base/uri";
import { scm } from "../scm";
import { SourceControl, SourceControlInputBox, SourceControlProgess, SourceControlResourceDecorations, SourceControlResourceGroup, SourceControlResourceState } from "../scm/api/sourceControl";
import { ActionButton } from "./actionButton";
import { CommandActions } from "./actions";
import { ApiRepository } from "./api/api1";
import { Branch, BranchQuery, Change, Commit, CommitOptions, FetchOptions, ForcePushMode, GitErrorCodes, LogOptions, Ref, RefType, Remote, Status } from "./api/git";
import { AutoFetcher } from "./autofetch";
import { FileDecoration } from "./fileDecorationService";
import { FileSystemWatcher, RelativePattern } from "./fileSystemWatcher";
import { Repository as BaseRepository, GitError, PullOptions, RefQuery, Submodule } from "./git";
import { LogOutputChannel } from "./logger";
import { Operation, OperationKind, OperationManager, OperationResult } from "./operation";
import { IPushErrorHandlerRegistry } from "./pushError";
import { IRemoteSourcePublisherRegistry } from "./remotePublisher";
import { find, getCommitShortHash, isDescendant, relativePath, toFullPath, toShortPath } from "./utils";
import { IFileWatcher, watch } from "./watch";

const helpers = acode.require('helpers');
const Url = acode.require('url');
const fs = acode.require('fs');
const confirm = acode.require('confirm');

const timeout = (millis: number) => new Promise(c => setTimeout(c, millis));

export const enum RepositoryState {
  Idle,
  Disposed
}

export const enum ResourceGroupType {
  Merge,
  Index,
  WorkingTree,
  Untracked
}

export class Resource implements SourceControlResourceState {
  static getStatusLetter(type: Status): string {
    switch (type) {
      case Status.INDEX_MODIFIED:
      case Status.MODIFIED:
        return 'M';
      case Status.INDEX_ADDED:
      case Status.INTENT_TO_ADD:
        return 'A';
      case Status.INDEX_DELETED:
      case Status.DELETED:
        return 'D';
      case Status.INDEX_RENAMED:
      case Status.INTENT_TO_RENAME:
        return 'R';
      case Status.TYPE_CHANGED:
        return 'T';
      case Status.UNTRACKED:
        return 'U';
      case Status.IGNORED:
        return 'I';
      case Status.INDEX_COPIED:
        return 'C';
      case Status.BOTH_DELETED:
      case Status.ADDED_BY_US:
      case Status.DELETED_BY_THEM:
      case Status.ADDED_BY_THEM:
      case Status.DELETED_BY_US:
      case Status.BOTH_ADDED:
      case Status.BOTH_MODIFIED:
        return '!';
      default:
        throw new Error('Unknown git status: ' + type);
    }
  }

  static getStatusColor(type: Status) {
    switch (type) {
      case Status.INDEX_MODIFIED:
        return '#E2C08D';
      case Status.MODIFIED:
      case Status.TYPE_CHANGED:
        return '#E2C08D';
      case Status.INDEX_DELETED:
      case Status.DELETED:
        return '#c74e39';
      case Status.INDEX_ADDED:
      case Status.INTENT_TO_ADD:
        return '#73c991';
      case Status.INDEX_COPIED:
      case Status.INDEX_RENAMED:
      case Status.INTENT_TO_RENAME:
        return '#e2c08d';
      case Status.UNTRACKED:
        return '#73c991';
      case Status.IGNORED:
        return '#8c8c8c';
      case Status.BOTH_DELETED:
      case Status.ADDED_BY_US:
      case Status.DELETED_BY_THEM:
      case Status.ADDED_BY_THEM:
      case Status.DELETED_BY_US:
      case Status.BOTH_ADDED:
      case Status.BOTH_MODIFIED:
        return '#FF6961';
      default:
        throw new Error('Unknown git status: ' + type);
    }
  }

  @memoize get resourceUri(): string {
    if (this.renameResourceUri && (this._type === Status.MODIFIED || this._type === Status.DELETED || this._type === Status.INDEX_RENAMED || this._type === Status.INDEX_COPIED || this._type === Status.INTENT_TO_RENAME)) {
      return this.renameResourceUri;
    }

    return this._resourceUri;
  }

  get resourceGroupType(): ResourceGroupType { return this._resourceGroupType; }
  get type(): Status { return this._type; }
  get original(): string { return this._resourceUri; }
  get renameResourceUri(): string | undefined { return this._renameResourceUri; }

  private get strikeThrough(): boolean {
    switch (this.type) {
      case Status.DELETED:
      case Status.BOTH_DELETED:
      case Status.DELETED_BY_THEM:
      case Status.DELETED_BY_US:
      case Status.INDEX_DELETED:
        return true;
      default:
        return false;
    }
  }

  get decorations(): SourceControlResourceDecorations | undefined {
    const icon = helpers.getIconForFile(Url.basename(this.resourceUri)!);
    return { icon, color: this.color, letter: this.letter, strikeThrough: this.strikeThrough };
  }

  get letter(): string {
    return Resource.getStatusLetter(this.type);
  }

  get color(): string {
    return Resource.getStatusColor(this.type);
  }

  get resourceDecoration(): FileDecoration {
    const res = new FileDecoration(this.letter, this.color);
    res.propagate = this.type !== Status.DELETED && this.type !== Status.INDEX_DELETED;
    return res;
  }

  constructor(
    private _resourceGroupType: ResourceGroupType,
    private _resourceUri: string,
    private _type: Status,
    private _renameResourceUri?: string
  ) {

  }
}

export interface GitResourceGroup extends SourceControlResourceGroup {
  resourceStates: Resource[];
}

interface GitResourceGroups {
  indexGroup?: Resource[];
  mergeGroup?: Resource[];
  untrackedGroup?: Resource[];
  workingTreeGroup?: Resource[];
}

export interface IRepositoryResolver {
  getRepository(sourceControl: SourceControl): Repository | undefined;
  getRepository(resourceGroup: SourceControlResourceGroup): Repository | undefined;
  getRepository(path: string): Repository | undefined;
}

class ProgressManager {

  private enabled = false;
  private disposable: IDisposable = Disposable.None;
  private progress: SourceControlProgess;

  constructor(private repository: Repository) {
    this.progress = scm.getSCMProgress();
    const onDidChange = Event.filter(config.onDidChangeConfiguration, e => e.affectsConfiguration('vcgit'));
    onDidChange(() => this.updateEnablement());
    this.updateEnablement();
  }

  private updateEnablement(): void {
    const gitConfig = config.get('vcgit');
    if (gitConfig!.showProgress) {
      this.enable();
    } else {
      this.disable();
    }
  }

  private enable(): void {
    if (this.enabled) {
      return;
    }

    const start = Event.once(Event.filter(this.repository.onDidChangeOperations, () => this.repository.operations.shouldShowProgress()));
    const end = Event.once(Event.filter(Event.debounce(this.repository.onDidChangeOperations, () => { }, 300), () => !this.repository.operations.shouldShowProgress()));

    const setup = () => {
      this.disposable = start(() => {
        this.progress.show();
        Event.toPromise(end).then(() => {
          this.progress.hide();
          setup();
        });
      });
    }

    setup();
    this.enabled = true;
  }

  private disable(): void {
    if (!this.enabled) {
      return;
    }

    this.disposable.dispose();
    this.disposable = Disposable.None;
    this.enabled = false;
  }

  dispose(): void {
    this.disable();
  }
}

class FileEventLogger {

  private eventDisposable: IDisposable = Disposable.None;

  constructor(
    onWorkspaceWorkingTreeFileChange: Event<string>,
    onDotGitFileChange: Event<string>,
    logger: LogOutputChannel
  ) {
    this.eventDisposable = Disposable.create(
      onWorkspaceWorkingTreeFileChange(uri => logger.info(`[FileEventLogger][onWorkspaceWorkingTreeFileChange] ${uri}`)),
      onDotGitFileChange(uri => logger.info(`[FileEventLogger][onDotGitFileChange] ${uri}`))
    );
  }

  dispose(): void {
    this.eventDisposable.dispose();
  }
}

class DotGitWatcher implements IFileWatcher {

  readonly event: Event<string>;

  private emitter = new Emitter<string>();
  private transientDisposables: IDisposable[] = [];
  private disposables: IDisposable[] = [];

  constructor(private repository: Repository, private logger: LogOutputChannel) {
    const rootWatcher = watch(repository.dotGit.path);
    this.disposables.push(rootWatcher);

    const filteredRootWatcher = Event.filter(rootWatcher.event, path => !/\/\.git(\/index\.lock)?$|\/\.watchman-cookie-/.test(path));
    this.event = Event.any(filteredRootWatcher, this.emitter.event);

    repository.onDidRunGitStatus(this.updateTransientWatchers, this, this.disposables);
    this.updateTransientWatchers();
  }

  private updateTransientWatchers(): void {
    this.transientDisposables = Disposable.dispose(this.transientDisposables);

    if (!this.repository.HEAD || !this.repository.HEAD.upstream) {
      return;
    }

    const { name, remote } = this.repository.HEAD.upstream;
    const upstreamPath = Url.join(this.repository.dotGit.commonPath ?? this.repository.dotGit.path, 'refs', 'remotes', remote, name);

    try {
      const upstreamWatcher = watch(upstreamPath);
      this.transientDisposables.push(upstreamWatcher);
      upstreamWatcher.event(this.emitter.fire, this.emitter, this.transientDisposables);
    } catch (error) {
      this.logger.warn(`[DotGitWatcher][updateTransientWatchers] Failed to watch ref '${upstreamPath}', is most likely packed.`);
    }
  }

  dispose(): void {
    this.emitter.dispose();
    this.transientDisposables = Disposable.dispose(this.transientDisposables);
    this.disposables = Disposable.dispose(this.disposables);
  }
}

export class Repository implements IDisposable {

  private _onDidChangeRepository = new Emitter<string>();
  readonly onDidChangeRepository: Event<string> = this._onDidChangeRepository.event;

  private _onDidChangeState = new Emitter<RepositoryState>();
  readonly onDidChangeState: Event<RepositoryState> = this._onDidChangeState.event;

  private _onDidChangeStatus = new Emitter<void>();
  readonly onDidRunGitStatus: Event<void> = this._onDidChangeStatus.event;

  private _onRunOperation = new Emitter<OperationKind>();
  readonly onRunOperation: Event<OperationKind> = this._onRunOperation.event;

  private _onDidRunOperation = new Emitter<OperationResult>();
  readonly onDidRunOperation: Event<OperationResult> = this._onDidRunOperation.event;

  @memoize get onDidChangeOperations() {
    return Event.any(this.onRunOperation as Event<any>, this.onDidRunOperation as Event<any>);
  }

  private _sourceControl: SourceControl;
  get sourceControl(): SourceControl {
    return this._sourceControl;
  }

  get inputBox(): SourceControlInputBox { return this._sourceControl.inputBox; }

  private _mergeGroup: SourceControlResourceGroup;
  get mergeGroup(): GitResourceGroup {
    return this._mergeGroup as GitResourceGroup;
  }

  private _indexGroup: SourceControlResourceGroup;
  get indexGroup(): GitResourceGroup {
    return this._indexGroup as GitResourceGroup;
  }

  private _workingTreeGroup: SourceControlResourceGroup;
  get workingTreeGroup(): GitResourceGroup {
    return this._workingTreeGroup as GitResourceGroup;
  }

  private _untrackedGroup: SourceControlResourceGroup;
  get untrackedGroup(): GitResourceGroup {
    return this._untrackedGroup as GitResourceGroup;
  }

  private _EMPTY_TREE: string | undefined;

  private _HEAD: Branch | undefined;
  get HEAD(): Branch | undefined {
    return this._HEAD;
  }

  get headShortName(): string | undefined {
    if (!this.HEAD) {
      return;
    }

    const HEAD = this.HEAD;

    if (HEAD.name) {
      return HEAD.name;
    }

    return (HEAD.commit || '').substr(0, 8);
  }

  private _remotes: Remote[] = [];
  get remotes(): Remote[] {
    return this._remotes;
  }

  private _submodules: Submodule[] = [];
  get submodules(): Submodule[] {
    return this._submodules;
  }

  private _rebaseCommit: Commit | undefined = undefined;
  set rebaseCommit(rebaseCommit: Commit | undefined) {
    if (this._rebaseCommit && !rebaseCommit) {
      this.inputBox.value = '';
    } else if (rebaseCommit && (!this._rebaseCommit || this._rebaseCommit.hash !== rebaseCommit.hash)) {
      this.inputBox.value = rebaseCommit.message;
    }

    const shouldUpdateContext = !!this._rebaseCommit !== !!rebaseCommit;
    this._rebaseCommit = rebaseCommit;

    if (shouldUpdateContext) {
      App.setContext('gitRebaseInProgress', !!this._rebaseCommit);
    }
  }
  get rebaseCommit(): Commit | undefined {
    return this._rebaseCommit;
  }

  private _mergeInProgress: boolean = false;
  set mergeInProgress(value: boolean) {
    if (this._mergeInProgress === value) {
      return;
    }

    this._mergeInProgress = value;
    App.setContext('gitMergeInProgress', value);
  }
  get mergeInProgress(): boolean {
    return this._mergeInProgress;
  }

  private _operations: OperationManager;
  get operations(): OperationManager { return this._operations; }

  private _state = RepositoryState.Idle;
  get state() { return this._state };
  set state(state: RepositoryState) {
    this._state = state;
    this._onDidChangeState.fire(state);

    this._HEAD = undefined;
    this._remotes = [];
    this._mergeGroup.resourceStates = [];
    this._indexGroup.resourceStates = [];
    this._workingTreeGroup.resourceStates = [];
    this._untrackedGroup.resourceStates = [];
    this._sourceControl.count = 0;
  }

  get root(): string {
    return this.repository.root;
  }

  get rootRealPath(): string | undefined {
    return this.repository.rootRealPath;
  }

  get dotGit(): { path: string; commonPath?: string; } {
    return this.repository.dotGit;
  }

  private isRepositoryHuge: false | { limit: number } = false;
  private didWarnAboutLimit = false;

  private disposables: IDisposable[] = [];

  constructor(
    private readonly repository: BaseRepository,
    private readonly repositoryResolver: IRepositoryResolver,
    private pushErrorHandlerRegistry: IPushErrorHandlerRegistry,
    remoteSourcePublisherRegistry: IRemoteSourcePublisherRegistry,
    private logger: LogOutputChannel
  ) {
    this._operations = new OperationManager(logger);

    const repositoryWatcher = new FileSystemWatcher(new RelativePattern(repository.root, '**'));
    this.disposables.push(repositoryWatcher);

    const onRepositoryFileChange = Event.any(repositoryWatcher.onDidChange, repositoryWatcher.onDidCreate, repositoryWatcher.onDidDelete);
    const onRepositoryWorkingTreeFileChange = Event.filter(onRepositoryFileChange, path => !/\.git($|\\|\/)/.test(relativePath(repository.root, path)));

    let onRepositoryDotGitFileChange: Event<string>;

    try {
      const dotGitFileWatcher = new DotGitWatcher(this, logger);
      onRepositoryDotGitFileChange = dotGitFileWatcher.event;
      this.disposables.push(dotGitFileWatcher);
    } catch (error: any) {
      logger.error(`Failed to watch path:'${this.dotGit.path}' or commonPath:'${this.dotGit.commonPath}', reverting to legacy API file watched. Some events might be lost.\n${error.stack || error}`);

      onRepositoryDotGitFileChange = Event.filter(onRepositoryFileChange, uri => /\.git($|\\|\/)/.test(uriToPath(uri)));
    }

    // FS changes should trigger `git status`:
    // 	- any change inside the repository working tree
    //	- any change whithin the first level of the `.git` folder, except the folder itself and `index.lock`
    const onFileChange = Event.any(onRepositoryWorkingTreeFileChange, onRepositoryDotGitFileChange);
    onFileChange(this.onFileChange, this, this.disposables);

    // Relevate repository changes should trigger virtual document change events
    onRepositoryDotGitFileChange(this._onDidChangeRepository.fire, this._onDidChangeRepository, this.disposables);

    this.disposables.push(new FileEventLogger(onRepositoryWorkingTreeFileChange, onRepositoryDotGitFileChange, logger));

    this._sourceControl = scm.createSourceControl('git', 'Git', this.repository.root, undefined);
    this.disposables.push(this._sourceControl);

    this.updateInputBoxPlaceholder();
    this.disposables.push(this.onDidRunGitStatus(() => this.updateInputBoxPlaceholder()));

    this._mergeGroup = this._sourceControl.createResourceGroup('merge', 'Merge Changes');
    this._indexGroup = this._sourceControl.createResourceGroup('index', 'Staged Changes');
    this._workingTreeGroup = this._sourceControl.createResourceGroup('workingTree', 'Changes');
    this._untrackedGroup = this._sourceControl.createResourceGroup('untracked', 'Untracked Changes');

    const updateIndexGroupVisibility = () => {
      const gitConfig = config.get('vcgit')!;
      this.indexGroup.hideWhenEmpty = !gitConfig.alwaysShowStagedChangesResourceGroup;
    }

    const onConfigListener = Event.filter(config.onDidChangeConfiguration, (e) => e.affectsConfiguration('vcgit.alwaysShowStagedChangesResourceGroup'));
    onConfigListener(updateIndexGroupVisibility, this, this.disposables);
    updateIndexGroupVisibility();

    Event.filter(config.onDidChangeConfiguration, (e) =>
      e.affectsConfiguration('vcgit.untrackedChanges') ||
      e.affectsConfiguration('vcgit.ignoreSubmodules') ||
      e.affectsConfiguration('vcgit.similarityThreshold')
    )(() => this.updateModelState(), this, this.disposables);

    const updateInputBoxVisibility = () => {
      const gitConfig = config.get('vcgit');
      this._sourceControl.inputBox.visible = gitConfig?.showCommitInput || true;
    };
    const onConfigListenerForInputBoxVisibility = Event.filter(config.onDidChangeConfiguration, e => e.affectsConfiguration('vcgit.showCommitInput'));
    onConfigListenerForInputBoxVisibility(updateInputBoxVisibility, this, this.disposables);
    updateInputBoxVisibility();

    this.mergeGroup.hideWhenEmpty = true;
    this.untrackedGroup.hideWhenEmpty = true;

    this.disposables.push(this._mergeGroup);
    this.disposables.push(this._indexGroup);
    this.disposables.push(this._workingTreeGroup);
    this.disposables.push(this._untrackedGroup);

    this.disposables.push(new AutoFetcher(this));

    const commandAction = new CommandActions(this, remoteSourcePublisherRegistry);
    this.disposables.push(commandAction);
    commandAction.onDidChange(() => {
      this._sourceControl.commandActions = commandAction.commands;
    }, undefined, this.disposables);
    this._sourceControl.commandActions = commandAction.commands;

    const actionButton = new ActionButton(this);
    actionButton.onDidChange(() => this._sourceControl.actionButton = actionButton.button, null, this.disposables);
    this._sourceControl.actionButton = actionButton.button;

    const progressManager = new ProgressManager(this);
    this.disposables.push(progressManager);
  }

  getConfigs(): Promise<{ key: string; value: string }[]> {
    return this.run(Operation.Config(true), () => this.repository.getConfigs('local'));
  }

  getConfig(key: string): Promise<string> {
    return this.run(Operation.Config(true), () => this.repository.config('get', 'local', key));
  }

  getGlobalConfig(key: string): Promise<string> {
    return this.run(Operation.Config(true), () => this.repository.config('get', 'global', key));
  }

  setConfig(key: string, value: string): Promise<string> {
    return this.run(Operation.Config(false), () => this.repository.config('add', 'local', key, value));
  }

  unsetConfig(key: string): Promise<string> {
    return this.run(Operation.Config(false), () => this.repository.config('unset', 'local', key));
  }

  log(options?: LogOptions & { silent?: boolean }): Promise<Commit[]> {
    const showProgress = !options || options.silent !== true;
    return this.run(Operation.Log(showProgress), () => this.repository.log(options));
  }

  @throttle
  async status(): Promise<void> {
    await this.run(Operation.Status);
  }

  @throttle
  async refresh(): Promise<void> {
    await this.run(Operation.Refresh);
  }

  diffWithHEAD(): Promise<Change[]>;
  diffWithHEAD(path: string): Promise<string>;
  diffWithHEAD(path?: string | undefined): Promise<string | Change[]>;
  diffWithHEAD(path?: string | undefined): Promise<string | Change[]> {
    return this.run(Operation.Diff, () => this.repository.diffWithHEAD(path));
  }

  diffIndexWithHEAD(): Promise<Change[]>;
  diffIndexWithHEAD(path: string): Promise<string>;
  diffIndexWithHEAD(path?: string | undefined): Promise<string | Change[]>;
  diffIndexWithHEAD(path?: string): Promise<string | Change[]> {
    return this.run(Operation.Diff, () => this.repository.diffIndexWithHEAD(path));
  }

  async add(resources: string[], opts?: { update?: boolean }): Promise<void> {
    await this.run(
      Operation.Add(true),
      async () => {
        await this.repository.add(resources, opts);
      }
    );
  }

  async branch(name: string, _checkout: boolean, _ref?: string): Promise<void> {
    await this.run(Operation.Branch, () => this.repository.branch(name, _checkout, _ref));
  }

  async deleteBranch(name: string, force?: boolean): Promise<void> {
    return this.run(Operation.DeleteBranch, async () => {
      await this.repository.deleteBranch(name, force);
      await this.repository.config('unset', 'local', `branch.${name}.vscode-merge-base`);
    });
  }

  async renameBranch(name: string): Promise<void> {
    await this.run(Operation.RenameBranch, () => this.repository.renameBranch(name));
  }

  @throttle
  async fastForwardBranch(name: string): Promise<void> {
    // Get branch details
    const branch = await this.getBranch(name);
    if (!branch.upstream?.remote || !branch.upstream?.name || !branch.name) {
      return;
    }

    try {
      // Fast-forward the branch if possible
      const options = { remote: branch.upstream.remote, ref: `${branch.upstream.name}:${branch.name}` };
      await this.run(Operation.Fetch(true), async () => this.repository.fetch(options));
    } catch (err: any) {
      if (err.gitErrorCode === GitErrorCodes.BranchFastForwardRejected) {
        return;
      }

      throw err;
    }
  }

  async getBranch(name: string): Promise<Branch> {
    return await this.run(Operation.GetBranch, () => this.repository.getBranch(name));
  }

  async getBranches(query: BranchQuery = {}): Promise<Ref[]> {
    return await this.run(Operation.GetBranches, async () => {
      const refs = await this.getRefs(query);
      return refs.filter(value => value.type === RefType.Head || (value.type === RefType.RemoteHead && query.remote));
    });
  }

  async getRefs(query: RefQuery = {}): Promise<(Ref | Branch)[]> {
    const gitConfig = config.get('vcgit')!;
    let defaultSort = gitConfig.branchSortOrder;
    if (defaultSort !== 'alphabetically' && defaultSort !== 'committerdate') {
      defaultSort = 'alphabetically';
    }

    query = { ...query, sort: query?.sort ?? defaultSort };
    return await this.run(Operation.GetRefs, () => this.repository.getRefs(query));
  }

  async getRemoteRefs(remote: string, opts?: { heads?: boolean; tags?: boolean }): Promise<Ref[]> {
    return await this.run(Operation.GetRemoteRefs, () => this.repository.getRemoteRefs(remote, opts));
  }

  async setBranchUpstream(name: string, upstream: string): Promise<void> {
    await this.run(Operation.SetBranchUpstream, () => this.repository.setBranchUpstream(name, upstream));
  }

  async deleteRemoteRef(remoteName: string, refName: string, options?: { force?: boolean }): Promise<void> {
    await this.run(Operation.DeleteRemoteRef, () => this.repository.deleteRemoteRef(remoteName, refName, options));
  }

  async merge(ref: string): Promise<void> {
    await this.run(Operation.Merge, () => this.repository.merge(ref));
  }

  async mergeAbort(): Promise<void> {
    await this.run(Operation.MergeAbort, async () => await this.repository.mergeAbort());
  }

  async rebase(branch: string): Promise<void> {
    await this.run(Operation.Rebase, () => this.repository.rebase(branch));
  }

  async tag(options: { name: string; message?: string; ref?: string }): Promise<void> {
    await this.run(Operation.Tag, () => this.repository.tag(options));
  }

  async deleteTag(name: string): Promise<void> {
    await this.run(Operation.DeleteTag, () => this.repository.deleteTag(name));
  }

  async checkout(treeish: string, opts?: { detached?: boolean; pullBeforeCheckout?: boolean }): Promise<void> {
    const refLabel = opts?.detached ? getCommitShortHash(treeish) : treeish;

    await this.run(Operation.Checkout(refLabel),
      async () => {
        if (opts?.pullBeforeCheckout && !opts?.detached) {
          try {
            await this.fastForwardBranch(treeish);
          }
          catch (err) {
            // noop
          }
        }

        await this.repository.checkout(treeish, [], opts);
      });
  }

  async checkoutTracking(treeish: string, opts: { detached?: boolean } = {}): Promise<void> {
    const refLabel = opts.detached ? getCommitShortHash(treeish) : treeish;
    await this.run(Operation.CheckoutTracking(refLabel), () => this.repository.checkout(treeish, [], { ...opts, track: true }));
  }

  async findTrackingBranches(upstreamRef: string): Promise<Branch[]> {
    return await this.run(Operation.FindTrackingBranches, () => this.repository.findTrackingBranches(upstreamRef));
  }

  async getCommit(ref: string): Promise<Commit> {
    return await this.repository.getCommit(ref);
  }

  async getEmptyTree(): Promise<string> {
    if (!this._EMPTY_TREE) {
      const result = await this.repository.exec(['hash-object', '-t', 'tree'], { shellAppend: '/dev/null' });
      this._EMPTY_TREE = result.stdout.trim();
    }

    return this._EMPTY_TREE;
  }

  async reset(treeish: string, hard?: boolean): Promise<void> {
    await this.run(Operation.Reset, () => this.repository.reset(treeish, hard));
  }

  async deleteRef(ref: string): Promise<void> {
    await this.run(Operation.DeleteRef, () => this.repository.deleteRef(ref));
  }

  async addRemote(name: string, url: string): Promise<void> {
    await this.run(Operation.Remote, () => this.repository.addRemote(name, url));
  }

  async removeRemote(name: string): Promise<void> {
    await this.run(Operation.Remote, () => this.repository.removeRemote(name));
  }

  async renameRemote(name: string, newName: string): Promise<void> {
    await this.run(Operation.Remote, () => this.repository.renameRemote(name, newName));
  }

  @throttle
  async fetchDefault(options: { silent?: boolean } = {}): Promise<void> {
    await this._fetch({ silent: options.silent });
  }

  @throttle
  async fetchPrune(): Promise<void> {
    await this._fetch({ prune: true });
  }

  @throttle
  async fetchAll(options: { silent?: boolean } = {}): Promise<void> {
    await this._fetch({ all: true, silent: options.silent });
  }

  async fetch(options: FetchOptions): Promise<void> {
    await this._fetch(options);
  }

  private async _fetch(options: { remote?: string; ref?: string; all?: boolean; prune?: boolean; depth?: number; silent?: boolean; } = {}): Promise<void> {
    if (!options.prune) {
      const gitConfig = config.get('vcgit')!;
      const prune = gitConfig.pruneOnFetch;
      options.prune = prune;
    }

    await this.run(Operation.Fetch(options.silent !== true), async () => this.repository.fetch(options));
  }

  @throttle
  async pullWithRebase(head: Branch | undefined): Promise<void> {
    let remote: string | undefined;
    let branch: string | undefined;

    if (head && head.name && head.upstream) {
      remote = head.upstream.remote;
      branch = `${head.upstream.name}`;
    }

    return this.pullFrom(true, remote, branch);
  }

  @throttle
  async pull(head?: Branch, unshallow?: boolean): Promise<void> {
    let remote: string | undefined;
    let branch: string | undefined;

    if (head && head.name && head.upstream) {
      remote = head.upstream.remote;
      branch = `${head.upstream.name}`;
    }

    return this.pullFrom(false, remote, branch, unshallow);
  }

  async pullFrom(rebase?: boolean, remote?: string, branch?: string, unshallow?: boolean): Promise<void> {
    await this.run(Operation.Pull, async () => {
      const gitConfig = config.get('vcgit')!;
      const autoStash = gitConfig.autoStash;
      const fetchOnPull = gitConfig.fetchOnPull;
      const tags = gitConfig.pullTags;

      // When fetchOnPull is enabled, fetch all branches when pulling
      if (fetchOnPull) {
        await this.fetchAll();
      }

      if (await this.checkIfMaybeRebased(this.HEAD?.name)) {
        await this._pullAndHandleTagConflict(rebase, remote, branch, { unshallow, tags, autoStash });
      }
    });
  }

  private async _pullAndHandleTagConflict(rebase?: boolean, remote?: string, branch?: string, options: PullOptions = {}): Promise<void> {
    try {
      await this.repository.pull(rebase, remote, branch, options);
    } catch (err: any) {
      if (err.gitErrorCode !== GitErrorCodes.TagConflict) {
        throw err;
      }

      // Handle tag(s) conflict
      if (await this.handleTagConflict(remote, err.stderr)) {
        await this.repository.pull(rebase, remote, branch, options);
      }
    }
  }

  @throttle
  async push(head: Branch, forcePushMode?: ForcePushMode): Promise<void> {
    let remote: string | undefined;
    let branch: string | undefined;

    if (head && head.name && head.upstream) {
      remote = head.upstream.remote;
      branch = `${head.name}:${head.upstream.name}`;
    }

    await this.run(Operation.Push, () => this._push(remote, branch, undefined, undefined, forcePushMode));
  }

  async pushTo(remote?: string, name?: string, setUpstream = false, forcePushMode?: ForcePushMode): Promise<void> {
    await this.run(Operation.Push, () => this._push(remote, name, setUpstream, undefined, forcePushMode));
  }

  async pushFollowTags(remote?: string, forcePushMode?: ForcePushMode): Promise<void> {
    await this.run(Operation.Push, () => this._push(remote, undefined, false, true, forcePushMode));
  }

  async pushTags(remote?: string, forcePushMode?: ForcePushMode): Promise<void> {
    await this.run(Operation.Push, () => this._push(remote, undefined, false, false, forcePushMode, true));
  }

  @throttle
  sync(head: Branch, rebase: boolean): Promise<void> {
    return this._sync(head, rebase);
  }

  private async _sync(head: Branch, rebase: boolean): Promise<void> {
    let remoteName: string | undefined;
    let pullBranch: string | undefined;
    let pushBranch: string | undefined;

    if (head.name && head.upstream) {
      remoteName = head.upstream.remote;
      pullBranch = `${head.upstream.name}`;
      pushBranch = `${head.name}:${head.upstream.name}`;
    }

    await this.run(Operation.Sync, async () => {
      await this.maybeAutoStash(async () => {
        const gitConfig = config.get('vcgit')!;
        const autoStash = gitConfig.autoStash;
        const fetchOnPull = gitConfig.fetchOnPull;
        const tags = gitConfig.pullTags;
        const followTags = gitConfig.followTagsWhenSync;

        // When fetchOnPull is enabled, fetch all branches when pulling
        if (fetchOnPull) {
          await this.fetchAll();
        }

        if (await this.checkIfMaybeRebased(this.HEAD?.name)) {
          await this._pullAndHandleTagConflict(rebase, remoteName, pullBranch, { tags, autoStash });
        }

        const remote = this.remotes.find(r => r.name === remoteName);

        if (remote && remote.isReadOnly) {
          return;
        }

        const shouldPush = this.HEAD && (typeof this.HEAD.ahead === 'number' ? this.HEAD.ahead > 0 : true);

        if (shouldPush) {
          await this._push(remoteName, pushBranch, false, followTags);
        }
      });
    });
  }

  private async checkIfMaybeRebased(currentBranch?: string) {
    const gitConfig = config.get('vcgit')!;
    const shouldIgnore = gitConfig.ignoreRebaseWarning;

    if (shouldIgnore) {
      return true;
    }

    const maybeRebased = await this.run(Operation.Log(true), async () => {
      try {
        const result = await this.repository.exec(['log', '--oneline', '--cherry', `${currentBranch ?? ''}...${currentBranch ?? ''}@{upstream}`, '--']);
        if (result.exitCode) {
          return false;
        }

        return /^=/.test(result.stdout);
      } catch {
        return false;
      }
    });

    if (!maybeRebased) {
      return true;
    }

    return await confirm(
      'WARNING',
      currentBranch
        ? `It looks like the current branch "${currentBranch}" might have been rebased. Are you sure you still want to pull into it?`
        : 'It looks like the current branch might have been rebased. Are you sure you still want to pull into it?'
    );
  }

  async buffer(ref: string, filePath: string): Promise<string> {
    return this.run(Operation.Show, () => this.repository.buffer(ref, filePath));
  }

  getObjectDetails(ref: string, path: string): Promise<{ mode: string; object: string; size: number }> {
    return this.run(Operation.GetObjectDetails, () => this.repository.getObjectDetails(ref, path));
  }

  async apply(patch: string, reverse?: boolean): Promise<void> {
    return await this.run(Operation.Apply, () => this.repository.apply(patch, reverse));
  }

  async rm(resources: string[]): Promise<void> {
    await this.run(Operation.Remove, () => this.repository.rm(resources.map(r => r)));
  }

  async revert(resources: string[]): Promise<void> {
    await this.run(Operation.RevertFiles(true), async () => {
      await this.repository.revert('HEAD', resources);
    });
  }

  async commit(message: string | null | undefined, opts: CommitOptions = Object.create(null)): Promise<void> {
    if (this.rebaseCommit) {
      await this.run(
        Operation.RebaseContinue,
        async () => {
          if (opts.all) {
            const addOpts = opts.all === 'tracked' ? { update: true } : {};
            await this.repository.add([], addOpts);
          }

          await this.repository.rebaseContinue();
          this.commitOperationCleanup(message);
        },
      );
    } else {
      await this.run(
        Operation.Commit,
        async () => {
          if (opts.all) {
            const addOpts = opts.all === 'tracked' ? { update: true } : {};
            await this.repository.add([], addOpts);
          }

          delete opts.all;

          if (opts.requireUserConfig === undefined || opts.requireUserConfig === null) {
            const gitConfig = config.get('vcgit');
            opts.requireUserConfig = gitConfig?.requireGitUserConfig;
          }

          await this.repository.commit(message, opts);
          this.commitOperationCleanup(message);
        },
      );
    }
  }

  private commitOperationCleanup(message: string | null | undefined): void {
    if (message) {
      this.inputBox.value = '';
    }
  }

  async clean(resources: string[]): Promise<void> {
    await this.run(
      Operation.Clean(true),
      async () => {
        const toClean: string[] = [];
        const toCheckout: string[] = [];
        const submodulesToUpdate: string[] = [];
        const resourceStates = [...this.workingTreeGroup.resourceStates, ...this.untrackedGroup.resourceStates];

        resources.forEach(path => {
          for (const submodule of this.submodules) {
            if (Url.join(this.root, submodule.path) === path) {
              submodulesToUpdate.push(path);
              return;
            }
          }

          const scmResource = find(resourceStates, sr => sr.resourceUri === path);

          if (!scmResource) {
            return;
          }

          switch (scmResource.type) {
            case Status.UNTRACKED:
            case Status.IGNORED:
              toClean.push(path);
              break;

            default:
              toCheckout.push(path);
              break;
          }
        });

        if (toClean.length > 0) {
          await this.repository.clean(toClean);
        }

        if (toCheckout.length > 0) {
          try {
            await this.repository.checkout('', toCheckout);
          } catch (err: any) {
            if (err.gitErrorCode !== GitErrorCodes.BranchNotYetBorn) {
              throw err;
            }
          }
        }

        if (submodulesToUpdate.length > 0) {
          await this.repository.updateSubmodules(submodulesToUpdate);
        }
      }
    );
  }

  checkIgnore(filepaths: string[]): Promise<Set<string>> {
    return this.run(Operation.CheckIgnore, () => {
      return new Promise<Set<string>>((resolve, reject) => {
        filepaths = filepaths
          .filter(filePath => isDescendant(this.root, filePath));

        if (filepaths.length === 0) {
          return resolve(new Set<string>());
        }

        // https://git-scm.com/docs/git-check-ignore
        const process = this.repository.stream(['check-ignore', '-v', ...filepaths.map(path => toShortPath(path))]);

        const onClose = (exitCode: number) => {
          if (exitCode === 1) {
            resolve(new Set<string>());
          } else if (exitCode === 0) {
            resolve(new Set<string>(this.parseIgnoreCheck(data)));
          } else {
            if (/ is in submodule /.test(stderr)) {
              reject(new GitError({ stdout: data, stderr, exitCode, gitErrorCode: GitErrorCodes.IsInSubmodule }));
            } else {
              reject(new GitError({ stdout: data, stderr, exitCode }));
            }
          }
        };

        let data = '';
        const onStdoutData = (raw: string) => {
          data += raw + '\0';
        };

        process.stdout!.on('data', onStdoutData);

        let stderr: string = '';
        process.stderr!.on('data', raw => stderr += raw);

        process.on('error', reject);
        process.on('close', onClose);
      });
    });
  }

  private parseIgnoreCheck(raw: string): string[] {
    const ignored = [];
    const elements = raw.split('\0').flatMap(r => r.split('\t'));
    for (let i = 0; i < elements.length; i += 2) {
      const pattern = elements[i];
      const path = elements[i + 1];
      if (pattern && !pattern.startsWith('!')) {
        ignored.push(path);
      }
    }
    return ignored.map(path => toFullPath(path));
  }

  private async _push(remote?: string, refspec?: string, setUpstream = false, followTags = false, forcePushMode?: ForcePushMode, tags = false): Promise<void> {
    try {
      await this.repository.push(remote, refspec, setUpstream, followTags, forcePushMode, tags);
    } catch (err: any) {
      if (!remote || !refspec) {
        throw err;
      }

      const repository = new ApiRepository(this);
      const remoteObj = repository.state.remotes.find(r => r.name === remote);

      if (!remoteObj) {
        throw err;
      }

      for (const handler of this.pushErrorHandlerRegistry.getPushErrorHandlers()) {
        if (await handler.handlePushError(repository, remoteObj, refspec, err)) {
          return;
        }
      }

      throw err;
    }
  }

  private async run<T>(
    operation: Operation,
    runOperation: () => Promise<T> = () => Promise.resolve<any>(null)
  ): Promise<T> {

    if (this.state !== RepositoryState.Idle) {
      throw new Error('Repository not initialized');
    }

    let error: any = null;

    this._operations.start(operation);
    this._onRunOperation.fire(operation.kind);

    try {
      const result = await this.retryRun(operation, runOperation);
      if (!operation.readOnly) {
        await this.updateModelState();
      }
      return result;
    } catch (err: any) {
      error = err;

      if (err.gitErrorCode === GitErrorCodes.NotAGitRepository) {
        this.state = RepositoryState.Disposed;
      }

      if (!operation.readOnly) {
        await this.updateModelState();
      }

      throw err;
    } finally {
      this._operations.end(operation);
      this._onDidRunOperation.fire({ error, operation });
    }
  }

  private async retryRun<T>(operation: Operation, runOperation: () => Promise<T> = () => Promise.resolve<any>(null)): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        attempt++;
        return await runOperation();
      } catch (err: any) {
        const shouldRetry = attempt <= 10 && (
          (err.gitErrorCode === GitErrorCodes.RepositoryIsLocked)
          || (operation.retry && (err.gitErrorCode === GitErrorCodes.CantLockRef || err.gitErrorCode === GitErrorCodes.CantRebaseMultipleBranches))
        );

        if (shouldRetry) {
          // quatratic backoff
          await timeout(Math.pow(attempt, 2) * 50);
        } else {
          throw err;
        }
      }
    }
  }

  private static KnownHugeFolderNames = ['node_modules'];

  private async findKnownHugeFolderPathsToIgnore(): Promise<string[]> {
    const folderPaths: string[] = [];

    for (const folderName of Repository.KnownHugeFolderNames) {
      const folderPath = Url.join(this.repository.root, folderName);

      if (await fs(`file://${folderPath}`).exists()) {
        folderPaths.push(folderPath);
      }
    }

    const ignored = await this.checkIgnore(folderPaths);
    console.log('[Repository][findKnownHugeFolderPathsToIgnore] ignored=', [...ignored]);

    return folderPaths.filter(p => !ignored.has(p));
  }

  private async updateModelState(): Promise<void> {
    const [HEAD, remotes, submodules, rebaseCommit, mergeInProgress] = await Promise.all([
      this.repository.getHEADRef(),
      this.repository.getRemotes(),
      this.repository.getSubmodules(),
      this.getRebaseCommit(),
      this.isMergeInProgress()
    ]);

    this._HEAD = HEAD;
    this._remotes = remotes;
    this._submodules = submodules;
    this.rebaseCommit = rebaseCommit;
    this.mergeInProgress = mergeInProgress;

    const resourceGroups = await this.getStatus();

    if (resourceGroups.indexGroup) {
      this.indexGroup.resourceStates = resourceGroups.indexGroup;
    }
    if (resourceGroups.mergeGroup) {
      this.mergeGroup.resourceStates = resourceGroups.mergeGroup;
    }
    if (resourceGroups.workingTreeGroup) {
      this.workingTreeGroup.resourceStates = resourceGroups.workingTreeGroup;
    }
    if (resourceGroups.untrackedGroup) {
      this.untrackedGroup.resourceStates = resourceGroups.untrackedGroup;
    }

    this._onDidChangeStatus.fire();
  }

  private async getStatus(): Promise<GitResourceGroups> {
    const gitConfig = config.get('vcgit')!;
    const untrackedChanges = gitConfig.untrackedChanges;
    const ignoreSubmodules = gitConfig.ignoreSubmodules;
    const limit = gitConfig.statusLimit;
    const similarityThreshold = gitConfig.similarityThreshold;

    const start = new Date().getTime();
    const { status, statusLength, didHitLimit } = await this.repository.getStatus({ limit, ignoreSubmodules, similarityThreshold });
    const totalTime = new Date().getTime() - start;

    this.isRepositoryHuge = didHitLimit ? { limit } : false;

    if (totalTime > 5000) {
      this.logger.warn(`git status very slow: [${totalTime}ms]`)
    }

    const shouldIgnore = config.get('vcgit')!.ignoreLimitWarning;
    if (didHitLimit && !shouldIgnore && !this.didWarnAboutLimit) {
      const knownHugeFolderPaths = await this.findKnownHugeFolderPathsToIgnore();
      console.log('[Repository][getStatus] knownHugeFolderPaths=', knownHugeFolderPaths);
      const gitWarn = `The git repository at "${this.repository.root}" has too many active changes, only a subset of Git features will be enabled.`;

      if (knownHugeFolderPaths.length > 0) {
        const folderPath = knownHugeFolderPaths[0];
        const folderName = Url.basename(folderPath);

        acode.pushNotification('WARNING', gitWarn, {
          type: 'warning',
          action: async () => {
            const confirmation = await confirm('', ` Would you like to add "${folderName}" to .gitignore?`);
            if (confirmation) {
              //TODO: Add to .gitignore
            } else {
              this.didWarnAboutLimit = true;
            }
          }
        });
      } else {
        acode.pushNotification('WARNING', gitWarn, { type: 'warning' });
        this.didWarnAboutLimit = true;
      }
    }

    const indexGroup: Resource[] = [],
      mergeGroup: Resource[] = [],
      untrackedGroup: Resource[] = [],
      workingTreeGroup: Resource[] = [];

    status.forEach(raw => {
      const uri = Url.join(this.repository.root, raw.path);
      const renameUri = raw.rename
        ? Url.join(this.repository.root, raw.rename)
        : undefined;

      switch (raw.x + raw.y) {
        case '??': switch (untrackedChanges) {
          case 'mixed': return workingTreeGroup.push(new Resource(ResourceGroupType.WorkingTree, uri, Status.UNTRACKED, undefined));
          case 'separate': return untrackedGroup.push(new Resource(ResourceGroupType.Untracked, uri, Status.UNTRACKED));
          default: return undefined;
        }
        case '!!': switch (untrackedChanges) {
          case 'mixed': return workingTreeGroup.push(new Resource(ResourceGroupType.WorkingTree, uri, Status.IGNORED, undefined));
          case 'separate': return untrackedGroup.push(new Resource(ResourceGroupType.Untracked, uri, Status.IGNORED));
          default: return undefined;
        }
        case 'DD': return mergeGroup.push(new Resource(ResourceGroupType.Merge, uri, Status.BOTH_DELETED));
        case 'AU': return mergeGroup.push(new Resource(ResourceGroupType.Merge, uri, Status.ADDED_BY_US));
        case 'UD': return mergeGroup.push(new Resource(ResourceGroupType.Merge, uri, Status.DELETED_BY_THEM));
        case 'UA': return mergeGroup.push(new Resource(ResourceGroupType.Merge, uri, Status.ADDED_BY_THEM));
        case 'DU': return mergeGroup.push(new Resource(ResourceGroupType.Merge, uri, Status.DELETED_BY_US));
        case 'AA': return mergeGroup.push(new Resource(ResourceGroupType.Merge, uri, Status.BOTH_ADDED));
        case 'UU': return mergeGroup.push(new Resource(ResourceGroupType.Merge, uri, Status.BOTH_MODIFIED));
      }

      switch (raw.x) {
        case 'M': indexGroup.push(new Resource(ResourceGroupType.Index, uri, Status.INDEX_MODIFIED, undefined)); break;
        case 'A': indexGroup.push(new Resource(ResourceGroupType.Index, uri, Status.INDEX_ADDED, undefined)); break;
        case 'D': indexGroup.push(new Resource(ResourceGroupType.Index, uri, Status.INDEX_DELETED, undefined)); break;
        case 'R': indexGroup.push(new Resource(ResourceGroupType.Index, uri, Status.INDEX_RENAMED, renameUri)); break;
        case 'C': indexGroup.push(new Resource(ResourceGroupType.Index, uri, Status.INDEX_COPIED, renameUri)); break;
      }

      switch (raw.y) {
        case 'M': workingTreeGroup.push(new Resource(ResourceGroupType.WorkingTree, uri, Status.MODIFIED, renameUri)); break;
        case 'D': workingTreeGroup.push(new Resource(ResourceGroupType.WorkingTree, uri, Status.DELETED, renameUri)); break;
        case 'A': workingTreeGroup.push(new Resource(ResourceGroupType.WorkingTree, uri, Status.INTENT_TO_ADD, renameUri)); break;
        case 'R': workingTreeGroup.push(new Resource(ResourceGroupType.WorkingTree, uri, Status.INTENT_TO_RENAME, renameUri)); break;
        case 'T': workingTreeGroup.push(new Resource(ResourceGroupType.WorkingTree, uri, Status.TYPE_CHANGED, renameUri)); break;
      }

      return undefined;
    });

    return { indexGroup, mergeGroup, untrackedGroup, workingTreeGroup };
  }

  private async getRebaseCommit(): Promise<Commit | undefined> {
    const rebaseHeadPath = Url.join(this.repository.root, '.git', 'REBASE_HEAD');
    const rebaseApplyPath = Url.join(this.repository.root, '.git', 'rebase-apply');
    const rebaseMergePath = Url.join(this.repository.root, '.git', 'rebase-merge');

    try {
      const [rebaseApplyExists, rebaseMergePathExists, rebaseHead] = await Promise.all([
        fs(`file://${rebaseApplyPath}`).exists(),
        fs(`file://${rebaseMergePath}`).exists(),
        fs(`file://${rebaseHeadPath}`).readFile('utf-8')
      ]);
      if (!rebaseApplyExists && !rebaseMergePathExists) {
        return undefined;
      }
      return await this.getCommit(rebaseHead.trim());
    } catch (err) {
      return undefined;
    }
  }

  private async isMergeInProgress(): Promise<boolean> {
    const mergeHeadPath = Url.join(this.repository.root, '.git', 'MERGE_HEAD');
    return await fs(`file://${mergeHeadPath}`)?.exists() ?? false;
  }

  private async maybeAutoStash<T>(runOperation: () => Promise<T>): Promise<T> {
    const gitConfig = config.get('vcgit')!;
    const shouldAutoStash = gitConfig.autoStash
      && this.repository.git.compareGitVersionTo('2.27.0') < 0
      && (this.indexGroup.resourceStates.length > 0
        || this.workingTreeGroup.resourceStates.some(
          r => r.type !== Status.UNTRACKED && r.type !== Status.IGNORED));

    if (!shouldAutoStash) {
      return await runOperation();
    }

    await this.repository.createStash(undefined, true);
    try {
      const result = await runOperation();
      return result;
    } finally {
      await this.repository.popStash();
    }
  }

  private onFileChange(uri: string): void {
    const gitConfig = config.get('vcgit');
    const autoRefresh = gitConfig?.autorefresh;

    if (!autoRefresh) {
      this.logger.warn('[Repository][onFileChange] Skip running git status because autorefresh setting is disabled.');
      return;
    }

    if (this.isRepositoryHuge) {
      this.logger.warn('[Repository][onFileChange] Skip running git status because repository is huge.');
      return;
    }

    if (!this.operations.isIdle()) {
      this.logger.warn('[Repository][onFileChange] Skip running git status because an operation is running.');
      return;
    }

    this.eventuallyUpdateWhenIdleAndWait();
  }

  @debounce(1000)
  private eventuallyUpdateWhenIdleAndWait(): void {
    this.updateWhenIdleAndWait();
  }

  @throttle
  private async updateWhenIdleAndWait(): Promise<void> {
    await this.whenIdle();
    await this.status();
    await timeout(5000);
  }

  async whenIdle(): Promise<void> {
    while (true) {
      if (!this.operations.isIdle()) {
        await Event.toPromise(this.onDidRunOperation);
        continue;
      }

      return;
    }
  }

  get headLabel(): string {
    const HEAD = this.HEAD;

    if (!HEAD) {
      return '';
    }

    const head = HEAD.name || (HEAD.commit || '').substr(0, 8);

    return head
      + (this.workingTreeGroup.resourceStates.length + this.untrackedGroup.resourceStates.length > 0 ? '*' : '')
      + (this.indexGroup.resourceStates.length > 0 ? '+' : '')
      + (this.mergeInProgress || !!this.rebaseCommit ? '!' : '');
  }

  get syncLabel(): string {
    if (!this.HEAD
      || !this.HEAD.name
      || !this.HEAD.commit
      || !this.HEAD.upstream
      || !(this.HEAD.ahead || this.HEAD.behind)
    ) {
      return '';
    }

    const remoteName = this.HEAD && this.HEAD.remote || this.HEAD.upstream.remote;
    const remote = this.remotes.find(r => r.name === remoteName);

    if (remote && remote.isReadOnly) {
      return `${this.HEAD.behind}↓`;
    }

    return `${this.HEAD.behind}↓ ${this.HEAD.ahead}↑`;
  }

  private updateInputBoxPlaceholder(): void {
    const branchName = this.headShortName;

    if (branchName) {
      this._sourceControl.inputBox.placeholder = `Message to commit on ${branchName}`;
    } else {
      this._sourceControl.inputBox.placeholder = 'Message to commit';
    }
  }

  private async handleTagConflict(remote: string | undefined, raw: string): Promise<boolean> {
    // Ensure there is a remote
    remote = remote ?? this.HEAD?.upstream?.remote;
    if (!remote) {
      throw new Error('Unable to resolve tag conflict due to missing remote.');
    }

    // Extract tag names from message
    const tags: string[] = [];
    for (const match of raw.matchAll(/^ ! \[rejected\]\s+([^\s]+)\s+->\s+([^\s]+)\s+\(would clobber existing tag\)$/gm)) {
      if (match.length === 3) {
        tags.push(match[1]);
      }
    }
    if (tags.length === 0) {
      throw new Error(`Unable to extract tag names from error message: ${raw}`);
    }

    const gitConfig = config.get('vcgit')!;
    const replaceTagsWhenPull = gitConfig.replaceTagsWhenPull;

    if (!replaceTagsWhenPull) {
      const message = `Unable to pull from remote repository due to conflicting tag(s): ${tags.join(', ')}. Would you like to resolve the conflict by replacing the local tag(s)?`;;
      const confirmation = await confirm('ERROR', message);

      if (!confirmation) {
        return false;
      }
    }

    // Force fetch tags
    await this.repository.fetchTags({ remote, tags, force: true });
    return true;
  }

  dispose(): void {
    this.disposables = Disposable.dispose(this.disposables);
  }
}
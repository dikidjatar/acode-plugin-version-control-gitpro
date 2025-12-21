import { IDisposable } from "../../base/disposable";
import { Event } from "../../base/event";
import { SourceControl, SourceControlInputBox } from "../../scm/api/sourceControl";
import { Model } from "../model";
import { OperationKind, OperationResult } from "../operation";
import { Repository as BaseRepository, Resource } from "../repository";
import { API, APIState, Branch, BranchQuery, Change, Commit, CommitOptions, CredentialsProvider, FetchOptions, ForcePushMode, Git, GitErrorCodes, InitOptions, InputBox, LogOptions, PublishEvent, PushErrorHandler, Ref, RefQuery, Remote, RemoteSourcePublisher, Repository, RepositoryState, RepositoryUIState, Status, Submodule } from "./git";

class ApiInputBox implements InputBox {
  #inputBox: SourceControlInputBox;

  constructor(inputBox: SourceControlInputBox) { this.#inputBox = inputBox; }

  set value(value: string) { this.#inputBox.value = value; }
  get value(): string { return this.#inputBox.value; }
}

export class ApiChange implements Change {
  #resource: Resource;
  constructor(resource: Resource) { this.#resource = resource; }

  get uri(): string { return this.#resource.resourceUri; }
  get originalUri(): string { return '' }
  get renameUri(): string | undefined { return this.#resource.renameResourceUri; }
  get status(): Status { return this.#resource.type; }
}

export class ApiRepositoryState implements RepositoryState {
  #repository: BaseRepository;
  readonly onDidChange: Event<void>;

  constructor(repository: BaseRepository) {
    this.#repository = repository;
    this.onDidChange = this.#repository.onDidRunGitStatus;
  }

  get HEAD(): Branch | undefined { return this.#repository.HEAD; }
  get remotes(): Remote[] { return [...this.#repository.remotes]; }
  get submodules(): Submodule[] { return []; }
  get rebaseCommit(): Commit | undefined { return this.#repository.rebaseCommit; }
  get mergeChanges(): Change[] { return this.#repository.mergeGroup.resourceStates.map(r => new ApiChange(r)); }
  get indexChanges(): Change[] { return this.#repository.indexGroup.resourceStates.map(r => new ApiChange(r)); }
  get workingTreeChanges(): Change[] { return this.#repository.workingTreeGroup.resourceStates.map(r => new ApiChange(r)); }
  get untrackedChanges(): Change[] { return this.#repository.untrackedGroup.resourceStates.map(r => new ApiChange(r)); }
}

export class ApiRepositoryUIState implements RepositoryUIState {
  #sourceControl: SourceControl;
  readonly onDidChange: Event<void>;

  constructor(sourceControl: SourceControl) {
    this.#sourceControl = sourceControl;
    this.onDidChange = Event.map<boolean, void>(this.#sourceControl.onDidChangeSelection, () => null);
    this.onDidChange = Event.None;
  }

  get selected(): boolean { return this.#sourceControl.selected; }
}

export class ApiRepository implements Repository {

  #repository: BaseRepository;

  readonly rootUri: string;
  readonly inputBox: InputBox;
  readonly state: RepositoryState;
  readonly ui: RepositoryUIState;

  readonly onDidCommit: Event<void>;
  readonly onDidCheckout: Event<void>;

  constructor(repository: BaseRepository) {
    this.#repository = repository;

    this.rootUri = this.#repository.root;
    this.inputBox = new ApiInputBox(this.#repository.inputBox);
    this.state = new ApiRepositoryState(this.#repository);
    this.ui = new ApiRepositoryUIState(this.#repository.sourceControl);

    this.onDidCommit = Event.map<OperationResult, void>(Event.filter(this.#repository.onDidRunOperation, e => e.operation.kind === OperationKind.Commit), () => null);
    this.onDidCheckout = Event.map<OperationResult, void>(Event.filter(this.#repository.onDidRunOperation, e => e.operation.kind === OperationKind.Checkout || e.operation.kind === OperationKind.CheckoutTracking), () => null);
  }

  apply(patch: string, reverse?: boolean): Promise<void> {
    return this.#repository.apply(patch, reverse);
  }

  getConfigs(): Promise<{ key: string; value: string; }[]> {
    return this.#repository.getConfigs();
  }

  getConfig(key: string): Promise<string> {
    return this.#repository.getConfig(key);
  }

  setConfig(key: string, value: string): Promise<string> {
    return this.#repository.setConfig(key, value);
  }

  unsetConfig(key: string): Promise<string> {
    return this.#repository.unsetConfig(key);
  }

  getGlobalConfig(key: string): Promise<string> {
    return this.#repository.getGlobalConfig(key);
  }

  getCommit(ref: string): Promise<Commit> {
    return this.#repository.getCommit(ref);
  }

  add(paths: string[]): Promise<void> {
    return this.#repository.add(paths);
  }

  revert(paths: string[]): Promise<void> {
    return this.#repository.revert(paths);
  }

  clean(paths: string[]): Promise<void> {
    return this.#repository.clean(paths);
  }

  createBranch(name: string, checkout: boolean, ref?: string): Promise<void> {
    return this.#repository.branch(name, checkout, ref);
  }

  deleteBranch(name: string, force?: boolean): Promise<void> {
    return this.#repository.deleteBranch(name, force);
  }

  getBranch(name: string): Promise<Branch> {
    return this.#repository.getBranch(name);
  }

  getBranches(query: BranchQuery): Promise<Ref[]> {
    return this.#repository.getBranches(query);
  }

  setBranchUpstream(name: string, upstream: string): Promise<void> {
    return this.#repository.setBranchUpstream(name, upstream);
  }

  checkIgnore(paths: string[]): Promise<Set<string>> {
    return this.#repository.checkIgnore(paths);
  }

  getRefs(query: RefQuery): Promise<Ref[]> {
    return this.#repository.getRefs(query);
  }

  tag(name: string, message: string, ref?: string | undefined): Promise<void> {
    return this.#repository.tag({ name, message, ref });
  }

  deleteTag(name: string): Promise<void> {
    return this.#repository.deleteTag(name);
  }

  status(): Promise<void> {
    return this.#repository.status();
  }

  checkout(treeish: string): Promise<void> {
    return this.#repository.checkout(treeish);
  }

  addRemote(name: string, url: string): Promise<void> {
    return this.#repository.addRemote(name, url);
  }

  removeRemote(name: string): Promise<void> {
    return this.#repository.removeRemote(name);
  }

  renameRemote(name: string, newName: string): Promise<void> {
    return this.#repository.renameRemote(name, newName);
  }

  fetch(arg0?: FetchOptions | string | undefined,
    ref?: string | undefined,
    depth?: number | undefined,
    prune?: boolean | undefined
  ): Promise<void> {
    if (arg0 !== undefined && typeof arg0 !== 'string') {
      return this.#repository.fetch(arg0);
    }

    return this.#repository.fetch({ remote: arg0, ref, depth, prune });
  }

  pull(unshallow?: boolean): Promise<void> {
    return this.#repository.pull(undefined, unshallow);
  }

  push(remoteName?: string, branchName?: string, setUpstream: boolean = false, force?: ForcePushMode): Promise<void> {
    return this.#repository.pushTo(remoteName, branchName, setUpstream, force);
  }

  log(options?: LogOptions): Promise<Commit[]> {
    return this.#repository.log(options);
  }

  commit(message: string, opts?: CommitOptions): Promise<void> {
    return this.#repository.commit(message, { ...opts });
  }

  merge(ref: string): Promise<void> {
    return this.#repository.merge(ref);
  }

  mergeAbort(): Promise<void> {
    return this.#repository.mergeAbort();
  }
}

export class ApiGit implements Git {
  #model: Model;

  private _env: { [key: string]: string } | undefined;

  constructor(model: Model) { this.#model = model; }

  get path(): string { return this.#model.git.path; }

  get env(): { [key: string]: string } {
    if (this._env === undefined) {
      this._env = Object.freeze(this.#model.git.env);
    }

    return this._env;
  }
}

export class ApiImpl implements API {

  #model: Model;
  readonly git: ApiGit;

  constructor(model: Model) {
    this.#model = model;
    this.git = new ApiGit(this.#model);
  }

  get state(): APIState {
    return this.#model.state;
  }

  get onDidChangeState(): Event<APIState> {
    return this.#model.onDidChangeState;
  }

  get onDidPublish(): Event<PublishEvent> {
    return this.#model.onDidPublish;
  }

  get onDidOpenRepository(): Event<Repository> {
    return Event.map(this.#model.onDidOpenRepository, r => new ApiRepository(r));
  }

  get onDidCloseRepository(): Event<Repository> {
    return Event.map(this.#model.onDidCloseRepository, r => new ApiRepository(r));
  }

  get repositories(): Repository[] {
    return this.#model.repositories.map(r => new ApiRepository(r));
  }

  getRepository(uri: string): Repository | null {
    const result = this.#model.getRepository(uri);
    return result ? new ApiRepository(result) : null;
  }

  async getRepositoryRoot(uri: string): Promise<string | null> {
    const repository = this.getRepository(uri);
    if (repository) {
      return repository.rootUri;
    }

    try {
      const root = await this.#model.git.getRepositoryRoot(uri);
      return root;
    } catch (err: any) {
      if (
        err.gitErrorCode === GitErrorCodes.NotAGitRepository ||
        err.gitErrorCode === GitErrorCodes.NotASafeGitRepository
      ) {
        return null;
      }

      throw err;
    }
  }

  async init(root: string, options?: InitOptions): Promise<Repository | null> {
    await this.#model.git.init(root, options);
    await this.#model.openRepository(root);
    return this.getRepository(root) || null;
  }

  async openRepository(root: string): Promise<Repository | null> {
    await this.#model.openRepository(root);
    return this.getRepository(root) || null;
  }

  registerRemoteSourcePublisher(publisher: RemoteSourcePublisher) {
    this.#model.registerRemoteSourcePublisher(publisher);
  }

  registerCredentialsProvider(provider: CredentialsProvider): IDisposable {
    return this.#model.registerCredentialsProvider(provider);
  }

  registerPushErrorHandler(handler: PushErrorHandler) {
    this.#model.registerPushErrorHandler(handler);
  }
}
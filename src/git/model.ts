import { App, WorkspaceFoldersChangeEvent } from "../base/app";
import { config } from "../base/config";
import { debounce, memoize, sequentialize } from "../base/decorators";
import { Disposable, IDisposable } from "../base/disposable";
import { Emitter, Event } from "../base/event";
import { isUri, uriToPath } from "../base/uri";
import { SourceControl, SourceControlResourceGroup } from "../scm/api/sourceControl";
import { ApiRepository } from "./api/api1";
import { CredentialsProvider, PublishEvent, PushErrorHandler, RemoteSourcePublisher, APIState as State } from "./api/git";
import { AskPass } from "./askpass";
import { Git } from "./git";
import { LogOutputChannel } from "./logger";
import { IPushErrorHandlerRegistry } from "./pushError";
import { IRemoteSourcePublisherRegistry } from "./remotePublisher";
import { IRepositoryResolver, Repository } from "./repository";
import { fromGitUri, isGitUri } from "./uri";
import { isDescendant, joinUrl, pathEquals } from "./utils";

const fs = acode.require('fs');
const palette = acode.require('palette');
const Url = acode.require('Url');

class RepositoryPick {

  @memoize get text(): string {
    return `<span data-str="${this.repository.root}">${Url.basename(this.repository.root)}</span>`;
  }

  @memoize get value(): string {
    return this.repository.root;
  }

  constructor(private readonly repository: Repository) { }
}

export interface ModelChangeEvent {
  repository: Repository;
  path: string;
}

interface OpenRepository extends IDisposable {
  repository: Repository;
}

class ClosedRepositoriesManager {

  private _repositories = new Set<string>();
  get repositories(): string[] {
    return [...this._repositories.values()];
  }

  constructor() {
    this._repositories = new Set<string>(App.getContext<string[]>('git.closedRepositories', []));
    this.onDidChangeRepositories();
  }

  addRepository(repository: string): void {
    this._repositories.add(repository);
    this.onDidChangeRepositories();
  }

  deleteRepository(repository: string): boolean {
    const result = this._repositories.delete(repository);
    if (result) {
      this.onDidChangeRepositories();
    }

    return result;
  }

  isRepositoryClosed(repository: string): boolean {
    return this._repositories.has(repository);
  }

  private onDidChangeRepositories(): void {
    App.setContext('git.closedRepositories', [...this._repositories.values()]);
    App.setContext('git.closedRepositoryCount', this._repositories.size);
  }
}

export class Model implements IRepositoryResolver, IRemoteSourcePublisherRegistry, IPushErrorHandlerRegistry, IDisposable {

  private _onDidOpenRepository = new Emitter<Repository>();
  readonly onDidOpenRepository: Event<Repository> = this._onDidOpenRepository.event;

  private _onDidCloseRepository = new Emitter<Repository>();
  readonly onDidCloseRepository: Event<Repository> = this._onDidCloseRepository.event;

  private _onDidChangeRepository = new Emitter<ModelChangeEvent>();
  readonly onDidChangeRepository: Event<ModelChangeEvent> = this._onDidChangeRepository.event;

  private openRepositories: OpenRepository[] = [];
  get repositories(): Repository[] { return this.openRepositories.map(r => r.repository); }

  private possibleGitRepositoryPaths = new Set<string>();

  private _onDidChangeState = new Emitter<State>();
  readonly onDidChangeState = this._onDidChangeState.event;

  private _onDidPublish = new Emitter<PublishEvent>();
  readonly onDidPublish = this._onDidPublish.event;

  firePublishEvent(repository: Repository, branch?: string) {
    this._onDidPublish.fire({ repository: new ApiRepository(repository), branch: branch });
  }

  private _state: State = 'uninitialized';
  get state(): State { return this._state; }

  setState(state: State): void {
    this._state = state;
    this._onDidChangeState.fire(state);
    App.setContext('git.state', state);
  }

  @memoize
  get isInitialized(): Promise<void> {
    if (this._state === 'initialized') {
      return Promise.resolve();
    }

    return Event.toPromise(Event.filter(this.onDidChangeState, s => s === 'initialized')) as Promise<any>;
  }

  private remoteSourcePublishers = new Set<RemoteSourcePublisher>();

  private _onDidAddRemoteSourcePublisher = new Emitter<RemoteSourcePublisher>();
  readonly onDidAddRemoteSourcePublisher = this._onDidAddRemoteSourcePublisher.event;

  private _onDidRemoveRemoteSourcePublisher = new Emitter<RemoteSourcePublisher>();
  readonly onDidRemoveRemoteSourcePublisher = this._onDidRemoveRemoteSourcePublisher.event;

  private pushErrorHandlers = new Set<PushErrorHandler>();

  private _closedRepositoriesManager: ClosedRepositoriesManager;
  get closedRepositories(): string[] {
    return [...this._closedRepositoriesManager.repositories];
  }

  private disposables: IDisposable[] = [];

  constructor(
    readonly git: Git,
    private readonly akspass: AskPass,
    readonly logger: LogOutputChannel
  ) {
    this._closedRepositoriesManager = new ClosedRepositoriesManager();

    App.onDidChangeWorkspaceFolder(this.onDidChangeWorkspaceFolder, this, this.disposables);

    this.setState('uninitialized');
    this.doInitialScan().finally(() => this.setState('initialized'));
  }

  private async doInitialScan(): Promise<void> {
    this.logger.info('[Model][doInitialScan] Initial repository scan started');

    const initialScanFn = () => Promise.all([
      this.onDidChangeWorkspaceFolder({ added: addedFolder.map(f => ({ name: f.title, url: f.url })), removed: [] }),
      this.scanWorkspaceFolders()
    ]);

    await initialScanFn();

    this.logger.info(`[Model][doInitialScan] Initial repository scan completed.`);
  }

  private async scanWorkspaceFolders(): Promise<void> {
    try {
      const gitConfig = config.get('vcgit');
      const autoRepositoryDetection = gitConfig?.autoRepositoryDetection;

      if (autoRepositoryDetection !== true && autoRepositoryDetection !== 'subFolders') {
        return;
      }

      await Promise.all(addedFolder.map(async folder => {
        const root = folder.url;
        this.logger.info(`[Model][scanWorkspaceFolders] Workspace folder: ${root}`);

        const repositoryScanMaxDepth = gitConfig?.repositoryScanMaxDepth || 1;
        const repositoryScanIgnoredFolders = gitConfig?.repositoryScanIgnoredFolders || [];

        const subfolders = new Set(await this.traverseWorkspaceFolder(root, repositoryScanMaxDepth, repositoryScanIgnoredFolders));

        this.logger.info(`[Model][scanWorkspaceFolders] Workspace scan sub folders: [${[...subfolders].join(', ')}]`);
        await Promise.all([...subfolders].map(f => this.openRepository(f)));
      }));
    } catch (error) {
      this.logger.warn(`[Model][scanWorkspaceFolders] Error: ${error}`);
    }
  }

  private async traverseWorkspaceFolder(workspaceFolder: string, maxDepth: number, repositoryScanIgnoredFolders: string[]): Promise<string[]> {
    const result: string[] = [];
    const foldersToTravers = [{ path: workspaceFolder, depth: 0 }];

    while (foldersToTravers.length > 0) {
      const currentFolder = foldersToTravers.shift()!;

      const children: Acode.File[] = [];
      try {
        children.push(...await fs(currentFolder.path).lsDir());

        if (currentFolder.depth !== 0) {
          result.push(currentFolder.path);
        }
      } catch (err) {
        this.logger.warn(`[Model][traverseWorkspaceFolder] Unable to read workspace folder '${currentFolder.path}': ${err}`);
        continue;
      }

      if (currentFolder.depth < maxDepth || maxDepth === -1) {
        const childrenFolders = children
          .filter(file =>
            file.isDirectory && file.name !== '.git' &&
            !repositoryScanIgnoredFolders.find(f => pathEquals(file.name, f)))
          .map(file => joinUrl(currentFolder.path, file.name));

        foldersToTravers.push(...childrenFolders.map(folder => {
          return { path: folder, depth: currentFolder.depth + 1 };
        }));
      }
    }

    return result.map(f => uriToPath(f));
  }

  private eventuallyScanPossibleGitRepository(path: string) {
    this.possibleGitRepositoryPaths.add(path);
    this.eventuallyScanPossibleGitRepositories();
  }

  @debounce(500)
  private eventuallyScanPossibleGitRepositories(): void {
    for (const path of this.possibleGitRepositoryPaths) {
      this.openRepository(path, false);
    }

    this.possibleGitRepositoryPaths.clear();
  }

  private async onDidChangeWorkspaceFolder({ added, removed }: WorkspaceFoldersChangeEvent): Promise<void> {
    try {
      const possibleRepositoryFolders = added
        .filter(e => !this.getOpenRepository(e.url));
      const openRepositoriesToDispose = removed
        .map(e => this.getOpenRepository(e.url))
        .filter(r => !!r)
        .filter(r => !addedFolder.some(f => isDescendant(uriToPath(f.url), r.repository.root)));

      openRepositoriesToDispose.forEach(r => r.dispose());
      this.logger.info(`[Model][onDidChangeWorkspaceFolders] Workspace folders: [${possibleRepositoryFolders.map(p => uriToPath(p.url)).join(', ')}]`);
      await Promise.all(possibleRepositoryFolders.map(p => this.openRepository(uriToPath(p.url))));
    } catch (error) {
      this.logger.warn(`[Model][onDidChangeWorkspaceFolders] Error: ${error}`);
    }
  }

  @sequentialize
  async openRepository(repoPath: string, openIfClosed = false): Promise<void> {
    this.logger.info(`[Model][openRepository] Repository: ${repoPath}`);
    const existingRepository = await this.getRepositoryExact(repoPath);
    if (existingRepository) {
      this.logger.info(`[Model][openRepository] Repository for path ${repoPath} already exists: ${existingRepository.root}`);
      return;
    }

    const gitConfig = config.get('vcgit');
    const enabled = gitConfig?.enabled === true;

    if (!enabled) {
      this.logger.info('[Model][openRepository] Git is not enabled');
      return;
    }

    try {
      const { repositoryRoot, unsafeRepositoryMatch } = await this.getRepositoryRoot(repoPath);
      this.logger.info(`[Model][openRepository] Repository root for path ${repoPath} is: ${repositoryRoot}`);

      const existingRepository = await this.getRepositoryExact(repositoryRoot);
      if (existingRepository) {
        this.logger.info(`[Model][openRepository] Repository for path ${repositoryRoot} already exists: ${existingRepository.root}`);
        return;
      }

      if (unsafeRepositoryMatch && unsafeRepositoryMatch.length === 3) {
        this.logger.info(`[Model][openRepository] Unsafe repository: ${repositoryRoot}`);
        return;
      }

      if (!openIfClosed && this._closedRepositoriesManager.isRepositoryClosed(repositoryRoot)) {
        this.logger.warn(`[Model][openRepository] Repository for path ${repositoryRoot} is closed`);
        return;
      }

      const [dotGit, repositoryRootRealPath] = await Promise.all([this.git.getRepositoryDotGit(repositoryRoot), this.getRepositoryRootRealPath(repositoryRoot)]);
      const gitRepository = this.git.open(repositoryRoot, repositoryRootRealPath, dotGit, this.logger);
      const repository = new Repository(gitRepository, this, this, this, this.logger);

      this.open(repository);
      this._closedRepositoriesManager.deleteRepository(repository.root);

      this.logger.info(`[Model][openRepository] Opened repository (path): ${repository.root}`);
      this.logger.info(`[Model][openRepository] Opened repository (real path): ${repository.rootRealPath ?? repository.root}`);

      repository.status();
    } catch (err) {
      this.logger.error(`[Model][openRepository] Opening repository for path='${repoPath}' failed. Error:${err}`);
    }
  }

  private async getRepositoryRoot(repoPath: string): Promise<{ repositoryRoot: string, unsafeRepositoryMatch: RegExpMatchArray | null }> {
    try {
      const rawRoot = await this.git.getRepositoryRoot(repoPath);
      return { repositoryRoot: rawRoot, unsafeRepositoryMatch: null };
    } catch (error: any) {
      // Handle unsafe repository
      const unsafeRepositoryMatch = /^fatal: detected dubious ownership in repository at \'([^']+)\'[\s\S]*git config --global --add safe\.directory '?([^'\n]+)'?$/m.exec(error.stderr);
      if (unsafeRepositoryMatch && unsafeRepositoryMatch.length === 3) {
        return { repositoryRoot: unsafeRepositoryMatch[1], unsafeRepositoryMatch };
      }

      throw error;
    }
  }

  private async getRepositoryRootRealPath(repositoryRoot: string): Promise<string | undefined> {
    try {
      const result = await Executor.execute(`realpath "${repositoryRoot}"`, true);
      const repositoryRootRealPath = result.trim();
      return !pathEquals(repositoryRoot, repositoryRootRealPath) ? repositoryRootRealPath : undefined;
    } catch (error) {
      this.logger.warn(`[Model][getRepositoryRootRealPath] Failed to get repository realpath for "${repositoryRoot}": ${error}`);
      return undefined;
    }
  }

  private open(repository: Repository): void {
    this.logger.info(`[Model][open] Repository: ${repository.root}`);

    const changeListener = repository.onDidChangeRepository(path => this._onDidChangeRepository.fire({ repository, path }));

    const gitConfig = config.get('vcgit')!;
    const shouldDetectSubmodules = gitConfig.detectSubmodules;
    const submodulesLimit = gitConfig.detectSubmodulesLimit;

    const checkForSubmodules = () => {
      if (!shouldDetectSubmodules) {
        this.logger.debug('[Model][open] Automatic detection of git submodules is not enabled.');
        return;
      }

      if (repository.submodules.length > submodulesLimit) {
        acode.pushNotification('', `The "${Url.basename(repository.root)}" repository has ${repository.submodules.length} submodules which won't be opened automatically. You can still open each one individually by opening a file within.`, { type: 'warning' });
        statusListener.dispose();
      }

      repository.submodules
        .slice(0, submodulesLimit)
        .map(r => Url.join(repository.root, r.path))
        .forEach(p => {
          this.logger.debug(`[Model][open] Opening submodule: '${p}'`);
          this.eventuallyScanPossibleGitRepository(p);
        });
    }

    const statusListener = repository.onDidRunGitStatus(() => {
      checkForSubmodules();
    });

    const updateOperationInProgressContext = () => {
      let operationInProgress = false;
      for (const { repository } of this.openRepositories.values()) {
        if (repository.operations.shouldDisableCommands()) {
          operationInProgress = true;
        }
      }

      App.setContext('git.operationInProgress', operationInProgress);
    }

    const operationEvent = Event.any(repository.onDidRunOperation as Event<any>, repository.onRunOperation as Event<any>);
    const operationListener = operationEvent(() => updateOperationInProgressContext());
    updateOperationInProgressContext();

    const dispose = () => {
      changeListener.dispose();
      statusListener.dispose();
      operationListener.dispose();
      repository.dispose();
      this.openRepositories = this.openRepositories.filter(e => e !== openRepository);
      this._onDidCloseRepository.fire(repository);
    }

    const openRepository = { repository, dispose };
    this.openRepositories.push(openRepository);
    this._onDidOpenRepository.fire(repository);
  }

  close(repository: Repository): void {
    const openRepository = this.getOpenRepository(repository);

    if (!openRepository) {
      return;
    }

    this.logger.info(`[Model][close] Repository: ${repository.root}`);
    this._closedRepositoriesManager.addRepository(openRepository.repository.root);

    openRepository.dispose();
  }

  async pickRepository(): Promise<Repository | undefined> {
    return new Promise((resolve, reject) => {
      if (this.openRepositories.length === 0) {
        return reject(new Error('There are no available repositories'));
      }

      const repositories = this.openRepositories;
      const hintItems = repositories.map(r => new RepositoryPick(r.repository));

      const onSelect = (path: string): void => {
        const openRepository = repositories.find(r => pathEquals(r.repository.root, path));
        resolve(openRepository?.repository);
      }

      palette(() => hintItems as any[], onSelect, 'Choose a Repository');
    });
  }

  getRepository(sourceControl: SourceControl): Repository | undefined;
  getRepository(resourceGroup: SourceControlResourceGroup): Repository | undefined;
  getRepository(path: string): Repository | undefined;
  getRepository(hint: any): Repository | undefined {
    const liveRepository = this.getOpenRepository(hint);
    return liveRepository && liveRepository.repository;
  }

  private async getRepositoryExact(repoPath: string): Promise<Repository | undefined> {
    // Use the repository path
    const openRepository = this.openRepositories
      .find(r => pathEquals(r.repository.root, repoPath));

    if (openRepository) {
      return openRepository.repository;
    }

    try {
      // Use the repository real path
      const result = await Executor.execute(`realpath "${repoPath}"`, true);
      const repoPathRealPath = result.trim();
      const openRepositoryRealPath = this.openRepositories
        .find(r => pathEquals(r.repository.rootRealPath ?? r.repository.root, repoPathRealPath));
      return openRepositoryRealPath?.repository;
    } catch (error) {
      this.logger.warn(`[Model][getRepositoryExact] Failed to get repository realpath for: "${repoPath}". Error:${error}`)
      return undefined;

    }
  }

  private getOpenRepository(repository: Repository): OpenRepository | undefined;
  private getOpenRepository(sourceControl: SourceControl): OpenRepository | undefined;
  private getOpenRepository(resourceGroup: SourceControlResourceGroup): OpenRepository | undefined;
  private getOpenRepository(path: string): OpenRepository | undefined;
  private getOpenRepository(hint: any): OpenRepository | undefined {
    if (!hint) {
      return undefined;
    }

    if (hint instanceof Repository) {
      return this.openRepositories.filter(r => r.repository === hint)[0];
    }

    if (typeof hint === 'string') {
      let path: string;

      if (isGitUri(hint)) {
        path = fromGitUri(hint).path;
      } else if (isUri(hint)) {
        path = uriToPath(hint);
      } else {
        path = hint;
      }

      outer:
      for (const liveRepository of this.openRepositories.sort((a, b) => b.repository.root.length - a.repository.root.length)) {
        if (!isDescendant(liveRepository.repository.root, path)) {
          continue;
        }

        for (const submodule of liveRepository.repository.submodules) {
          const submoduleRoot = Url.join(liveRepository.repository.root, submodule.path);

          if (isDescendant(submoduleRoot, path)) {
            continue outer;
          }
        }

        return liveRepository;
      }

      return undefined;
    }

    for (const liveRepository of this.openRepositories) {
      const repository = liveRepository.repository;

      if (hint === repository.sourceControl) {
        return liveRepository;
      }

      if (hint === repository.mergeGroup || hint === repository.indexGroup || hint === repository.workingTreeGroup || hint === repository.untrackedGroup) {
        return liveRepository;
      }
    }

    return undefined;
  }

  getRepositoryForSubmodule(path: string): Repository | undefined {
    for (const repository of this.repositories) {
      for (const submodule of repository.submodules) {
        const submodulePath = Url.join(repository.root, submodule.path);

        if (submodulePath === path) {
          return repository;
        }
      }
    }

    return undefined;
  }

  registerRemoteSourcePublisher(publisher: RemoteSourcePublisher): IDisposable {
    this.remoteSourcePublishers.add(publisher);
    this._onDidAddRemoteSourcePublisher.fire(publisher);

    return Disposable.toDisposable(() => {
      this.remoteSourcePublishers.delete(publisher);
      this._onDidRemoveRemoteSourcePublisher.fire(publisher);
    });
  }

  getRemoteSourcePublishers(): RemoteSourcePublisher[] {
    return [...this.remoteSourcePublishers.values()];
  }

  registerCredentialsProvider(provider: CredentialsProvider): IDisposable {
    return this.akspass.registerCredentialsProvider(provider);
  }

  registerPushErrorHandler(handler: PushErrorHandler): IDisposable {
    this.pushErrorHandlers.add(handler);
    return Disposable.toDisposable(() => this.pushErrorHandlers.delete(handler));
  }

  getPushErrorHandlers(): PushErrorHandler[] {
    return [...this.pushErrorHandlers];
  }

  dispose(): void {
    const openRepositories = [...this.openRepositories];
    openRepositories.forEach(r => r.dispose());
    this.openRepositories = [];
    this.possibleGitRepositoryPaths.clear();
    this.disposables = Disposable.dispose(this.disposables);
  }
}
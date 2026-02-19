import { App, WorkspaceFoldersChangeEvent } from "../base/app";
import { config } from "../base/config";
import { debounce, memoize, sequentialize, throttle } from "../base/decorators";
import { Disposable, IDisposable } from "../base/disposable";
import { Emitter, Event } from "../base/event";
import { getExecutor } from "../base/executor";
import { uriToPath } from "../base/uri";
import { SourceControl, SourceControlResourceGroup } from "../scm/api/sourceControl";
import { ApiRepository } from "./api/api1";
import { CredentialsProvider, PickRemoteSourceOptions, PublishEvent, PushErrorHandler, RemoteSource, RemoteSourceProvider, RemoteSourcePublisher, APIState as State } from "./api/git";
import { AskPass } from "./askpass";
import { item, showDialogMessage } from "./dialog";
import { Git } from "./git";
import { getInputHintResult, HintItem, InputHint, showInputHints } from "./hints";
import { LogOutputChannel } from "./logger";
import { IPushErrorHandlerRegistry } from "./pushError";
import { IRemoteSourceProviderRegistry } from "./remoteProvider";
import { IRemoteSourcePublisherRegistry } from "./remotePublisher";
import { IRepositoryResolver, Repository } from "./repository";
import { fromGitUri, isGitUri } from "./uri";
import { isDescendant, joinUrl, pathEquals } from "./utils";

const fs = acode.require('fs');
const Url = acode.require('Url');

class RepositoryHint implements HintItem {

  @memoize get label(): string { return Url.basename(this.repository.root)!; }

  @memoize get description(): string {
    return [this.repository.headLabel, this.repository.syncLabel]
      .filter(l => !!l)
      .join(' ');
  }

  @memoize get icon(): string { return 'repo'; }

  constructor(public readonly repository: Repository) { }
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

class UnsafeRepositoriesManager {

  private _repositories = new Map<string, string>();
  get repositories(): string[] {
    return [...this._repositories.keys()];
  }

  constructor() {
    this.onDidChangeRepositories();
  }

  addRepository(repository: string, path: string): void {
    this._repositories.set(repository, path);
    this.onDidChangeRepositories();
  }

  deleteRepository(repository: string): boolean {
    const result = this._repositories.delete(repository);
    if (result) {
      this.onDidChangeRepositories();
    }

    return result;
  }

  getRepositoryPath(repository: string): string | undefined {
    return this._repositories.get(repository);
  }

  hasRepository(repository: string): boolean {
    return this._repositories.has(repository);
  }

  private onDidChangeRepositories(): void {
    App.setContext('git.unsafeRepositoryCount', this._repositories.size);
  }
}

class RemoteSourceProviderInputHint implements IDisposable {

  private disposables: IDisposable[] = [];
  private isDisposed: boolean = false;

  private inputHint: InputHint<HintItem & { remoteSource?: RemoteSource }> | undefined;

  constructor(private provider: RemoteSourceProvider) { }

  dispose(): void {
    this.disposables = Disposable.dispose(this.disposables);
    this.disposables = [];
    this.inputHint = undefined;
    this.isDisposed = true;
  }

  private ensureInputHints() {
    if (!this.inputHint) {
      this.inputHint = new InputHint();
      this.disposables.push(this.inputHint);
      this.inputHint.ignoreFocusOut = true;
      this.inputHint.enterKeyHint = 'go';
      this.disposables.push(this.inputHint.onDidHide(() => this.dispose()));
      if (this.provider.supportsQuery) {
        this.inputHint.placeholder = this.provider.placeholder ?? 'Repository name (type to search)';
        this.disposables.push(this.inputHint.onDidChangeValue(this.onDidChangeValue, this));
      } else {
        this.inputHint.placeholder = 'Repository name';
      }
    }
  }

  @debounce(300)
  private onDidChangeValue(): void {
    this.query();
  }

  @throttle
  private async query(): Promise<void> {
    try {
      if (this.isDisposed) {
        return;
      }
      this.ensureInputHints();
      this.inputHint!.loading = true;

      const remoteSources = await this.provider.getRemoteSources(this.inputHint?.value) || [];
      if (this.isDisposed) {
        return;
      }

      if (remoteSources.length === 0) {
        this.inputHint!.items = [{ label: 'No remote repositories found.' }];
      } else {
        this.inputHint!.items = remoteSources.map(remoteSource => ({
          label: remoteSource.name,
          icon: remoteSource.icon,
          description: remoteSource.description || (typeof remoteSource.url === 'string' ? remoteSource.url : remoteSource.url[0]),
          detail: remoteSource.detail,
          remoteSource
        }));
      }
    } catch (err: any) {
      this.inputHint!.items = [{ label: `Error: ${err.message}`, icon: 'error' }];
    } finally {
      if (!this.isDisposed) {
        this.inputHint!.loading = false;
      }
    }
  }

  async hint(): Promise<RemoteSource | undefined> {
    await this.query();
    if (this.isDisposed) {
      return;
    }
    const result = await getInputHintResult(this.inputHint!);
    return result?.remoteSource;
  }
}

async function pickProviderSource(provider: RemoteSourceProvider): Promise<string | undefined> {
  const inputHint = new RemoteSourceProviderInputHint(provider);
  const remote = await inputHint.hint();
  inputHint.dispose();

  let url: string | undefined;

  if (remote) {
    if (typeof remote.url === 'string') {
      url = remote.url;
    } else if (remote.url.length > 0) {
      url = await acode.select('Choose a URL', remote.url.map(url => [url, url]));
    }
  }

  return url;
}

export class Model implements IRepositoryResolver, IRemoteSourcePublisherRegistry, IPushErrorHandlerRegistry, IRemoteSourceProviderRegistry, IDisposable {

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
  private remoteSourceProviders = new Set<RemoteSourceProvider>();

  private _onDidAddRemoteSourcePublisher = new Emitter<RemoteSourcePublisher>();
  readonly onDidAddRemoteSourcePublisher = this._onDidAddRemoteSourcePublisher.event;

  private _onDidRemoveRemoteSourcePublisher = new Emitter<RemoteSourcePublisher>();
  readonly onDidRemoveRemoteSourcePublisher = this._onDidRemoveRemoteSourcePublisher.event;

  private _onDidAddRemoteSourceProvider = new Emitter<RemoteSourceProvider>();
  readonly onDidAddRemoteSourceProvider = this._onDidAddRemoteSourceProvider.event;

  private _onDidRemoveRemoteSourceProvider = new Emitter<RemoteSourceProvider>();
  readonly onDidRemoveRemoteSourceProvider = this._onDidRemoveRemoteSourceProvider.event;

  private pushErrorHandlers = new Set<PushErrorHandler>();

  private _unsafeRepositoriesManager: UnsafeRepositoriesManager;
  get unsafeRepositories(): string[] {
    return this._unsafeRepositoriesManager.repositories;
  }

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
    this._unsafeRepositoriesManager = new UnsafeRepositoriesManager();

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

        if (this._state === 'initialized' && !this._unsafeRepositoriesManager.hasRepository(repositoryRoot)) {
          this.showUnsafeRepositoryNotification();
        }

        this._unsafeRepositoriesManager.addRepository(repositoryRoot, unsafeRepositoryMatch[2]);
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
      const result = await getExecutor().execute(`realpath "${repositoryRoot}"`, true);
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
    if (this.openRepositories.length === 0) {
      throw new Error('There are no available repositories');
    }

    if (this.openRepositories.length === 1) {
      return this.openRepositories[0].repository;
    }

    const active = editorManager.activeFile;
    const hints = this.openRepositories.map(r => new RepositoryHint(r.repository));
    const repository = active && this.getRepository(active.uri);
    const index = hints.findIndex(hint => hint.repository === repository);

    // Move repository hint containing the active text editor to appear first
    if (index > -1) {
      hints.unshift(...hints.splice(index, 1));
    }

    const hint = await showInputHints(hints, { placeholder: 'Choose a Repository' });
    return hint && hint.repository;
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
      const result = await getExecutor().execute(`realpath "${repoPath}"`, true);
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
      } else {
        path = uriToPath(hint);
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

  registerRemoteSourceProvider(provider: RemoteSourceProvider): IDisposable {
    this.remoteSourceProviders.add(provider);
    this._onDidAddRemoteSourceProvider.fire(provider);

    return Disposable.toDisposable(() => {
      this.remoteSourceProviders.delete(provider);
      this._onDidRemoveRemoteSourceProvider.fire(provider);
    });
  }

  async pickRemoteSource(options: PickRemoteSourceOptions = {}): Promise<string | undefined> {
    const remoteProviders = [...this.remoteSourceProviders]
      .map(provider => ({ label: options.providerLabel ? options.providerLabel(provider) : provider.name, icon: provider.icon, provider }));

    if (remoteProviders.length > 0) {
      const inputHint = new InputHint<(HintItem & { provider?: RemoteSourceProvider; url?: string })>();
      inputHint.placeholder = 'Provide repository URL or pick a repository source.';
      const items = [
        { type: 'separator', label: 'remote sources' } satisfies HintItem,
        ...remoteProviders
      ];

      const updateHints = (value?: string) => {
        if (value) {
          inputHint.items = [{
            label: options.urlLabel || 'URL',
            description: value,
            url: value
          },
          ...items
          ];
        } else {
          inputHint.items = items;
        }
      }

      inputHint.onDidChangeValue(updateHints);
      updateHints();

      const result = await getInputHintResult(inputHint);

      if (result) {
        if (result.url) {
          return result.url;
        } else if (result.provider) {
          return await pickProviderSource(result.provider);
        }
      }

      return undefined;
    } else {
      const url = await acode.prompt(options.urlLabel || 'URL', '', 'url', { placeholder: 'Provide repository URL', });
      if (!url) {
        return undefined;
      }
      return url;
    }
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

  getUnsafeRepositoryPath(repository: string): string | undefined {
    return this._unsafeRepositoriesManager.getRepositoryPath(repository);
  }

  deleteUnsafeRepository(repository: string): boolean {
    return this._unsafeRepositoriesManager.deleteRepository(repository);
  }

  private async showUnsafeRepositoryNotification(): Promise<void> {
    if (this.repositories.length === 0) {
      return;
    }

    const message = this.unsafeRepositories.length === 1 ?
      'The git repository in the current folder is potentially unsafe as the folder is owned by someone other than the current user.' :
      'The git repositories in the current folder are potentially unsafe as the folders are owned by someone other than the current user.';

    const manageUnsafeRepositories = item('Manage Unsafe Repositories');
    const choice = await showDialogMessage('ERROR', message, manageUnsafeRepositories);
    if (choice === manageUnsafeRepositories) {
      editorManager.editor.execCommand('git.manageUnsafeRepositories');
    }
  }

  dispose(): void {
    const openRepositories = [...this.openRepositories];
    openRepositories.forEach(r => r.dispose());
    this.openRepositories = [];
    this.possibleGitRepositoryPaths.clear();
    this.disposables = Disposable.dispose(this.disposables);
  }
}
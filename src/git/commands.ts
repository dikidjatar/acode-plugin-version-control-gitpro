import { config } from "../base/config";
import { Disposable, IDisposable } from "../base/disposable";
import { isUri, uriToPath } from "../base/uri";
import { SourceControl, SourceControlResourceState } from "../scm/api/sourceControl";
import { ApiRepository } from "./api/api1";
import { Branch, CommitOptions, ForcePushMode, GitErrorCodes, Ref, RefType, Remote, RemoteSourcePublisher, Status } from "./api/git";
import { item, showDialogMessage } from "./dialog";
import { Git } from "./git";
import { HintItem, showInputHints } from "./hints";
import { LogOutputChannel } from "./logger";
import { Model } from "./model";
import { Repository, Resource, ResourceGroupType } from "./repository";
import { toGitUri } from "./uri";
import { fromNow, grep, isDescendant, pathEquals } from "./utils";

const fileBrowser = acode.require('fileBrowser') as any;
const Url = acode.require('Url');
const confirm = acode.require('confirm');
const openFolder = acode.require('openFolder');
const prompt = acode.require('prompt');
const select = acode.require('select');
const loader = acode.require('loader');
const EditorFile: any = acode.require('EditorFile');
const DialogBox = acode.require('DialogBox');
const multiPrompt = acode.require('multiPrompt');

abstract class CheckoutCommandItem implements HintItem {
  get value(): string {
    return this.label;
  }

  abstract get label(): string;
  abstract get icon(): string;
}

class CreateBranchItem extends CheckoutCommandItem {
  get label(): string { return 'Create new branch...'; }
  get icon(): string { return 'add' }
}

class CreateBranchFromItem extends CheckoutCommandItem {
  get label(): string { return 'Create new branch from...'; }
  get icon(): string { return 'add' }
}

class CheckoutDetachedItem extends CheckoutCommandItem {
  get label(): string { return 'Checkout detached...'; }
  get icon(): string { return 'debug-disconnect'; }
}

class RefItemSeparator implements HintItem {
  get label(): string {
    switch (this.refType) {
      case RefType.Head:
        return 'branches';
      case RefType.RemoteHead:
        return 'remote branched';
      case RefType.Tag:
        return 'tags';
      default:
        return '';
    }
  }

  readonly type = 'separator';

  constructor(private readonly refType: RefType) { }
}

class RefItem implements HintItem {

  get label(): string {
    switch (this.ref.type) {
      case RefType.Head:
        return this.ref.name ?? this.shortCommit;
      case RefType.RemoteHead:
        return this.ref.name ?? this.shortCommit;
      case RefType.Tag:
        return this.ref.name ?? this.shortCommit;
      default:
        return '';
    }
  }

  get icon(): string {
    switch (this.ref.type) {
      case RefType.Head: return 'branch';
      case RefType.RemoteHead: return 'cloud';
      case RefType.Tag: return 'tag';
    }
  }

  get description(): string {
    if (this.ref.commitDetails?.commitDate) {
      return fromNow(this.ref.commitDetails.commitDate, true, true);
    }

    switch (this.ref.type) {
      case RefType.Head:
        return this.shortCommit;
      case RefType.RemoteHead:
        return `Remote branch at ${this.shortCommit}`;
      case RefType.Tag:
        return `Tag at ${this.shortCommit}`;
      default:
        return '';
    }
  }

  get detail(): string | undefined {
    if (this.ref.commitDetails?.authorName && this.ref.commitDetails?.message) {
      return `${this.ref.commitDetails.authorName} • ${this.shortCommit} • ${this.ref.commitDetails.message}`;
    }

    return undefined;
  }

  get refId(): string {
    switch (this.ref.type) {
      case RefType.Head:
        return `refs/heads/${this.ref.name}`;
      case RefType.RemoteHead:
        return `refs/remotes/${this.ref.remote}/${this.ref.name}`;
      case RefType.Tag:
        return `refs/tags/${this.ref.name}`;
    }
  }

  get refName(): string | undefined { return this.ref.name; }
  get refRemote(): string | undefined { return this.ref.remote; }
  get shortCommit(): string { return (this.ref.commit || '').substring(0, this.shortCommitLength); }

  constructor(protected readonly ref: Ref, private readonly shortCommitLength: number) { }
}

class BranchItem extends RefItem {

  override get description(): string {
    const description: string[] = [];

    if (typeof this.ref.behind === 'number' && typeof this.ref.ahead === 'number') {
      description.push(`${this.ref.behind}↓ ${this.ref.ahead}↑`);
    }
    if (this.ref.commitDetails?.commitDate) {
      description.push(fromNow(this.ref.commitDetails.commitDate, true, true));
    }

    return description.length > 0 ? description.join(' • ') : this.shortCommit;
  }

  constructor(override readonly ref: Branch, shortCommitLength: number) {
    super(ref, shortCommitLength);
  }
}

class CheckoutItem extends BranchItem {
  async run(repository: Repository, opts?: { detached?: boolean }): Promise<void> {
    if (!this.ref.name) {
      return;
    }

    const gitConfig = config.get('vcgit')!;
    const pullBeforeCheckout = gitConfig.pullBeforeCheckout;

    const treeish = opts?.detached ? this.ref.commit ?? this.ref.name : this.ref.name;
    await repository.checkout(treeish, { ...opts, pullBeforeCheckout });
  }
}

class CheckoutRemoteHeadItem extends RefItem {
  async run(repository: Repository, opts?: { detached?: boolean }): Promise<void> {
    if (!this.ref.name) {
      return;
    }

    if (opts?.detached) {
      await repository.checkout(this.ref.commit ?? this.ref.name, opts);
      return;
    }

    const branches = await repository.findTrackingBranches(this.ref.name);

    if (branches.length > 0) {
      await repository.checkout(branches[0].name!, opts);
    } else {
      await repository.checkoutTracking(this.ref.name, opts);
    }
  }
}

class CheckoutTagItem extends RefItem {

  async run(repository: Repository, opts?: { detached?: boolean }): Promise<void> {
    if (!this.ref.name) {
      return;
    }

    await repository.checkout(this.ref.name, opts);
  }
}

class BranchDeleteItem extends BranchItem {

  async run(repository: Repository, force?: boolean): Promise<void> {
    if (this.ref.type === RefType.Head && this.refName) {
      await repository.deleteBranch(this.refName, force);
    } else if (this.ref.type === RefType.RemoteHead && this.refRemote && this.refName) {
      const refName = this.refName.substring(this.refRemote.length + 1);
      await repository.deleteRemoteRef(this.refRemote, refName, { force });
    }
  }
}

class TagDeleteItem extends RefItem {

  async run(repository: Repository): Promise<void> {
    if (this.ref.name) {
      await repository.deleteTag(this.ref.name);
    }
  }
}

class RemoteTagDeleteItem extends RefItem {

  override get description(): string {
    return `Remote tag at ${this.shortCommit}`;
  }

  async run(repository: Repository, remote: string): Promise<void> {
    if (this.ref.name) {
      await repository.deleteRemoteRef(remote, this.ref.name);
    }
  }
}

class MergeItem extends BranchItem {

  async run(repository: Repository): Promise<void> {
    if (this.ref.name || this.ref.commit) {
      await repository.merge(this.ref.name ?? this.ref.commit!);
    }
  }
}

class RebaseItem extends BranchItem {

  async run(repository: Repository): Promise<void> {
    if (this.ref?.name) {
      await repository.rebase(this.ref.name);
    }
  }
}

class RebaseUpstreamItem extends RebaseItem {

  override get description(): string {
    return '(upstream)';
  }
}

class HEADItem implements HintItem {

  constructor(private repository: Repository, private readonly shortCommitLength: number) { }

  get label(): string { return 'HEAD'; }
  get value(): string { return 'HEAD'; }
  get description(): string { return (this.repository.HEAD?.commit ?? '').substring(0, this.shortCommitLength); }
  get refName(): string { return 'HEAD'; }
}

class AddRemoteItem implements HintItem {

  constructor(private cc: CommandCenter) { }

  get label(): string { return 'Add a new remote...'; }
  get icon(): string { return 'add'; };

  async run(repository: Repository): Promise<void> {
    await this.cc.addRemote(repository);
  }
}

class RemoteItem implements HintItem {
  get label(): string { return this.remote.name; }
  icon = 'cloud';
  get smallDescription(): string | undefined { return this.remote.fetchUrl; };
  get remoteName(): string { return this.remote.name; }

  constructor(private readonly repository: Repository, private readonly remote: Remote) { }

  async run(): Promise<void> {
    await this.repository.fetch({ remote: this.remote.name });
  }
}

class RepositoryItem implements HintItem {

  get label(): string { return getRepositoryLabel(this.path); }
  get smallDescription(): string { return this.path; }

  constructor(public readonly path: string) { }
}

function getRepositoryLabel(repositoryRoot: string): string {
  const folder = addedFolder.find(folder => pathEquals(folder.url, repositoryRoot));
  return folder ? folder.title : Url.basename(repositoryRoot)!;
}

function sanitizeBranchName(name: string, whitespaceChar: string): string {
  return name ? name.trim().replace(/^-+/, '').replace(/^\.|\/\.|\.\.|~|\^|:|\/$|\.lock$|\.lock\/|\\|\*|\s|^\s*$|\.$|\[|\]$/g, whitespaceChar) : name;
}

function sanitizeRemoteName(name: string) {
  name = name.trim();
  return name && name.replace(/^\.|\/\.|\.\.|~|\^|:|\/$|\.lock$|\.lock\/|\\|\*|\s|^\s*$|\.$|\[|\]$/g, '-');
}

enum PushType {
  Push,
  PushTo,
  PushFollowTags,
  PushTags
}

interface PushOptions {
  pushType: PushType;
  forcePush?: boolean;
  silent?: boolean;

  pushTo?: {
    remote?: string;
    refspec?: string;
    setUpstream?: boolean;
  };
}

interface ScmCommandOptions {
  repository?: boolean;
}

interface ScmCommand {
  title: string;
  key: string;
  method: Function;
  options: ScmCommandOptions;
}

const Commands: ScmCommand[] = [];

function command(title: string, options: ScmCommandOptions = {}): Function {
  return (_target: Object, key: string | symbol, descriptor: TypedPropertyDescriptor<any>) => {
    if (typeof key === 'symbol' || typeof descriptor.value !== 'function') {
      throw new Error('not supported');
    }
    Commands.push({ title, key, method: descriptor.value, options });
  };
}

async function categorizeResourceByResolution(
  resources: Resource[]
): Promise<{
  merge: Resource[];
  resolved: Resource[];
  unresolved: Resource[];
  deletionConflicts: Resource[]
}> {
  const selection = resources.filter(s => s instanceof Resource) as Resource[];
  const merge = selection.filter(s => s.resourceGroupType === ResourceGroupType.Merge);
  const isBothAddedOrModified = (s: Resource) => s.type === Status.BOTH_MODIFIED || s.type === Status.BOTH_ADDED;
  const isAnyDeleted = (s: Resource) => s.type === Status.DELETED_BY_THEM || s.type === Status.DELETED_BY_US;
  const possibleUnresolved = merge.filter(isBothAddedOrModified);
  const promises = possibleUnresolved.map(r => grep(r.resourceUri, /^<{7}\s|^={7}$|^>{7}\s/));
  const unresolvedBothModified = await Promise.all<boolean>(promises);
  const resolved = possibleUnresolved.filter((_s, i) => !unresolvedBothModified[i]);
  const deletionConflicts = merge.filter(s => isAnyDeleted(s));
  const unresolved = [
    ...merge.filter(s => !isBothAddedOrModified(s) && !isAnyDeleted(s)),
    ...possibleUnresolved.filter((_s, i) => unresolvedBothModified[i])
  ];

  return { merge, resolved, unresolved, deletionConflicts };
}

async function createCheckoutItems(repository: Repository, detached = false): Promise<HintItem[]> {
  const gitConfig = config.get('vcgit');
  const checkoutConfigType = gitConfig?.checkoutType;
  const showRefDetails = gitConfig?.showReferenceDetails === true;

  let checkoutType: string[];

  if (checkoutConfigType === 'all' || !checkoutConfigType) {
    checkoutType = ['local', 'remote', 'tags'];
  } else {
    checkoutType = [checkoutConfigType];
  }

  if (detached) {
    checkoutType = checkoutType.filter(t => t !== 'tags');
  }

  const refs = await repository.getRefs({ includeCommitDetails: showRefDetails });
  const refProcessors = checkoutType.map(type => getCheckoutRefProcessor(repository, type))
    .filter(p => !!p) as RefProcessor[];

  const itemsProcessor = new CheckoutItemsProcessor(repository, refProcessors, detached);
  return itemsProcessor.processRefs(refs);
}

class RefProcessor {
  protected readonly refs: Ref[] = [];

  constructor(protected readonly type: RefType, protected readonly ctor: { new(ref: Ref, shortCommitLength: number): HintItem } = RefItem) { }

  processRef(ref: Ref): boolean {
    if (!ref.name && !ref.commit) {
      return false;
    }
    if (ref.type !== this.type) {
      return false;
    }

    this.refs.push(ref);
    return true;
  }

  getItems(shortCommitLength: number): HintItem[] {
    const items = this.refs.map(r => new this.ctor(r, shortCommitLength));
    return items.length === 0 ? items : [new RefItemSeparator(this.type), ...items];
  }
}

class RefItemsProcessor {
  protected readonly shortCommitLength: number;

  constructor(
    protected readonly repository: Repository,
    protected readonly processors: RefProcessor[],
    protected readonly options: {
      skipCurrentBranch?: boolean;
      skipCurrentBranchRemote?: boolean;
    } = {}
  ) {
    const gitConfig = config.get('vcgit');
    this.shortCommitLength = gitConfig?.commitShortHashLength ?? 7;
  }

  processRefs(refs: Ref[]): HintItem[] {
    const refsToSkip = this.getRefsToSkip();

    for (const ref of refs) {
      if (ref.name && refsToSkip.includes(ref.name)) {
        continue;
      }
      for (const processor of this.processors) {
        if (processor.processRef(ref)) {
          break;
        }
      }
    }

    const result: HintItem[] = [];
    for (const processor of this.processors) {
      result.push(...processor.getItems(this.shortCommitLength));
    }

    return result;
  }

  protected getRefsToSkip(): string[] {
    const refsToSkip = ['origin/HEAD'];

    if (this.options.skipCurrentBranch && this.repository.HEAD?.name) {
      refsToSkip.push(this.repository.HEAD.name);
    }

    if (this.options.skipCurrentBranchRemote && this.repository.HEAD?.upstream) {
      refsToSkip.push(`${this.repository.HEAD.upstream.remote}/${this.repository.HEAD.upstream.name}`);
    }

    return refsToSkip;
  }
}

class CheckoutRefProcessor extends RefProcessor {

  constructor(private readonly repository: Repository) {
    super(RefType.Head);
  }

  override getItems(shortCommitLength: number): HintItem[] {
    const items = this.refs.map(ref => new CheckoutItem(ref, shortCommitLength));
    return items.length === 0 ? items : [new RefItemSeparator(this.type), ...items];
  }
}

class CheckoutItemsProcessor extends RefItemsProcessor {

  constructor(
    repository: Repository,
    processors: RefProcessor[],
    private readonly detached = false
  ) {
    super(repository, processors);
  }

  override processRefs(refs: Ref[]): HintItem[] {
    for (const ref of refs) {
      if (!this.detached && ref.name === 'origin/HEAD') {
        continue;
      }

      for (const processor of this.processors) {
        if (processor.processRef(ref)) {
          break;
        }
      }
    }

    const result: HintItem[] = [];
    for (const processor of this.processors) {
      for (const item of processor.getItems(this.shortCommitLength)) {
        if (!(item instanceof RefItem)) {
          result.push(item);
          continue;
        }

        result.push(item);
      }
    }

    return result;
  }
}

function getCheckoutRefProcessor(repository: Repository, type: string): RefProcessor | undefined {
  switch (type) {
    case 'local':
      return new CheckoutRefProcessor(repository);
    case 'remote':
      return new RefProcessor(RefType.RemoteHead, CheckoutRemoteHeadItem);
    case 'tags':
      return new RefProcessor(RefType.Tag, CheckoutTagItem);
    default:
      break;
  }
}

function getModeForFile(filename: string) {
  const { getModeForPath } = ace.require('ace/ext/modelist');
  const { name } = getModeForPath(filename);
  return `ace/mode/${name}`;
}

export class CommandCenter {

  private disposables: IDisposable[];

  constructor(
    private git: Git,
    private model: Model,
    private logger: LogOutputChannel
  ) {
    this.disposables = Commands.map(({ title, key, method, options }) => {
      const command = this.createCommand(key, method, options);
      const commandName = `git.${key}`;
      editorManager.editor.commands.addCommand({
        name: commandName,
        description: `Git: ${title}`,
        exec: (editor: any, arg: any) => command(...(Array.isArray(arg) ? arg : [arg]))
      });
      return Disposable.toDisposable(() => {
        editorManager.editor.commands.removeCommand(commandName);
      });
    });
  }

  async cloneRepository(
    url?: string,
    parentPath?: string,
    options: { recursive?: boolean; ref?: string } = {}
  ): Promise<void> {
    if (!url || typeof url !== 'string') {
      url = await prompt('Clone Repository', '', 'text', { placeholder: 'Enter repository Url' }) ?? undefined;
    }

    if (!url) {
      return;
    }

    if (!parentPath) {
      const folder = await fileBrowser('folder', 'Choose a folder to clone');
      if (!folder || !folder.url) {
        return;
      }

      parentPath = uriToPath(folder.url);
    }

    const cloneLoader: any = loader.create('Loading', `Cloning git repository "${url}"`, {
      callback: () => window.toast('Clone timeout', 3000),
      timeout: 120000
    });
    try {
      const repositoryPath = await this.git.clone(url, { parentPath: parentPath!, recursive: options.recursive, ref: options.ref, onProgress: (data) => cloneLoader.setMessage(data) });
      cloneLoader.destroy();

      const gitConfig = config.get('vcgit')!;
      const openAfterClone = gitConfig.openAfterClone;

      const uri = 'file://' + repositoryPath;

      if (openAfterClone === 'always') {
        openFolder(uri, { name: Url.basename(uri)! });
      } else if (openAfterClone === 'whenNoFolderOpen' && addedFolder.length === 0) {
        openFolder(uri, { name: Url.basename(uri)! });
      } else {
        const confirmation = await confirm('Info', 'Would you like to open the cloned repository?');
        if (confirmation) {
          openFolder(uri, { name: Url.basename(uri)! });
        }
      }
    } catch (err: any) {
      if (/already exists and is not an empty directory/.test(err && err.stderr || '')) {
        acode.pushNotification('Error', 'The target directory already exists and is not empty. Please choose an empty directory to clone the repository into.');
      }

      cloneLoader.destroy();
      throw err;
    }
  }

  @command('Refresh', { repository: true })
  async refresh(repository: Repository): Promise<void> {
    await repository.refresh();
  }

  @command('Open Repository', { repository: false })
  async openRepository(path?: string): Promise<void> {
    if (!path) {
      const folder = await fileBrowser('folder', 'Initialize Repository');
      if (!folder || !folder.url) {
        return;
      }

      path = uriToPath(folder.url);
    }

    await this.model.openRepository(path, true);
  }

  @command('Reopen Closed Repositories...', { repository: false })
  async reopenClosedRepositories(): Promise<void> {
    if (this.model.closedRepositories.length === 0) {
      return;
    }

    const items = this.model.closedRepositories.map(r => new RepositoryItem(r));

    const repository = await showInputHints(items, { placeholder: 'Pick a repository to reopen' });
    if (!repository) {
      return;
    }

    this.model.openRepository(repository.path, true);
  }

  @command('Close Repository', { repository: true })
  async close(repository: Repository, ...args: SourceControl[]): Promise<void> {
    const otherRepositories = args
      .map(sourceControl => this.model.getRepository(sourceControl))
      .filter(repository => typeof repository !== 'undefined' && repository !== null);
    for (const r of [repository, ...otherRepositories]) {
      this.model.close(r);
    }
  }

  @command('Close Other Repositories', { repository: true })
  async closeOtherRepositories(repository: Repository, ...args: SourceControl[]): Promise<void> {
    const otherRepositories = args
      .map(sourceControl => this.model.getRepository(sourceControl))
      .filter(repository => typeof repository !== 'undefined' && repository !== null);
    const selecteRepository = [repository, ...otherRepositories];
    for (const r of this.model.repositories) {
      if (selecteRepository.includes(r)) {
        continue;
      }
      this.model.close(r);
    }
  }

  @command('Open File')
  async openFile(arg?: Resource | string): Promise<void> {
    let uri: string | undefined;

    if (typeof arg === 'string') {
      if (!isUri(arg)) {
        uri = `file://${arg}`;
      } else {
        uri = arg;
      }
    } else {
      let resource = arg;

      if (!(resource instanceof Resource)) {
        resource = this.getSCMResource();
      }

      if (resource && resource.type !== Status.DELETED && resource.type !== Status.INDEX_DELETED) {
        uri = `file://${resource.resourceUri}`;
      }
    }

    if (!uri) {
      return;
    }

    const file: Acode.EditorFile = new EditorFile(Url.basename(uri), { uri });
    file.makeActive();

    if (localStorage.sidebarShown === '1') {
      acode.exec('toggle-sidebar');
    }
  }

  @command('Open File (HEAD)')
  async openHEADFile(arg?: Resource | string): Promise<void> {
    let resource: Resource | undefined = undefined;

    if (arg instanceof Resource) {
      resource = arg;
    } else if (typeof arg === 'string') {
      resource = this.getSCMResource(arg);
    } else {
      resource = this.getSCMResource();
    }

    if (!resource) {
      return;
    }

    const basename = Url.basename(resource.resourceUri);
    const title = `${basename} (HEAD)`;
    let HEAD: string | undefined = undefined;

    switch (resource.type) {
      case Status.INDEX_MODIFIED:
      case Status.INDEX_RENAMED:
      case Status.INTENT_TO_RENAME:
      case Status.TYPE_CHANGED:
        HEAD = toGitUri(resource.original, 'HEAD');
        break;

      case Status.MODIFIED:
        HEAD = toGitUri(resource.resourceUri, '~');
        break;

      case Status.DELETED_BY_US:
      case Status.DELETED_BY_THEM:
        HEAD = toGitUri(resource.resourceUri, '~1');
        break;

      default:
        break;
    }

    if (!HEAD) {
      acode.pushNotification('', `HEAD version of "${basename}" is not available.`, { type: 'warning' });
      return;
    }

    const file = new EditorFile(title, { uri: HEAD, editable: false });
    file.setMode(getModeForFile(basename!));

    if (localStorage.sidebarShown === '1') {
      acode.exec('toggle-sidebar');
    }
  }

  @command('Clone')
  async clone(url?: string, parentPath?: string, options?: { ref?: string }): Promise<void> {
    await this.cloneRepository(url, parentPath, options);
  }

  @command('Clone (Recursive)')
  async cloneRecursive(url?: string, parentPath?: string): Promise<void> {
    await this.cloneRepository(url, parentPath, { recursive: true });
  }

  @command('Initialize Repository')
  async init(skipFolderPrompt = false): Promise<void> {
    let repositoryPath: string | undefined = undefined;
    let repositoryUrl: string | undefined = undefined;
    let askToOpen = true;

    if (addedFolder.length > 0) {
      if (skipFolderPrompt && addedFolder.length === 1) {
        repositoryPath = uriToPath(addedFolder[0].url);
        repositoryUrl = addedFolder[0].url;
        askToOpen = false;
      } else {
        const items: { label: string, url?: string }[] = [
          ...addedFolder.map(folder => ({ label: folder.title, smallDescription: uriToPath(folder.url), url: folder.url })),
          { label: 'Choose Folder...' }
        ];
        const item = await showInputHints(items, { placeholder: 'Pick workspace folder to initialize git repo in' });
        if (!item) {
          return;
        } else if (item.url) {
          repositoryPath = uriToPath(item.url);
          repositoryUrl = item.url;
          askToOpen = false;
        }
      }
    }

    if (!repositoryPath || !repositoryUrl) {
      const folder = await fileBrowser('folder', 'Initialize Repository');
      if (!folder) return;

      repositoryPath = uriToPath(folder.url);
      repositoryUrl = folder.url as string;

      const confirmation = await confirm('Warning', `This will create a Git repository in "${repositoryPath}". Are you sure you want to continue?`)
      if (!confirmation) return;

      if (addedFolder.length && addedFolder.some(f => f.url === folder.url)) {
        askToOpen = false;
      }
    }

    const gitConfig = config.get('vcgit');
    const defaultBranchName = gitConfig?.defaultBranchName || 'main';
    const branchWhitespaceChar = gitConfig?.branchWhitespaceChar || '-';

    await this.git.init(repositoryPath, { defaultBranch: sanitizeBranchName(defaultBranchName, branchWhitespaceChar) });

    if (!askToOpen) {
      await this.model.openRepository(repositoryPath);
      return;
    }

    let message = 'Would you like to open the initialized repository?';
    if (addedFolder.length > 0) {
      message = 'Would you like to open the initialized repository, or add it to the current workspace?';
    }

    const confirmation = await confirm('Open Repository Folder', message);
    if (confirmation) {
      openFolder(repositoryUrl, { name: Url.basename(repositoryUrl)!, saveState: true });
    } else {
      await this.model.openRepository(repositoryPath);
    }
  }

  @command('Stage Changes')
  async stage(...resourceStates: SourceControlResourceState[]): Promise<void> {
    this.logger.debug(`[CommandCenter][stage] git.stage ${resourceStates.length} `);

    resourceStates = resourceStates.filter(r => !!r);

    if (resourceStates.length === 0) {
      const resource = this.getSCMResource();

      this.logger.debug(`[CommandCenter][stage] git.stage.getSCMResource ${resource ? resource.resourceUri : null} `);

      if (!resource) {
        return;
      }

      resourceStates = [resource];
    }

    const selection = resourceStates.filter(r => r instanceof Resource) as Resource[];
    const { resolved, unresolved, deletionConflicts } = await categorizeResourceByResolution(selection);

    if (unresolved.length > 0) {
      const messages = unresolved.length > 1
        ? `Are you sure you want to stage ${unresolved.length} files with merge conflicts?`
        : `Are you sure you want to stage ${Url.basename(unresolved[0].resourceUri)} with merge conflicts?`;
      const confirmation = await confirm('WARNING', messages);
      if (!confirmation) {
        return;
      }
    }

    await this.runByRepository(deletionConflicts.map(r => r.resourceUri), async (repository, resources) => {
      for (const resource of resources) {
        await this._stageDeletionConflict(repository, resource);
      }
    });

    const workingTree = selection.filter(s => s.resourceGroupType === ResourceGroupType.WorkingTree);
    const untracked = selection.filter(s => s.resourceGroupType === ResourceGroupType.Untracked);
    const scmResources = [...workingTree, ...untracked, ...resolved, ...unresolved];

    this.logger.debug(`[CommandCenter][stage] git.stage.scmResources ${scmResources.length} `);
    if (!scmResources.length) {
      return;
    }

    const resources = scmResources.map(r => r.resourceUri);
    await this.runByRepository(resources, async (repository, resources) => repository.add(resources));
  }

  @command('Stage All Changes', { repository: true })
  async stageAll(repository: Repository): Promise<void> {
    const resources = [...repository.workingTreeGroup.resourceStates, ...repository.untrackedGroup.resourceStates];
    const paths = resources.map(r => r.resourceUri);

    if (paths.length > 0) {
      const gitConfig = config.get('vcgit')!;
      const untrackedChanges = gitConfig.untrackedChanges;
      await repository.add(paths, untrackedChanges === 'mixed' ? undefined : { update: true });
    }
  }

  private async _stageDeletionConflict(repository: Repository, path: string): Promise<void> {
    const resource = repository.mergeGroup.resourceStates.filter(r => r.resourceUri === path)[0];

    if (!resource) {
      return;
    }

    if (resource.type === Status.DELETED_BY_THEM) {
      const keepIt = item('Keep Out Version');
      const deleteIt = item('Delete File');
      const result = await showDialogMessage('INFO', `File "${Url.basename(path)}" was deleted by them and modified by us.</br></br>What would you like to do?`, keepIt, deleteIt);

      if (result === keepIt) {
        await repository.add([path]);
      } else if (result === deleteIt) {
        await repository.rm([path]);
      } else {
        throw new Error('Cancelled');
      }
    } else if (resource.type === Status.DELETED_BY_US) {
      const keepIt = item('Keep Their Version');
      const deleteIt = item('Delete File');
      const result = await showDialogMessage('INFO', `File "${Url.basename(path)}" was deleted by us and modified by them.</br></br>What would you like to do?`, keepIt, deleteIt);

      if (result === keepIt) {
        await repository.add([path]);
      } else if (result === deleteIt) {
        await repository.rm([path]);
      } else {
        throw new Error('Cancelled');
      }
    }
  }

  @command('Stage All Tracked Changes', { repository: true })
  async stageAllTracked(repository: Repository): Promise<void> {
    const resources = repository.workingTreeGroup.resourceStates
      .filter(r => r.type !== Status.UNTRACKED && r.type !== Status.IGNORED);
    const paths = resources.map(r => r.resourceUri);

    await repository.add(paths);
  }

  @command('Stage All Untracked Changes', { repository: true })
  async stageAllUntracked(repository: Repository): Promise<void> {
    const resources = [...repository.workingTreeGroup.resourceStates, ...repository.untrackedGroup.resourceStates]
      .filter(r => r.type === Status.UNTRACKED || r.type === Status.IGNORED);
    const paths = resources.map(r => r.resourceUri);

    await repository.add(paths);
  }

  @command('Stage All Merge Changes', { repository: true })
  async stageAllMerge(repository: Repository): Promise<void> {
    const resources = repository.mergeGroup.resourceStates.filter(s => s instanceof Resource) as Resource[];
    const { merge, unresolved, deletionConflicts } = await categorizeResourceByResolution(resources);

    try {
      for (const deletionConflict of deletionConflicts) {
        await this._stageDeletionConflict(repository, deletionConflict.resourceUri);
      }
    } catch (err: any) {
      if (/Cancelled/.test(err.message)) {
        return;
      }

      throw err;
    }

    if (unresolved.length > 0) {
      const messages = unresolved.length > 1
        ? `Are you sure you want to stage ${merge.length} files with merge conflicts?`
        : `Are you sure you want to stage ${Url.basename(merge[0].resourceUri)} with merge conflicts?`;
      const confirmation = await confirm('WARNING', messages);
      if (!confirmation) {
        return;
      }
    }

    const paths = resources.map(r => r.resourceUri);

    if (paths.length > 0) {
      await repository.add(paths);
    }
  }

  @command('Unstage Changes')
  async unstage(...resourceStates: SourceControlResourceState[]): Promise<void> {
    resourceStates = resourceStates.filter(s => !!s);

    if (resourceStates.length === 0) {
      const resource = this.getSCMResource();

      if (!resource) {
        return;
      }

      resourceStates = [resource];
    }

    const scmResources = resourceStates
      .filter(s => s instanceof Resource && s.resourceGroupType === ResourceGroupType.Index) as Resource[];

    if (!scmResources.length) {
      return;
    }

    const resources = scmResources.map(r => r.resourceUri);
    await this.runByRepository(resources, async (repository, resources) => repository.revert(resources));
  }

  @command('Unstage All Changes', { repository: true })
  async unstageAll(repository: Repository): Promise<void> {
    await repository.revert([]);
  }

  @command('Discard Changes')
  async clean(...resourceStates: SourceControlResourceState[]): Promise<void> {
    // Remove duplicate resources
    const resourcePaths = new Set<string>();
    resourceStates = resourceStates.filter(s => {
      if (s === undefined) {
        return false;
      }

      if (resourcePaths.has(s.resourceUri.toString())) {
        return false;
      }

      resourcePaths.add(s.resourceUri.toString());
      return true;
    });

    if (resourceStates.length === 0) {
      const resource = this.getSCMResource();

      if (!resource) {
        return;
      }

      resourceStates = [resource];
    }

    const scmResources = resourceStates.filter(s => s instanceof Resource
      && (s.resourceGroupType === ResourceGroupType.WorkingTree || s.resourceGroupType === ResourceGroupType.Untracked)) as Resource[];

    if (!scmResources.length) {
      return;
    }

    await this._cleanAll(scmResources);
  }

  @command('Discard All Changes', { repository: true })
  async cleanAll(repository: Repository): Promise<void> {
    await this._cleanAll(repository.workingTreeGroup.resourceStates);
  }

  @command('Discard All Tracked Changes', { repository: true })
  async cleanAllTracked(repository: Repository): Promise<void> {
    const resources = repository.workingTreeGroup.resourceStates
      .filter(r => r.type !== Status.UNTRACKED && r.type !== Status.IGNORED);

    if (resources.length === 0) {
      return;
    }

    await this._cleanTrackedChanges(resources);
  }

  @command('Discard All Untracked Changes', { repository: true })
  async cleanAllUntracked(repository: Repository): Promise<void> {
    const resources = [...repository.workingTreeGroup.resourceStates, ...repository.untrackedGroup.resourceStates]
      .filter(r => r.type === Status.UNTRACKED || r.type === Status.IGNORED);

    if (resources.length === 0) {
      return;
    }

    await this._cleanUntrackedChanges(resources);
  }

  private async _cleanAll(resources: Resource[]): Promise<void> {
    if (resources.length === 0) {
      return;
    }

    const trackedResources = resources.filter(r => r.type !== Status.UNTRACKED && r.type !== Status.IGNORED);
    const untrackedResources = resources.filter(r => r.type === Status.UNTRACKED || r.type === Status.IGNORED);

    if (untrackedResources.length === 0) {
      // Tracked files only
      await this._cleanTrackedChanges(resources);
    } else if (trackedResources.length === 0) {
      // Untracked files only
      await this._cleanUntrackedChanges(resources);
    } else {
      // Tracked & Untracked files
      const [untrackedMessage] = this.getDiscardUntrackedChangesDialogDetails(untrackedResources);

      const trackedMessage = trackedResources.length === 1
        ? `\n\nAre you sure you want to discard changes in '${Url.basename(trackedResources[0].resourceUri)}'?`
        : `\n\nAre you sure you want to discard ALL changes in ${trackedResources.length} files?`;

      const confirmation = await confirm('WARNING', `${untrackedMessage} ${trackedMessage}\n\nThis is IRREVERSIBLE!\nYour current working set will be FOREVER LOST if you proceed.`);

      if (!confirmation) {
        return;
      }

      const items: Acode.SelectItem[] = [];

      if (trackedResources.length === 1) {
        items.push({ value: 'tracked', text: 'Discard 1 Tracked File' });
      } else {
        items.push({ value: 'tracked', text: `Discard All ${trackedResources.length} Tracked Files` });
      }
      items.push({ value: 'all', text: `Discard All ${resources.length} Files` });

      const result = await select('', items);

      if (result === 'tracked') {
        resources = trackedResources;
      } else if (result !== 'all') {
        return;
      }

      const resourcePaths = resources.map(r => r.resourceUri);
      await this.runByRepository(resourcePaths, async (repository, resources) => repository.clean(resources));
    }
  }

  private async _cleanTrackedChanges(resources: Resource[]): Promise<void> {
    const allResourcesDeleted = resources.every(r => r.type === Status.DELETED);

    const message = allResourcesDeleted
      ? resources.length === 1
        ? `Are you sure you want to restore '${Url.basename(resources[0].resourceUri)}'?`
        : `Are you sure you want to restore ALL ${resources.length} files?`
      : resources.length === 1
        ? `Are you sure you want to discard changes in '${Url.basename(resources[0].resourceUri)}'?`
        : `Are you sure you want to discard ALL changes in ${resources.length} files?\n\nThis is IRREVERSIBLE!\nYour current working set will be FOREVER LOST if you proceed.`;

    const confirmation = await confirm('WARNING', message);

    if (!confirmation) {
      return;
    }

    const resourcePaths = resources.map(r => r.resourceUri);
    await this.runByRepository(resourcePaths, async (repository, resources) => repository.clean(resources));
  }

  private async _cleanUntrackedChanges(resources: Resource[]): Promise<void> {
    const [message, action] = this.getDiscardUntrackedChangesDialogDetails(resources);
    const box = DialogBox(
      'WARNING',
      message,
      action,
      'cancel'
    );
    box.cancel(() => box.hide());
    box.ok(async () => {
      box.hide();

      const resourcePaths = resources.map(r => r.resourceUri);
      await this.runByRepository(resourcePaths, async (repository, resources) => repository.clean(resources));
    });
  }

  private getDiscardUntrackedChangesDialogDetails(resources: Resource[]): [string, string] {
    const messageWarning = resources.length === 1
      ? '\n\nThis is IRREVERSIBLE!\nThis file will be FOREVER LOST if you proceed.'
      : '\n\nThis is IRREVERSIBLE!\nThese files will be FOREVER LOST if you proceed.';

    const message = resources.length === 1
      ? `Are you sure you want to DELETE the following untracked file: '${Url.basename(resources[0].resourceUri)}'?${messageWarning}`
      : `Are you sure you want to DELETE the ${resources.length} files?${messageWarning}`;

    const action = resources.length === 1
      ? 'Delete File'
      : `Delete All ${resources.length} Files`;

    return [message, action];
  }

  private async smartCommit(
    repository: Repository,
    getCommitMessage: () => Promise<string | null>,
    opts: CommitOptions
  ): Promise<void> {
    const gitConfig = config.get('vcgit')!;
    let promptToSaveFilesBeforeCommit = gitConfig.promptToSaveFilesBeforeCommit;

    if (typeof promptToSaveFilesBeforeCommit === 'boolean') {
      promptToSaveFilesBeforeCommit = promptToSaveFilesBeforeCommit ? 'always' : 'never';
    }

    let enableSmartCommit = gitConfig.enableSmartCommit;
    let noStagedChanges = repository.indexGroup.resourceStates.length === 0;
    let noUnstagedChanges = repository.workingTreeGroup.resourceStates.length === 0;

    if (!opts.empty) {
      if (promptToSaveFilesBeforeCommit !== 'never') {
        let files = editorManager.files
          .filter(file => file.name !== 'untitled.txt' && file.isUnsaved && isDescendant(repository.root, uriToPath(file.uri)));

        if (promptToSaveFilesBeforeCommit === 'staged' || repository.indexGroup.resourceStates.length > 0) {
          files = files
            .filter(file => repository.indexGroup.resourceStates.some(s => pathEquals(s.resourceUri, uriToPath(file.uri))));
        }

        if (files.length > 0) {
          const message = files.length === 1
            ? `The following file has unsaved changes which won\'t be included in the commit if you proceed: ${Url.basename(files[0].uri)}. \n\nWould you like to save it before committing?`
            : `There are ${files.length} unsaved files.\n\nWould you like to save them before committing?`;
          const confirmation = await confirm('WARNING', message);

          if (!confirmation) {
            return;
          }

          const saveAndCommit = 'Save All & Commit Changes';
          const commit = 'Commit Changes';
          const selected = await select('', [saveAndCommit, commit]);

          if (selected === saveAndCommit) {
            await Promise.all(files.map(file => file.save()));

            // After saving the dirty documents, if there are any documents that are part of the
            // index group we have to add them back in order for the saved changes to be committed
            files = files.filter(file => repository.indexGroup.resourceStates.some(s => pathEquals(s.resourceUri, uriToPath(file.uri))));
            await repository.add(files.map(file => uriToPath(file.uri)));

            noStagedChanges = repository.indexGroup.resourceStates.length === 0;
            noUnstagedChanges = repository.workingTreeGroup.resourceStates.length === 0;
          } else if (selected !== commit) {
            return;
          }
        }
      }

      // no changes, and the user has not configured to commit all in this case
      if (!noUnstagedChanges && noStagedChanges && !enableSmartCommit && !opts.all && !opts.amend) {
        const suggestSmartCommit = gitConfig.suggestSmartCommit;

        if (!suggestSmartCommit) {
          return;
        }

        // prompt the user if we want to commit all or not
        const confirmation = await confirm('WARNING', 'There are no staged changes to commit.\n\nWould you like to stage all your changes and commit them directly?');

        if (confirmation) {
          enableSmartCommit = true;
        } else {
          return;
        }
      }

      // smart commit
      if (enableSmartCommit && !opts.all) {
        opts = { ...opts, all: noStagedChanges };
      }
    }

    if (gitConfig.useEditorAsCommitInput) {
      opts.useEditor = true;

      if (gitConfig.verboseCommit) {
        opts.verbose = true;
      }
    }

    const smartCommitChanges = gitConfig.smartCommitChanges;

    if (
      (
        // no changes
        (noStagedChanges && noUnstagedChanges)
        // or no staged changes and not `all`
        || (!opts.all && noStagedChanges)
        // no staged changes and no tracked unstaged changes
        || (noStagedChanges && smartCommitChanges === 'tracked' && repository.workingTreeGroup.resourceStates.every(r => r.type === Status.UNTRACKED))
      )
      // amend allows changing only the commit message
      && !opts.amend
      && !opts.empty
      // merge not in progress
      && !repository.mergeInProgress
      // rebase not in progress
      && repository.rebaseCommit === undefined
    ) {
      const confirmation = await confirm('INFO', 'There are no changes to commit. Create empty commit?');

      if (!confirmation) {
        return;
      }

      opts.empty = true;
    }

    if (opts.noVerify) {
      if (!gitConfig.allowNoVerifyCommit) {
        acode.pushNotification('ERROR', 'Commits without verification are not allowed, please enable them with the "git.allowNoVerifyCommit" setting.', { type: 'error' });
        return;
      }

      if (gitConfig.confirmNoVerifyCommit) {
        const confirmation = await confirm('WARNING', 'You are about to commit your changes without verification, this skips pre-commit hooks and can be undesirable.\n\nAre you sure to continue?');

        if (!confirmation) {
          return;
        }
      }
    }

    const message = await getCommitMessage();

    if (!message && !opts.amend && !opts.useEditor) {
      return;
    }

    if (opts.all && gitConfig.untrackedChanges !== 'mixed') {
      opts.all = 'tracked';
    }

    await repository.commit(message, opts);
  }

  private async commitWithAnyInput(repository: Repository, opts: CommitOptions): Promise<void> {
    const message = repository.inputBox.value;
    const gitConfig = config.get('vcgit')!;

    const getCommitMessage = async () => {
      let _message: string | null = message;

      if (!_message && !gitConfig.useEditorAsCommitInput) {

        if (opts && opts.amend && repository.HEAD && repository.HEAD.commit) {
          return null;
        }

        const branchName = repository.headShortName;
        let placeholder: string;

        if (branchName) {
          placeholder = `Message (commit on "${branchName}")`;
        } else {
          placeholder = 'Commit Message';
        }

        _message = await prompt('Commit Message', '', 'text', { placeholder, required: true });
      }

      return _message;
    };

    await this.smartCommit(repository, getCommitMessage, opts);
  }

  @command('Commit', { repository: true })
  async commit(repository: Repository): Promise<void> {
    await this.commitWithAnyInput(repository, {});
  }

  @command('Commit (Amend)', { repository: true })
  async commitAmend(repository: Repository): Promise<void> {
    await this.commitWithAnyInput(repository, { amend: true });
  }

  @command('Commit Staged', { repository: true })
  async commitStaged(repository: Repository): Promise<void> {
    await this.commitWithAnyInput(repository, { all: false });
  }

  @command('Commit Staged (Amend)', { repository: true })
  async commitStagedAmend(repository: Repository): Promise<void> {
    await this.commitWithAnyInput(repository, { all: false, amend: true });
  }

  @command('Commit All', { repository: true })
  async commitAll(repository: Repository): Promise<void> {
    await this.commitWithAnyInput(repository, { all: true });
  }

  @command('Commit All (Amend)', { repository: true })
  async commitAllAmend(repository: Repository): Promise<void> {
    await this.commitWithAnyInput(repository, { all: true, amend: true });
  }

  private async _commitEmpty(repository: Repository, noVerify?: boolean): Promise<void> {
    const gitConfig = config.get('vcgit')!;
    const shouldPrompt = gitConfig.confirmEmptyCommits;

    if (shouldPrompt) {
      const confirmation = await confirm('WARNING', 'Are you sure you want to create an empty commit?');
      if (!confirmation) {
        return;
      }
    }

    await this.commitWithAnyInput(repository, { empty: true, noVerify });
  }

  @command('Commit Empty', { repository: true })
  async commitEmpty(repository: Repository): Promise<void> {
    await this._commitEmpty(repository);
  }

  @command('Commit (No Verify)', { repository: true })
  async commitNoVerify(repository: Repository): Promise<void> {
    await this.commitWithAnyInput(repository, { noVerify: true });
  }

  @command('Commit (Amend, No Verify)', { repository: true })
  async commitAmendNoVerify(repository: Repository): Promise<void> {
    await this.commitWithAnyInput(repository, { amend: true, noVerify: true });
  }

  @command('Commit Staged (Amend, No Verify)', { repository: true })
  async commitStagedAmendNoVerify(repository: Repository): Promise<void> {
    await this.commitWithAnyInput(repository, { all: false, amend: true, noVerify: true });
  }

  @command('Commit All (No Verify)', { repository: true })
  async commitAllNoVerify(repository: Repository): Promise<void> {
    await this.commitWithAnyInput(repository, { all: true, noVerify: true });
  }

  @command('Commit All (Amend, No Verify)', { repository: true })
  async commitAllAmendNoVerify(repository: Repository): Promise<void> {
    await this.commitWithAnyInput(repository, { all: true, amend: true, noVerify: true });
  }

  @command('Commit Empty (No Verify)', { repository: true })
  async commitEmptyNoVerify(repository: Repository): Promise<void> {
    await this._commitEmpty(repository, true);
  }

  @command('Undo Last Commit', { repository: true })
  async undoCommit(repository: Repository): Promise<void> {
    const HEAD = repository.HEAD;

    if (!HEAD || !HEAD.commit) {
      acode.pushNotification('WARNING', 'Can\'t undo because HEAD doesn\'t point to any commit.', { type: 'warning' });
      return;
    }

    const commit = await repository.getCommit('HEAD');

    if (commit.parents.length > 1) {
      const confirmation = await confirm('WARNING', 'The last commit was a merge commit. Are you sure you want to undo it?');
      if (!confirmation) {
        return;
      }
    }

    if (commit.parents.length > 0) {
      await repository.reset('HEAD~');
    } else {
      await repository.deleteRef('HEAD');
      await this.unstageAll(repository);
    }

    repository.inputBox.value = commit.message;
  }

  @command('Checkout to...', { repository: true })
  async checkout(repository: Repository, treeish?: string): Promise<boolean> {
    return this._checkout(repository, { treeish });
  }

  @command('Checkout to (Detached)...', { repository: true })
  async checkoutDetached(repository: Repository, treeish?: string): Promise<boolean> {
    return this._checkout(repository, { detached: true, treeish });
  }

  private async _checkout(repository: Repository, opts?: { detached?: boolean; treeish?: string }): Promise<boolean> {
    if (typeof opts?.treeish === 'string') {
      await repository.checkout(opts?.treeish, opts);
      return true;
    }

    const createBranch = new CreateBranchItem();
    const createBranchFrom = new CreateBranchFromItem();
    const checkoutDetached = new CheckoutDetachedItem();
    let items: HintItem[] = [];

    if (!opts?.detached) {
      items.push(createBranch, createBranchFrom, checkoutDetached);
    }

    const placeholder = opts?.detached
      ? 'Select a branch to checkout in detached mode'
      : 'Select a branch or tag to checkout';
    const choice = await showInputHints(async () => {
      items.push(...await createCheckoutItems(repository, opts?.detached));
      return items;
    }, { placeholder });

    if (!choice) {
      return false;
    }

    if (choice === createBranch) {
      await this._branch(repository);
    } else if (choice === createBranchFrom) {
      await this._branch(repository, undefined, true);
    } else if (choice === checkoutDetached) {
      return this._checkout(repository, { detached: true });
    } else {
      const item = choice as CheckoutItem;

      try {
        await item.run(repository, opts);
      } catch (err: any) {
        if (err.gitErrorCode !== GitErrorCodes.DirtyWorkTree) {
          throw err;
        }

        const stash = 'Stash & Checkout';
        const migrate = 'Migrate Changes';
        const force = 'Force Checkout';

        const choice = await new Promise<string>((c) => {
          acode.alert('WARNING', 'Your local changes would be overwritten by checkout.', async () => {
            c(await select('', [stash, migrate, force]));
          });
        });

        if (choice === force) {
          await this.cleanAll(repository);
          await item.run(repository, opts);
        } else if (choice === stash || choice === migrate) {
          //TODO: handle stash
          acode.alert('INFO', 'not implemented');
        }
      }
    }

    return true;
  }

  @command('Create Branch...', { repository: true })
  async branch(repository: Repository): Promise<void> {
    await this._branch(repository, undefined, false);
  }

  @command('Create Branch From...', { repository: true })
  async branchFrom(repository: Repository): Promise<void> {
    await this._branch(repository, undefined, true);
  }

  private async promptForBranchName(repository: Repository, defaultName?: string, initialValue?: string): Promise<string> {
    const gitConfig = config.get('vcgit')!;
    const branchPrefix = gitConfig.branchPrefix;
    const branchWhitespaceChar = gitConfig.branchWhitespaceChar;
    const branchValidationRegex = gitConfig.branchValidationRegex;
    const refs = await repository.getRefs({ pattern: 'refs/heads' });

    if (defaultName) {
      return sanitizeBranchName(defaultName, branchWhitespaceChar);
    }

    const validateBranchName = (name: string): boolean => {
      const validateName = new RegExp(branchValidationRegex);
      const sanitizedName = sanitizeBranchName(name, branchWhitespaceChar);

      // Check if branch name already exists
      const existingBranch = refs.find(ref => ref.name === sanitizedName);
      if (existingBranch) {
        return false;
      }

      if (!validateName.test(sanitizedName)) {
        return false;
      }

      return true;
    }

    const options = {
      placeholder: 'Please provide a new branch name',
      required: true,
      match: new RegExp(branchValidationRegex),
      test: (value: string) => validateBranchName(value)
    } satisfies Acode.PromptOptions<string>;

    const branchName = await prompt('Branch Name', initialValue ?? branchPrefix, 'text', options);

    return sanitizeBranchName(branchName || '', branchWhitespaceChar);
  }

  private async _branch(repository: Repository, defaultName?: string, from = false, target?: string): Promise<void> {
    target = target ?? 'HEAD';

    const gitConfig = config.get('vcgit')!;
    const showRefDetails = gitConfig.showReferenceDetails;
    const commitShortHashLength = gitConfig.commitShortHashLength ?? 7;

    if (from) {
      const getRefHints = async () => {
        const refs = await repository.getRefs({ includeCommitDetails: showRefDetails });
        const refProcessors = new RefItemsProcessor(repository, [
          new RefProcessor(RefType.Head),
          new RefProcessor(RefType.RemoteHead),
          new RefProcessor(RefType.Tag)
        ]);

        return [new HEADItem(repository, commitShortHashLength), ...refProcessors.processRefs(refs)];
      }

      const choice = await showInputHints(getRefHints, { placeholder: 'Select a ref to create the branch from' });

      if (!choice) {
        return;
      }

      if (choice instanceof RefItem && choice.refName) {
        target = choice.refName;
      }
    }

    const branchName = await this.promptForBranchName(repository, defaultName);

    if (!branchName) {
      return;
    }

    await repository.branch(branchName, true, target);
  }

  @command('Delete Branch...', { repository: true })
  async deleteBranch(repository: Repository, name: string | undefined, force?: boolean): Promise<void> {
    await this._deleteBranch(repository, undefined, name, { remote: false, force });
  }

  @command('Delete Remote Branch...', { repository: true })
  async deleteRemoteBranch(repository: Repository): Promise<void> {
    await this._deleteBranch(repository, undefined, undefined, { remote: true });
  }

  private async _deleteBranch(repository: Repository, remote: string | undefined, name: string | undefined, options: { remote: boolean; force?: boolean }): Promise<void> {
    let run: (force?: boolean) => Promise<void>;

    const gitConfig = config.get('vcgit')!;
    const showRefDetails = gitConfig.showReferenceDetails;

    if (!options.remote && typeof name === 'string') {
      // Local branch
      run = force => repository.deleteBranch(name!, force);
    } else if (options.remote && typeof remote === 'string' && typeof name === 'string') {
      // Remote branch
      run = force => repository.deleteRemoteRef(remote, name!, { force });
    } else {
      const getBranchHints = async () => {
        const pattern = options.remote ? 'refs/remotes' : 'refs/heads';
        const refs = await repository.getRefs({ pattern, includeCommitDetails: showRefDetails });
        const processors = options.remote
          ? [new RefProcessor(RefType.RemoteHead, BranchDeleteItem)]
          : [new RefProcessor(RefType.Head, BranchDeleteItem)];

        const itemsProcessor = new RefItemsProcessor(repository, processors, {
          skipCurrentBranch: true,
          skipCurrentBranchRemote: true
        });

        return itemsProcessor.processRefs(refs);
      }

      const placeholder = !options.remote
        ? 'Select a branch to delete'
        : 'Select a remote branch to delete';
      const choice = await showInputHints(getBranchHints, { placeholder });

      if (!(choice instanceof BranchDeleteItem) || !choice.refName) {
        return;
      }
      name = choice.refName;
      run = force => choice.run(repository, force);
    }

    try {
      await run(options.force);
    } catch (err: any) {
      if (err.gitErrorCode !== GitErrorCodes.BranchNotFullyMerged) {
        throw err;
      }

      const message = `The branch "${name}" is not fully merged. Delete anyway?`;
      const yes = await confirm('WARNING', message);

      if (yes === true) {
        await run(true);
      }
    }
  }

  @command('Rename Branch...', { repository: true })
  async renameBranch(repository: Repository): Promise<void> {
    const currentBranchName = repository.HEAD && repository.HEAD.name;
    const branchName = await this.promptForBranchName(repository, undefined, currentBranchName);

    if (!branchName) {
      return;
    }

    try {
      await repository.renameBranch(branchName);
    } catch (err: any) {
      switch (err.gitErrorCode) {
        case GitErrorCodes.InvalidBranchName:
          acode.alert('ERROR', 'Invalid branch name');
          return;
        case GitErrorCodes.BranchAlreadyExists:
          acode.alert('ERROR', `A branch named "${branchName}" already exists`);
          return;
        default:
          throw err;
      }
    }
  }

  @command('Merge...', { repository: true })
  async merge(repository: Repository): Promise<void> {
    const gitConfig = config.get('vcgit')!;
    const showRefDetails = gitConfig.showReferenceDetails;

    const getHints = async (): Promise<HintItem[]> => {
      const refs = await repository.getRefs({ includeCommitDetails: showRefDetails });
      const itemsProcessor = new RefItemsProcessor(repository, [
        new RefProcessor(RefType.Head, MergeItem),
        new RefProcessor(RefType.RemoteHead, MergeItem),
        new RefProcessor(RefType.Tag, MergeItem)
      ], {
        skipCurrentBranch: true,
        skipCurrentBranchRemote: true
      });

      return itemsProcessor.processRefs(refs);
    }

    const choice = await showInputHints(getHints, { placeholder: 'Select a branch or tag to merge from' });

    if (choice instanceof MergeItem) {
      await choice.run(repository);
    }
  }

  @command('Abort Merge', { repository: true })
  async mergeAbort(repository: Repository): Promise<void> {
    await repository.mergeAbort();
  }

  @command('Rebase Branch...', { repository: true })
  async rebase(repository: Repository): Promise<void> {
    const gitConfig = config.get('vcgit')!;
    const showRefDetails = gitConfig.showReferenceDetails;
    const commitShortHashLength = gitConfig.commitShortHashLength;

    const getHints = async (): Promise<HintItem[]> => {
      const refs = await repository.getRefs({ includeCommitDetails: showRefDetails });
      const itemsProcessor = new RefItemsProcessor(repository, [
        new RefProcessor(RefType.Head, RebaseItem),
        new RefProcessor(RefType.RemoteHead, RebaseItem)
      ], {
        skipCurrentBranch: true,
        skipCurrentBranchRemote: true
      });

      const hintItems = itemsProcessor.processRefs(refs);

      if (repository.HEAD?.upstream) {
        const upstreamRef = refs.find(ref => ref.type === RefType.RemoteHead &&
          ref.name === `${repository.HEAD!.upstream!.remote}/${repository.HEAD!.upstream!.name}`);

        if (upstreamRef) {
          hintItems.splice(0, 0, new RebaseUpstreamItem(upstreamRef, commitShortHashLength))
        }
      }

      return hintItems;
    }

    const choice = await showInputHints(getHints, { placeholder: 'Select a branch to rebase onto' });

    if (choice instanceof RebaseItem) {
      await choice.run(repository);
    }
  }

  @command('Create Tag...', { repository: true })
  async createTag(repository: Repository): Promise<void> {
    const data: any = await multiPrompt('Create Tag', [
      { id: 'name', placeholder: 'Please provide a tag name', required: true },
      { id: 'message', placeholder: 'Please provide a message to annotate the tag', required: true }
    ], '');

    if (!data) {
      return;
    }

    const inputTagName = data.name;
    const inputMessage = data.message;

    if (!inputTagName) {
      return;
    }

    const name = inputTagName.replace(/^\.|\/\.|\.\.|~|\^|:|\/$|\.lock$|\.lock\/|\\|\*|\s|^\s*$|\.$/g, '-');
    await repository.tag({ name, message: inputMessage });
  }

  @command('Delete Tag...', { repository: true })
  async deleteTag(repository: Repository): Promise<void> {
    const gitConfig = config.get('vcgit')!;
    const showRefDetails = gitConfig.showReferenceDetails;
    const commitShortHashLength = gitConfig.commitShortHashLength;

    const tagHints = async (): Promise<TagDeleteItem[] | HintItem[]> => {
      const remoteTags = await repository.getRefs({ pattern: 'refs/tags', includeCommitDetails: showRefDetails });
      return remoteTags.length === 0
        ? [{ label: 'ⓘ This repository has no tags' }]
        : remoteTags.map(ref => new TagDeleteItem(ref, commitShortHashLength));
    }

    const choice = await showInputHints(tagHints, { placeholder: 'Select a tag to delete' });

    if (choice instanceof TagDeleteItem) {
      await choice.run(repository);
    }
  }

  @command('Delete Remote Tag...', { repository: true })
  async deleteRemoteTag(repository: Repository): Promise<void> {
    const gitConfig = config.get('vcgit')!;
    const commitShortHashLength = gitConfig.commitShortHashLength;

    const remoteHints = repository.remotes
      .filter(r => r.pushUrl !== undefined)
      .map(r => new RemoteItem(repository, r));

    if (remoteHints.length === 0) {
      acode.pushNotification('', 'Your repository has no remotes configured to push to.', { type: 'error' });
      return;
    }

    let remoteName = remoteHints[0].remoteName;
    if (remoteHints.length > 1) {
      const remoteHint = await showInputHints(remoteHints, { placeholder: 'Select a remote to delete a tag from' });

      if (!remoteHint) {
        return;
      }

      remoteName = remoteHint.remoteName;
    }

    const remoteTagHints = async (): Promise<RemoteTagDeleteItem[] | HintItem[]> => {
      const remoteTagsRaw = await repository.getRemoteRefs(remoteName, { tags: true });

      // Deduplicate annotated and lightweight tags
      const remoteTagNames = new Set<string>();
      const remoteTags: Ref[] = [];

      for (const tag of remoteTagsRaw) {
        const tagName = (tag.name ?? '').replace(/\^{}$/, '');
        if (!remoteTagNames.has(tagName)) {
          remoteTags.push({ ...tag, name: tagName });
          remoteTagNames.add(tagName);
        }
      }

      return remoteTags.length === 0
        ? [{ label: `ⓘ Remote "${remoteName}" has no tags.` }]
        : remoteTags.map(ref => new RemoteTagDeleteItem(ref, commitShortHashLength));
    }

    const remoteTagHint = await showInputHints(remoteTagHints, { placeholder: 'Select a remote tag to delete' });

    if (remoteTagHint instanceof RemoteTagDeleteItem) {
      await remoteTagHint.run(repository, remoteName);
    }
  }

  @command('Fetch', { repository: true })
  async fetch(repository: Repository): Promise<void> {
    if (repository.remotes.length === 0) {
      acode.pushNotification('', 'This repository has no remotes configured to fetch from.', { type: 'warning' });
      return;
    }

    if (repository.remotes.length === 1) {
      await repository.fetchDefault();
      return;
    }

    const remoteItems: RemoteItem[] = repository.remotes.map(r => new RemoteItem(repository, r));

    if (repository.HEAD?.upstream?.remote) {
      // Move default remote to the top
      const defaultRemoteIndex = remoteItems
        .findIndex(r => r.remoteName === repository.HEAD!.upstream!.remote);

      if (defaultRemoteIndex !== -1) {
        remoteItems.splice(0, 0, ...remoteItems.splice(defaultRemoteIndex, 1));
      }
    }

    const remoteItem = await showInputHints(remoteItems, { placeholder: 'Select a remote to fetch' });

    if (!remoteItem) {
      return;
    }

    await remoteItem.run();
  }

  @command('Fetch (Prune)', { repository: true })
  async fetchPrune(repository: Repository): Promise<void> {
    if (repository.remotes.length === 0) {
      acode.pushNotification('', 'This repository has no remotes configured to fetch from.', { type: 'warning' });
      return;
    }

    await repository.fetchPrune();
  }

  @command('Fetch From All Remotes', { repository: true })
  async fetchAll(repository: Repository): Promise<void> {
    if (repository.remotes.length === 0) {
      acode.pushNotification('', 'This repository has no remotes configured to fetch from.', { type: 'warning' });
      return;
    }

    await repository.fetchAll();
  }

  @command('Pull', { repository: true })
  async pull(repository: Repository): Promise<void> {
    const remotes = repository.remotes;

    if (remotes.length === 0) {
      acode.pushNotification('', 'Your repository has no remotes configured to pull from.', { type: 'warning' });
      return;
    }

    await repository.pull(repository.HEAD);
  }

  @command('Pull (Rebase)', { repository: true })
  async pullRebase(repository: Repository): Promise<void> {
    const remotes = repository.remotes;

    if (remotes.length === 0) {
      acode.pushNotification('', 'Your repository has no remotes configured to pull from.', { type: 'warning' });
      return;
    }

    await repository.pullWithRebase(repository.HEAD);
  }

  private async _push(repository: Repository, pushOptions: PushOptions) {
    const remotes = repository.remotes;

    if (remotes.length === 0) {
      if (pushOptions.silent) {
        return;
      }

      acode.pushNotification('', 'Your repository has no remotes configured to push to.', { type: 'warning' });
      return;
    }

    const gitConfig = config.get('vcgit')!;
    let forcePushMode: ForcePushMode | undefined = undefined;

    if (pushOptions.forcePush) {
      if (!gitConfig.allowForcePush) {
        acode.alert('ERROR', 'Force push is not allowed, please enable it with the "git.allowForcePush" setting.');
        return;
      }

      const useForcePushWithLease = gitConfig.useForcePushWithLease;
      const useForcePushIfIncludes = gitConfig.useForcePushIfIncludes;
      forcePushMode = useForcePushWithLease ? useForcePushIfIncludes ? ForcePushMode.ForceWithLeaseIfIncludes : ForcePushMode.ForceWithLease : ForcePushMode.Force;

      if (gitConfig.confirmForcePush) {
        const message = 'You are about to force push your changes, this can be destructive and could inadvertently overwrite changes made by others.\n\nAre you sure to continue?';
        const confirmation = await confirm('WARNING', message);

        if (!confirmation) {
          return;
        }
      }
    }

    if (pushOptions.pushType === PushType.PushFollowTags) {
      await repository.pushFollowTags(undefined, forcePushMode);
      return;
    }

    if (pushOptions.pushType === PushType.PushTags) {
      await repository.pushTags(undefined, forcePushMode);
    }

    if (!repository.HEAD || !repository.HEAD.name) {
      if (!pushOptions.silent) {
        acode.pushNotification('', 'Please check out a branch to push to a remote.', { type: 'warning' });
      }
      return;
    }

    if (pushOptions.pushType === PushType.Push) {
      try {
        await repository.push(repository.HEAD, forcePushMode);
      } catch (err: any) {
        if (err.gitErrorCode !== GitErrorCodes.NoUpstreamBranch) {
          throw err;
        }

        if (pushOptions.silent) {
          return;
        }

        const branchName = repository.HEAD.name;
        const message = `The branch "${branchName}" has no remote branch. Would you like to publish this branch?`;
        const confirmation = await confirm('WARNING', message);

        if (confirmation === true) {
          await this.publish(repository);
        }
      }
    } else {
      const branchName = repository.HEAD.name;
      if (!pushOptions.pushTo?.remote) {
        const addRemote = new AddRemoteItem(this);
        const hints = [...remotes.filter(r => r.pushUrl !== undefined).map(r => ({ label: r.name, smallDescription: r.pushUrl })), addRemote];
        const placeholder = `Pick a remote to publish the branch "${branchName}" to:`;
        const choice = await showInputHints(hints, { placeholder });

        if (!choice) {
          return;
        }

        if (choice === addRemote) {
          const newRemote = await this.addRemote(repository);

          if (newRemote) {
            await repository.pushTo(newRemote, branchName, undefined, forcePushMode);
          }
        } else {
          await repository.pushTo(choice.label, branchName, undefined, forcePushMode);
        }
      } else {
        await repository.pushTo(pushOptions.pushTo.remote, pushOptions.pushTo.refspec || branchName, pushOptions.pushTo.setUpstream, forcePushMode);
      }
    }
  }

  @command('Push', { repository: true })
  async push(repository: Repository): Promise<void> {
    await this._push(repository, { pushType: PushType.Push });
  }

  @command('Push (Force)', { repository: true })
  async pushForce(repository: Repository): Promise<void> {
    await this._push(repository, { pushType: PushType.Push, forcePush: true });
  }

  @command('Push (Follow Tags)', { repository: true })
  async pushFollowTags(repository: Repository): Promise<void> {
    await this._push(repository, { pushType: PushType.PushFollowTags });
  }

  @command('Push (Follow Tags, Force)', { repository: true })
  async pushFollowTagsForce(repository: Repository): Promise<void> {
    await this._push(repository, { pushType: PushType.PushFollowTags, forcePush: true });
  }

  @command('Push To...', { repository: true })
  async pushTo(repository: Repository, remote?: string, refspec?: string, setUpstream?: boolean): Promise<void> {
    await this._push(repository, { pushType: PushType.PushTo, pushTo: { remote: remote, refspec: refspec, setUpstream: setUpstream } });
  }

  @command('Push To... (Force)', { repository: true })
  async pushToForce(repository: Repository, remote?: string, refspec?: string, setUpstream?: boolean): Promise<void> {
    await this._push(repository, { pushType: PushType.PushTo, pushTo: { remote: remote, refspec: refspec, setUpstream: setUpstream }, forcePush: true });
  }

  @command('Push Tags', { repository: true })
  async pushTags(repository: Repository): Promise<void> {
    await this._push(repository, { pushType: PushType.PushTags });
  }

  @command('Add Remote...', { repository: true })
  async addRemote(repository: Repository): Promise<string | undefined> {
    const data: any = await multiPrompt('Add Remote', [
      {
        id: 'url',
        type: 'url',
        placeholder: 'Please provide a repository URL',
        required: true
      },
      {
        id: 'name',
        type: 'text',
        placeholder: 'Please provide a remote name',
        required: true
      }
    ], '');

    if (typeof data !== 'object') {
      return;
    }

    const { url, name: resultName } = data;

    if (!url) {
      return;
    }

    const name = sanitizeRemoteName(resultName || '');

    if (!name) {
      return;
    }

    await repository.addRemote(name, url);
    await repository.fetch({ remote: name });
    return name;
  }

  @command('Remove Remote...', { repository: true })
  async removeRemote(repository: Repository): Promise<void> {
    const remotes = repository.remotes;

    if (remotes.length === 0) {
      acode.pushNotification('', 'Your repository has no remotes.', { type: 'error' });
      return;
    }

    const hints: RemoteItem[] = repository.remotes.map(remote => new RemoteItem(repository, remote));

    const remote = await showInputHints(hints, { placeholder: 'Select a remote to remove' });

    if (!remote) {
      return;
    }

    await repository.removeRemote(remote.remoteName);
  }

  private async _sync(repository: Repository, rebase: boolean): Promise<void> {
    const HEAD = repository.HEAD;

    if (!HEAD) {
      return;
    } else if (!HEAD.upstream) {
      this._push(repository, { pushType: PushType.Push });
      return;
    }

    const remoteName = HEAD.remote || HEAD.upstream.remote;
    const remote = repository.remotes.find(r => r.name === remoteName);
    const isReadonly = remote && remote.isReadOnly;

    const gitConfig = config.get('vcgit')!;
    const shouldPrompt = !isReadonly && gitConfig.confirmSync;

    if (shouldPrompt) {
      const message = `This action will pull and push commits from and to "${HEAD.upstream.remote}/${HEAD.upstream.name}".`;
      const confirmation = await confirm('WARNING', message);

      if (!confirmation) {
        return;
      }
    }

    await repository.sync(HEAD, rebase);
  }

  @command('Sync', { repository: true })
  async sync(repository: Repository): Promise<void> {
    const gitConfig = config.get('vcgit')!;
    const rebase = gitConfig.rebaseWhenSync;

    await this._sync(repository, rebase);
  }

  @command('Publish Branch...', { repository: true })
  async publish(repository: Repository): Promise<void> {
    const branchName = repository.HEAD && repository.HEAD.name || '';
    const remotes = repository.remotes;

    if (remotes.length === 0) {
      const publishers = this.model.getRemoteSourcePublishers();

      if (publishers.length === 0) {
        acode.pushNotification('', 'Your repository has no remotes configured to publish to.', { type: 'warning' });
        return;
      }

      let publisher: RemoteSourcePublisher;

      if (publishers.length === 1) {
        publisher = publishers[0];
      } else {
        const hints = publishers
          .map((provider) => ({ label: provider.name, icon: provider.icon, provider }));

        const choice = await showInputHints(hints, { placeholder: `Pick a provider to publish the branch "${branchName}" to:` });

        if (!choice) {
          return;
        }

        publisher = choice.provider;
      }

      await publisher.publishRepository(new ApiRepository(repository));
      this.model.firePublishEvent(repository, branchName);
      return;
    }

    if (remotes.length === 1) {
      await repository.pushTo(remotes[0].name, branchName, true);
      this.model.firePublishEvent(repository, branchName);

      return;
    }

    const addRemote = new AddRemoteItem(this);
    const hints = [...repository.remotes.map(r => ({ label: r.name, smallDescription: r.pushUrl, value: r.pushUrl })), addRemote];
    const choice = await showInputHints(hints, { placeholder: `Pick a provider to publish the branch "${branchName}" to:` });

    if (!choice) {
      return;
    }

    if (choice === addRemote) {
      const newRemote = await this.addRemote(repository);

      if (newRemote) {
        await repository.pushTo(newRemote, branchName, true);

        this.model.firePublishEvent(repository, branchName);
      }
    } else {
      await repository.pushTo(choice.label, branchName, true);

      this.model.firePublishEvent(repository, branchName);
    }
  }

  private getSCMResource(path?: string): Resource | undefined {
    path = path ? path : uriToPath(editorManager.activeFile.uri);

    this.logger.debug(`[CommandCenter][getSCMResource] git.getSCMResource.uri: ${path}`);

    for (const r of this.model.repositories.map(r => r.root)) {
      this.logger.debug(`[CommandCenter][getSCMResource] repo root: ${r}`);
    }

    if (!path) {
      return undefined;
    }

    const repository = this.model.getRepository(path);
    if (!repository) {
      return undefined;
    }

    return repository.workingTreeGroup.resourceStates.filter(r => r.resourceUri === path)[0]
      || repository.indexGroup.resourceStates.filter(r => r.resourceUri === path)[0]
      || repository.mergeGroup.resourceStates.filter(r => r.resourceUri === path)[0];
  }

  private runByRepository<T>(resource: string, fn: (repository: Repository, resource: string) => Promise<T>): Promise<T[]>;
  private runByRepository<T>(resources: string[], fn: (repository: Repository, resources: string[]) => Promise<T>): Promise<T[]>;
  private async runByRepository<T>(arg: string | string[], fn: (repository: Repository, resources: any) => Promise<T>): Promise<T[]> {
    const resources = typeof arg === 'string' ? [arg] : arg;
    const isSingleResource = typeof arg === 'string';

    const groups = resources.reduce((result, resource) => {
      let repository = this.model.getRepository(resource);

      if (!repository) {
        console.warn('Could not find git repository for ', resource);
        return result;
      }

      // Could it be a submodule?
      if (pathEquals(resource, repository.root)) {
        repository = this.model.getRepositoryForSubmodule(resource) || repository;
      }

      const tuple = result.filter(p => p.repository === repository)[0];

      if (tuple) {
        tuple.resources.push(resource);
      } else {
        result.push({ repository, resources: [resource] });
      }

      return result;
    }, [] as { repository: Repository, resources: string[] }[]);

    const promises = groups
      .map(({ repository, resources }) => fn(repository as Repository, isSingleResource ? resources[0] : resources));

    return Promise.all(promises);
  }

  @command('Show Output')
  showOutput(): void {
    this.logger.show();
  }

  @command('Clear Git Output')
  clearGitOutput(): void {
    this.logger.clear();
  }

  @command('Close Git Output')
  closeGitOutput(): void {
    this.logger.hide();
  }

  private createCommand(key: string, method: Function, options: ScmCommandOptions): (...args: any[]) => any {
    const result = (...args: any[]) => {
      let result: Promise<any>;

      if (!options.repository) {
        result = Promise.resolve(method.apply(this, args));
      } else {
        const repository = this.model.getRepository(args[0]);
        let repositoryPromise: Promise<Repository | undefined>;

        if (repository) {
          repositoryPromise = Promise.resolve(repository);
        } else {
          repositoryPromise = this.model.pickRepository();
        }

        result = repositoryPromise.then(repository => {
          if (!repository) {
            return Promise.resolve();
          }

          return Promise.resolve(method.apply(this, [repository, ...args.slice(1)]));
        });
      }

      return result.catch(err => {
        if (typeof err === 'undefined') {
          return;
        }

        let message: string;
        let alert = true;
        let type: 'error' | 'warning' | 'info' = 'error';

        switch (err.gitErrorCode) {
          case GitErrorCodes.DirtyWorkTree:
            message = 'Please clean your repository working tree before checkout.';
            break;
          case GitErrorCodes.PushRejected:
            message = 'Can\'t push refs to remote. Try running "Pull" first to integrate your changes.';
            break;
          case GitErrorCodes.ForcePushWithLeaseRejected:
          case GitErrorCodes.ForcePushWithLeaseIfIncludesRejected:
            message = 'Can\'t force push refs to remote. The tip of the remote-tracking branch has been updated since the last checkout. Try running "Pull" first to pull the latest changes from the remote branch first.';
            break;
          case GitErrorCodes.Conflict:
            message = 'There are merge conflicts. Please resolve them before committing your changes.';
            type = 'warning';
            alert = false;
            break;
          case GitErrorCodes.AuthenticationFailed: {
            const regex = /Authentication failed for '(.*)'/i;
            const match = regex.exec(err.stderr || String(err));
            message = match
              ? `Failed to authenticate to git remote: ${match[1]}`
              : 'Failed to authenticate to git remote.';
            break;
          }
          case GitErrorCodes.NoUserNameConfigured:
          case GitErrorCodes.NoUserEmailConfigured:
            message = 'Make sure you configure your "user.name" and "user.email" in git.';
            break;
          case GitErrorCodes.EmptyCommitMessage:
            message = 'Commit operation was cancelled due to empty commit message.';
            type = 'info';
            alert = false;
            break;
          default: {
            const hint = (err.stderr || err.message || String(err))
              .replace(/^error: /mi, '')
              .replace(/^> husky.*$/mi, '')
              .split(/[\r\n]/)
              .filter((line: string) => !!line)
            [0];

            message = hint ? `Git: ${hint}` : 'Git error';
            break;
          }
        }

        if (!message) {
          console.error(err);
          return;
        }

        if (alert) {
          this.showError(type, message);
        } else {
          acode.pushNotification('', message, { type });
        }
      });
    };

    // patch this object, so people can call methods directly
    (this as Record<string, unknown>)[key] = result;

    return result;
  }

  private showError(type: 'error' | 'warning' | 'info', message: string): void {
    switch (type) {
      case 'error':
        acode.alert('ERROR', message);
        break;
      case "warning":
        acode.alert('WARNING', message);
        break;
      case "info":
        acode.alert('INFO', message);
    }
  }

  dispose(): void {
    this.disposables = Disposable.dispose(this.disposables);
  }
}
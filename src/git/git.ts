import { Disposable, IDisposable } from "../base/disposable";
import { Emitter, Event } from "../base/event";
import { config, ConfigurationChangeEvent } from "../base/config";
import * as process from '../base/executor';
import { isUri, uriToPath } from "../base/uri";
import { Commit as ApiCommit, RefQuery as ApiRefQuery, Branch, CommitOptions, ForcePushMode, GitErrorCodes, LogOptions, Ref, RefType, Remote } from "./api/git";
import { LogOutputChannel } from "./logger";
import { assign, groupBy, isAbsolute, isDescendant, Limiter, Mutable, pathEquals, relativePath, resolve, splitInChunks, toFullPath, Versions } from "./utils";

const fs = acode.require('fs');
const Url = acode.require('Url');

const MAX_CLI_LENGTH = 30000;

export interface IGit {
  path: string;
  version: string;
}

export interface IDotGit {
  readonly path: string;
  readonly commonPath?: string;
  readonly superProjectPath?: string;
}

export interface IFileStatus {
  x: string;
  y: string;
  path: string;
  rename?: string;
}

interface MutableRemote extends Remote {
  fetchUrl?: string;
  pushUrl?: string;
  isReadOnly: boolean;
}

export async function findGit(): Promise<IGit> {
  try {
    const path = await Executor.execute('which git', true);
    const version = await Executor.execute('git --version', true);
    return { path: path.trim(), version: version.trim().replace(/^git version /, '') };
  } catch (err) {
    throw new Error('Git installation not found.');
  }
}

interface IExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SpawnOptions extends process.SpawnOptions {
  onSpawn?: (childProcess: process.Process) => void;
}

async function exec(process: process.Process): Promise<IExecutionResult> {
  const disposables: IDisposable[] = [];

  const on = (event: any, name: string, fn: (...args: any[]) => void) => {
    event.on(name, fn);
    disposables.push(Disposable.toDisposable(() => event.off(name, fn)));
  }

  const result = Promise.all<any>([
    new Promise<number>((c, e) => {
      process.on('error', e);
      process.on('close', c);
      disposables.push(Disposable.toDisposable(() => process.off('close', c)));
    }),
    new Promise<string>(c => {
      const result: string[] = [];
      on(process.stdout, 'data', (data: string) => result.push(data));
      on(process.stdout, 'close', () => c(result.join('\n')));
    }),
    new Promise<string>(c => {
      const result: string[] = [];
      on(process.stderr, 'data', (data: string) => result.push(data));
      on(process.stderr, 'close', () => c(result.join('\n')));
    })
  ]) as Promise<[number, string, string]>;

  try {
    const [exitCode, stdout, stderr] = await result;
    return { exitCode, stdout, stderr };
  } finally {
    Disposable.dispose(disposables);
  }
}

interface IGitErrorData {
  error?: Error;
  message?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  gitErrorCode?: string;
  gitCommand?: string;
  gitArgs?: string[];
}

export class GitError extends Error {

  error?: Error;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  gitErrorCode?: string;
  gitCommand?: string;
  gitArgs?: string[];

  constructor(data: IGitErrorData) {
    super(data.error?.message || data.message || 'Git error');

    this.error = data.error;
    this.stdout = data.stdout;
    this.stderr = data.stderr;
    this.exitCode = data.exitCode;
    this.gitErrorCode = data.gitErrorCode;
    this.gitCommand = data.gitCommand;
    this.gitArgs = data.gitArgs;
  }

  override toString(): string {
    let result = this.message + ' ' + JSON.stringify({
      exitCode: this.exitCode,
      gitErrorCode: this.gitErrorCode,
      gitCommand: this.gitCommand,
      stdout: this.stdout,
      stderr: this.stderr
    }, null, 2);

    if (this.error?.stack) {
      result += this.error.stack;
    }

    return result;
  }
}

interface IGitOptions {
  gitPath: string;
  version: string;
  env?: { [key: string]: string };
  shell?: string;
}

function getGitErrorCode(stderr: string): string | undefined {
  if (/Another git process seems to be running in this repository|If no other git process is currently running/.test(stderr)) {
    return GitErrorCodes.RepositoryIsLocked;
  } if (/Authentication failed/i.test(stderr)) {
    return GitErrorCodes.AuthenticationFailed;
  } else if (/Not a git repository/i.test(stderr)) {
    return GitErrorCodes.NotAGitRepository;
  } else if (/Repository not found/.test(stderr)) {
    return GitErrorCodes.RepositoryNotFound;
  } else if (/bad config file/.test(stderr)) {
    return GitErrorCodes.BadConfigFile;
  } else if (/Couldn\'t find remote ref/.test(stderr)) {
    return GitErrorCodes.NoRemoteReference;
  } else if (/A branch named '.+' already exists/.test(stderr)) {
    return GitErrorCodes.BranchAlreadyExists;
  } else if (/'.+' is not a valid branch name/.test(stderr)) {
    return GitErrorCodes.InvalidBranchName;
  } else if (/detected dubious ownership in repository at/.test(stderr)) {
    return GitErrorCodes.NotASafeGitRepository;
  } else if (/contains modified or untracked files|use --force to delete it/.test(stderr)) {
    return GitErrorCodes.WorktreeContainsChanges;
  } else if (/fatal: '[^']+' already exists/.test(stderr)) {
    return GitErrorCodes.WorktreeAlreadyExists;
  } else if (/is already used by worktree at/.test(stderr)) {
    return GitErrorCodes.WorktreeBranchAlreadyUsed;
  }
  return undefined;
}

interface InitOptions {
  defaultBranch?: string;
}

function sanitizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/');
}

const COMMIT_FORMAT = '%H%n%aN%n%aE%n%at%n%ct%n%P%n%D%n%B';

export interface ICloneOptions {
  readonly parentPath: string;
  readonly recursive?: boolean;
  readonly ref?: string;
  onProgress?: (data: string) => void;
}

export class Git {
  readonly path: string;
  readonly version: string;
  readonly env: { [key: string]: string };
  readonly shell: string | undefined;

  private commandsToLog: string[] = [];

  private _onOutput = new Emitter<string>();
  readonly onOutput: Event<string> = this._onOutput.event;

  constructor(options: IGitOptions) {
    this.path = options.gitPath;
    this.version = options.version;
    this.env = options.env || {};
    this.shell = options.shell;

    const onConfigurationChanged = (e: ConfigurationChangeEvent) => {
      if (!e.affectsConfiguration('vcgit.commandsToLog')) {
        return;
      }

      const gitConfig = config.get('vcgit');
      this.commandsToLog = gitConfig?.commandsToLog || [];
    };

    config.onDidChangeConfiguration(onConfigurationChanged, this);
  }

  compareGitVersionTo(version: string): -1 | 0 | 1 {
    return Versions.compare(Versions.fromString(this.version), Versions.fromString(version));
  }

  open(repositoryRoot: string, repositoryRootRealPath: string | undefined, dotGit: IDotGit, logger: LogOutputChannel): Repository {
    return new Repository(this, repositoryRoot, repositoryRootRealPath, dotGit, logger);
  }

  async init(repository: string, options: InitOptions = {}): Promise<void> {
    const args = ['init'];

    if (options.defaultBranch && options.defaultBranch !== '' && this.compareGitVersionTo('2.28.0') !== -1) {
      args.push('-b', options.defaultBranch);
    }

    await this.exec(repository, args);
  }

  async clone(url: string, options: ICloneOptions): Promise<string> {
    const baseFolderName = decodeURI(url).replace(/[\/]+$/, '').replace(/^.*[\/\\]/, '').replace(/\.git$/, '') || 'repository';
    const folderName = baseFolderName;
    const folderPath = Url.join(options.parentPath, folderName);

    const onSpawn = (proc: process.Process) => {
      proc.on('data', (data) => {
        const lines = data.split('\n');
        lines.forEach(line => options.onProgress?.(line));
      });
    };

    try {
      const command = ['clone', url.includes(' ') ? encodeURI(url) : url, folderPath, '--progress'];
      if (options.recursive) {
        command.push('--recursive');
      }
      if (options.ref) {
        command.push('--branch', options.ref);
      }
      await this.exec(options.parentPath, command, { onSpawn });
    } catch (err: any) {
      if (err.stderr) {
        err.stderr = err.stderr.replace(/^Cloning.+$/m, '').trim();
        err.stderr = err.stderr.replace(/^ERROR:\s+/, '').trim();
      }

      throw err;
    }

    return folderPath;
  }

  async getRepositoryRoot(pathInsidePossibleRepository: string): Promise<string> {
    const result = await this.exec(pathInsidePossibleRepository, ['rev-parse', '--show-toplevel']);

    const repositoryRootPath = toFullPath(result.stdout.trimStart().replace(/[\r\n]+$/, ''));

    // Handle symbolic links and UNC paths
    // Git 2.31 added the `--path-format` flag to rev-parse which
    // allows us to get the relative path of the repository root
    if (!pathEquals(pathInsidePossibleRepository, repositoryRootPath) &&
      !isDescendant(repositoryRootPath, pathInsidePossibleRepository) &&
      !isDescendant(pathInsidePossibleRepository, repositoryRootPath) &&
      this.compareGitVersionTo('2.31.0') !== -1) {
      const relativePathResult = await this.exec(pathInsidePossibleRepository, ['rev-parse', '--path-format=relative', '--show-toplevel']);
      return resolve(pathInsidePossibleRepository, relativePathResult.stdout.trimStart().replace(/[\r\n]+$/, ''));
    }

    return repositoryRootPath;
  }

  async getRepositoryDotGit(repositoryPath: string): Promise<IDotGit> {
    let dotGitPath: string | undefined, commonDotGitPath: string | undefined, superProjectPath: string | undefined;

    const args = ['rev-parse', '--git-dir', '--git-common-dir'];
    if (this.compareGitVersionTo('2.13.0') >= 0) {
      args.push('--show-superproject-working-tree');
    }

    const result = await this.exec(repositoryPath, args);
    [dotGitPath, commonDotGitPath, superProjectPath] = result.stdout.split('\n').map(r => r.trim());

    if (!dotGitPath.startsWith('/')) {
      dotGitPath = Url.join(repositoryPath, dotGitPath);
    }

    if (commonDotGitPath) {
      if (!commonDotGitPath.startsWith('/')) {
        commonDotGitPath = Url.join(repositoryPath, commonDotGitPath);
      }
    }

    return {
      path: dotGitPath,
      commonPath: commonDotGitPath !== dotGitPath ? commonDotGitPath : undefined,
      superProjectPath: superProjectPath ? superProjectPath : undefined
    };
  }

  async exec(cwd: string, args: string[], options: SpawnOptions = {}): Promise<IExecutionResult> {
    options = assign({ cwd }, options || {});
    return await this._exec(args, options);
  }

  stream(cwd: string, args: string[], options: SpawnOptions = {}): process.Process {
    options = assign({ cwd }, options || {});
    const process = this.spawn(args, options);

    const startTime = Date.now();
    process.on('close', (_) => {
      this.log(`> git ${args.join(' ')} [${Date.now() - startTime}ms]`)
    });

    return process;
  }

  private async _exec(args: string[], options: SpawnOptions = {}): Promise<IExecutionResult> {
    const process = this.spawn(args, options);

    options.onSpawn?.(process);

    const startExec = Date.now();
    const result = await exec(process);

    this.log(`> git ${args.join(' ')} [${Date.now() - startExec}ms]`);

    if (result.stdout.length > 0 && args.find(a => this.commandsToLog.includes(a))) {
      this.log(result.stdout);
    }

    if (result.stderr.length > 0) {
      this.log(result.stderr);
    }

    if (result.exitCode) {
      return Promise.reject<IExecutionResult>(new GitError({
        message: 'Failed to execute git',
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        gitErrorCode: getGitErrorCode(result.stderr),
        gitCommand: args[0],
        gitArgs: args
      }));
    }

    return result;
  }

  spawn(args: string[], options: SpawnOptions = {}): process.Process {
    if (!this.path) {
      throw new Error('git could not be found in the system.');
    }

    if (!options) {
      options = {};
    }

    if (options.alpine !== false) {
      options.alpine = true;
    }

    if (!options.shell && this.shell) {
      options.shell = this.shell;
    }

    options.env = assign({}, this.env, options.env || {}, {
      ACODE_GIT_COMMANDS: args[0],
      GIT_PAGER: 'cat'
    });

    const cwd = this.getCwd(options);
    if (cwd) {
      options.cwd = cwd;
    }

    return process.spawn(this.path, args, options);
  }

  private getCwd(options: SpawnOptions): string | undefined {
    const cwd = options.cwd;
    if (typeof cwd === 'undefined') return cwd;

    if (isUri(cwd)) {
      return uriToPath(cwd);
    }

    return undefined;
  }

  private log(output: string): void {
    this._onOutput.fire(output);
  }
}

export interface CommitShortStat {
  readonly files: number;
  readonly insertions: number;
  readonly deletions: number;
}

export interface Commit {
  hash: string;
  message: string;
  parents: string[];
  authorDate?: Date;
  authorName?: string;
  authorEmail?: string;
  commitDate?: Date;
  refNames: string[];
  shortStat?: CommitShortStat;
}

export interface RefQuery extends ApiRefQuery {
  readonly includeCommitDetails?: boolean;
}

interface GitConfigSection {
  name: string;
  subSectionName?: string;
  properties: { [key: string]: string };
}

class GitConfigParser {

  private static readonly _lineSeparator = /\r?\n/;

  private static readonly _propertyRegex = /^\s*(\w+)\s*=\s*"?([^"]+)"?$/;
  private static readonly _sectionRegex = /^\s*\[\s*([^\]]+?)\s*(\"[^"]+\")*\]\s*$/;

  static parse(raw: string): GitConfigSection[] {
    const config: { sections: GitConfigSection[] } = { sections: [] };
    let section: GitConfigSection = { name: 'DEFAULT', properties: {} };

    const addSection = (section?: GitConfigSection) => {
      if (!section) { return; }
      config.sections.push(section);
    };

    for (const line of raw.split(GitConfigParser._lineSeparator)) {
      // Section
      const sectionMatch = line.match(GitConfigParser._sectionRegex);
      if (sectionMatch?.length === 3) {
        addSection(section);
        section = { name: sectionMatch[1], subSectionName: sectionMatch[2]?.replaceAll('"', ''), properties: {} };

        continue;
      }

      // Property
      const propertyMatch = line.match(GitConfigParser._propertyRegex);
      if (propertyMatch?.length === 3 && !Object.keys(section.properties).includes(propertyMatch[1])) {
        section.properties[propertyMatch[1]] = propertyMatch[2];
      }
    }

    addSection(section);

    return config.sections;
  }
}

class GitStatusParser {

  private lastRaw = '';
  private result: IFileStatus[] = [];

  get status(): IFileStatus[] {
    return this.result;
  }

  update(raw: string): void {
    let i = 0;
    let nextI: number | undefined;

    raw = this.lastRaw + raw;

    while ((nextI = this.parseEntry(raw, i)) !== undefined) {
      i = nextI;
    }

    this.lastRaw = raw.substr(i);
  }

  private parseEntry(raw: string, i: number): number | undefined {
    // hack
    if (raw[i + 2] !== ' ') {
      raw = ' ' + raw;
    }

    if (i + 4 >= raw.length) {
      return;
    }

    let lastIndex: number;
    const entry: IFileStatus = {
      x: raw.charAt(i++),
      y: raw.charAt(i++),
      rename: undefined,
      path: ''
    };

    // space
    i++;

    if (entry.x === 'R' || entry.y === 'R' || entry.x === 'C') {
      lastIndex = raw.indexOf('\0', i);

      if (lastIndex === -1) {
        return;
      }

      entry.rename = raw.substring(i, lastIndex);
      i = lastIndex + 1;
    }

    lastIndex = raw.indexOf('\0', i);

    if (lastIndex === -1) {
      return;
    }

    entry.path = raw.substring(i, lastIndex);

    // If path ends with slash, it must be a nested git repo
    if (entry.path[entry.path.length - 1] !== '/') {
      this.result.push(entry);
    }

    return lastIndex + 1;
  }
}

export interface Submodule {
  name: string;
  path: string;
  url: string;
}

export function parseGitmodules(raw: string): Submodule[] {
  const result: Submodule[] = [];

  for (const submoduleSection of GitConfigParser.parse(raw).filter(s => s.name === 'submodule')) {
    if (submoduleSection.subSectionName && submoduleSection.properties['path'] && submoduleSection.properties['url']) {
      result.push({
        name: submoduleSection.subSectionName,
        path: submoduleSection.properties['path'],
        url: submoduleSection.properties['url']
      });
    }
  }

  return result;
}

export function parseGitRemotes(raw: string): MutableRemote[] {
  const remotes: MutableRemote[] = [];

  for (const remoteSection of GitConfigParser.parse(raw).filter(s => s.name === 'remote')) {
    if (remoteSection.subSectionName) {
      remotes.push({
        name: remoteSection.subSectionName,
        fetchUrl: remoteSection.properties['url'],
        pushUrl: remoteSection.properties['pushurl'] ?? remoteSection.properties['url'],
        isReadOnly: false
      });
    }
  }

  return remotes;
}

const commitRegex = /([0-9a-f]{40})\n(.*)\n(.*)\n(.*)\n(.*)\n(.*)\n(.*)(?:\n([^]*?))?(?:\x00)(?:\n((?:.*)files? changed(?:.*))$)?/gm;

export function parseGitCommits(data: string): Commit[] {
  const commits: Commit[] = [];

  let ref;
  let authorName;
  let authorEmail;
  let authorDate;
  let commitDate;
  let parents;
  let refNames;
  let message;
  let shortStat;
  let match;

  do {
    match = commitRegex.exec(data);
    if (match === null) {
      break;
    }

    [, ref, authorName, authorEmail, authorDate, commitDate, parents, refNames, message, shortStat] = match;

    if (message[message.length - 1] === '\n') {
      message = message.substr(0, message.length - 1);
    }

    // Stop excessive memory usage by using substr -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
    commits.push({
      hash: ` ${ref}`.substr(1),
      message: ` ${message}`.substr(1),
      parents: parents ? parents.split(' ') : [],
      authorDate: new Date(Number(authorDate) * 1000),
      authorName: ` ${authorName}`.substr(1),
      authorEmail: ` ${authorEmail}`.substr(1),
      commitDate: new Date(Number(commitDate) * 1000),
      refNames: refNames.split(',').map(s => s.trim()),
      shortStat: shortStat ? parseGitDiffShortStat(shortStat) : undefined
    });
  } while (true);

  return commits;
}

const diffShortStatRegex = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/;

function parseGitDiffShortStat(data: string): CommitShortStat {
  const matches = data.trim().match(diffShortStatRegex);

  if (!matches) {
    return { files: 0, insertions: 0, deletions: 0 };
  }

  const [, files, insertions = undefined, deletions = undefined] = matches;
  return { files: parseInt(files), insertions: parseInt(insertions ?? '0'), deletions: parseInt(deletions ?? '0') };
}

const REFS_FORMAT = '%(refname)%00%(objectname)%00%(*objectname)';
const REFS_WITH_DETAILS_FORMAT = `${REFS_FORMAT}%00%(parent)%00%(*parent)%00%(authorname)%00%(*authorname)%00%(committerdate:unix)%00%(*committerdate:unix)%00%(subject)%00%(*subject)`;

function parseRefs(data: string): (Ref | Branch)[] {
  const refRegex = /^(refs\/[^\0]+)\0([0-9a-f]{40})\0([0-9a-f]{40})?(?:\0(.*))?$/gm;

  const headRegex = /^refs\/heads\/([^ ]+)$/;
  const remoteHeadRegex = /^refs\/remotes\/([^/]+)\/([^ ]+)$/;
  const tagRegex = /^refs\/tags\/([^ ]+)$/;
  const statusRegex = /\[(?:ahead ([0-9]+))?[,\s]*(?:behind ([0-9]+))?]|\[gone]/;

  let ref: string | undefined;
  let commitHash: string | undefined;
  let tagCommitHash: string | undefined;
  let details: string | undefined;
  let commitParents: string | undefined;
  let tagCommitParents: string | undefined;
  let commitSubject: string | undefined;
  let tagCommitSubject: string | undefined;
  let authorName: string | undefined;
  let tagAuthorName: string | undefined;
  let committerDate: string | undefined;
  let tagCommitterDate: string | undefined;
  let status: string | undefined;

  const refs: (Ref | Branch)[] = [];

  let match: RegExpExecArray | null;
  let refMatch: RegExpExecArray | null;

  do {
    match = refRegex.exec(data);
    if (match === null) {
      break;
    }

    [, ref, commitHash, tagCommitHash, details] = match;
    [commitParents, tagCommitParents, authorName, tagAuthorName, committerDate, tagCommitterDate, commitSubject, tagCommitSubject, status] = details?.split('\0') ?? [];

    const parents = tagCommitParents || commitParents;
    const subject = tagCommitSubject || commitSubject;
    const author = tagAuthorName || authorName;
    const date = tagCommitterDate || committerDate;

    const commitDetails = parents && subject && author && date
      ? {
        hash: commitHash,
        message: subject,
        parents: parents.split(' '),
        authorName: author,
        commitDate: date ? new Date(Number(date) * 1000) : undefined,
      } satisfies ApiCommit : undefined;

    if (refMatch = headRegex.exec(ref)) {
      const [, aheadCount, behindCount] = statusRegex.exec(status) ?? [];
      const ahead = status ? aheadCount ? Number(aheadCount) : 0 : undefined;
      const behind = status ? behindCount ? Number(behindCount) : 0 : undefined;
      refs.push({ name: refMatch[1], commit: commitHash, commitDetails, ahead, behind, type: RefType.Head });
    } else if (refMatch = remoteHeadRegex.exec(ref)) {
      const name = `${refMatch[1]}/${refMatch[2]}`;
      refs.push({ name, remote: refMatch[1], commit: commitHash, commitDetails, type: RefType.RemoteHead });
    } else if (refMatch = tagRegex.exec(ref)) {
      refs.push({ name: refMatch[1], commit: tagCommitHash ?? commitHash, commitDetails, type: RefType.Tag });
    }
  } while (true);

  return refs;
}

export interface PullOptions {
  readonly unshallow?: boolean;
  readonly tags?: boolean;
  readonly autoStash?: boolean;
}

export class Repository {
  private _isUsingRefTable = false;

  constructor(
    private _git: Git,
    private repositoryRoot: string,
    private repositoryRootRealPath: string | undefined,
    readonly dotGit: IDotGit,
    private logger: LogOutputChannel
  ) {

  }

  get git(): Git {
    return this._git;
  }

  get root(): string {
    return this.repositoryRoot;
  }

  get rootRealPath(): string | undefined {
    return this.repositoryRootRealPath;
  }

  async exec(args: string[], options: SpawnOptions = {}): Promise<IExecutionResult> {
    return await this.git.exec(this.repositoryRoot, args, options);
  }

  stream(args: string[], options: SpawnOptions = {}): process.Process {
    return this.git.stream(this.repositoryRoot, args, options);
  }

  spawn(args: string[], options: SpawnOptions = {}): process.Process {
    return this.git.spawn(args, options);
  }

  async config(command: string, scope: string, key: string, value: any = null, options: SpawnOptions = {}): Promise<string> {
    const args = ['config', `--${command}`];

    if (scope) {
      args.push(`--${scope}`);
    }

    args.push(key);

    if (value) {
      args.push(value);
    }

    try {
      const result = await this.exec(args, options);
      return result.stdout.trim();
    }
    catch (err: any) {
      this.logger.warn(`[Git][config] git config failed: ${err.message}`);
      return '';
    }
  }

  async getConfigs(scope: string): Promise<{ key: string; value: string }[]> {
    const args = ['config'];

    if (scope) {
      args.push('--' + scope);
    }

    args.push('-l');

    const result = await this.exec(args);
    const lines = result.stdout.trim().split(/\r|\r\n|\n/);

    return lines.map(entry => {
      const equalsIndex = entry.indexOf('=');
      return { key: entry.substr(0, equalsIndex), value: entry.substr(equalsIndex + 1) };
    });
  }

  async log(options?: LogOptions): Promise<Commit[]> {
    const args = ['log', `--format=${COMMIT_FORMAT}`, '-z'];

    if (options?.shortStats) {
      args.push('--shortstat');

      if (this._git.compareGitVersionTo('2.31') !== -1) {
        args.push('--diff-merges=first-parent');
      }
    }

    if (options?.reverse) {
      args.push('--reverse', '--ancestry-path');
    }

    if (options?.sortByAuthorDate) {
      args.push('--author-date-order');
    }

    if (options?.range) {
      args.push(options.range);
    } else {
      args.push(`-n${options?.maxEntries ?? 32}`);
    }

    if (options?.author) {
      args.push(`--author=${options.author}`);
    }

    if (options?.grep) {
      args.push(`--grep=${options.grep}`);
      args.push('--extended-regexp');
      args.push('--regexp-ignore-case');
    }

    if (typeof options?.maxParents === 'number') {
      args.push(`--max-parents=${options.maxParents}`);
    }

    if (typeof options?.skip === 'number') {
      args.push(`--skip=${options.skip}`);
    }

    if (options?.refNames) {
      // args.push('--topo-order');
      // args.push('--decorate=full');

      // spawnOptions.input = options.refNames.join('\n');
      // args.push('--stdin');
      //TODO
    }

    if (options?.path) {
      args.push('--', options.path);
    }

    const result = await this.exec(args);
    if (result.exitCode) {
      // An empty repo
      return [];
    }

    return parseGitCommits(result.stdout);
  }

  async apply(patch: string, reverse?: boolean): Promise<void> {
		const args = ['apply', patch];

		if (reverse) {
			args.push('-R');
		}

		try {
			await this.exec(args);
		} catch (err: any) {
			if (/patch does not apply/.test(err.stderr)) {
				err.gitErrorCode = GitErrorCodes.PatchDoesNotApply;
			}

			throw err;
		}
	}

  async add(paths: string[], opts?: { update?: boolean }): Promise<void> {
    const args = ['add'];

    if (opts && opts.update) {
      args.push('-u');
    } else {
      args.push('-A');
    }

    if (paths && paths.length) {
      for (const chunk of splitInChunks(paths.map(p => this.sanitizeRelativePath(p)), MAX_CLI_LENGTH)) {
        await this.exec([...args, '--', ...chunk]);
      }
    } else {
      await this.exec([...args, '--', '.']);
    }
  }
  
  async rm(paths: string[]): Promise<void> {
		const args = ['rm', '--'];

		if (!paths || !paths.length) {
			return;
		}

		args.push(...paths.map(p => this.sanitizeRelativePath(p)));

		await this.exec(args);
	}

  async checkout(treeish: string, paths: string[], opts: { track?: boolean; detached?: boolean } = Object.create(null)): Promise<void> {
    const args = ['checkout', '-q'];

    if (opts.track) {
      args.push('--track');
    }

    if (opts.detached) {
      args.push('--detach');
    }

    if (treeish) {
      args.push(treeish);
    }

    try {
      if (paths && paths.length > 0) {
        for (const chunk of splitInChunks(paths.map(p => this.sanitizeRelativePath(p)), MAX_CLI_LENGTH)) {
          await this.exec([...args, '--', ...chunk]);
        }
      } else {
        await this.exec(args);
      }
    } catch (err: any) {
      if (/Please,? commit your changes or stash them/.test(err.stderr || '')) {
        err.gitErrorCode = GitErrorCodes.DirtyWorkTree;
        err.gitTreeish = treeish;
      } else if (/You are on a branch yet to be born/.test(err.stderr || '')) {
        err.gitErrorCode = GitErrorCodes.BranchNotYetBorn;
      }

      throw err;
    }
  }

  async commit(message: string | null | undefined, opts: CommitOptions = Object.create(null)): Promise<void> {
    const args = ['commit', '--quiet'];
    const options: SpawnOptions = {};

    if (message) {
      // options.input = message; // Error SpawnOptions tidak memiliki .input (Apakah bisa dibuat?)
      args.push('-m', message);
    }

    if (opts.verbose) {
      args.push('--verbose');
    }

    if (opts.all) {
      args.push('--all');
    }

    if (opts.amend) {
      args.push('--amend');
    }

    if (!opts.useEditor) {
      if (!message) {
        if (opts.amend) {
          args.push('--no-edit');
        } else {
          args.push('-m', '');
        }
      }

      args.push('--allow-empty-message');
    }

    if (opts.signoff) {
      args.push('--signoff');
    }

    if (opts.signCommit) {
      args.push('-S');
    }

    if (opts.empty) {
      args.push('--allow-empty');
    }

    if (opts.noVerify) {
      args.push('--no-verify');
    }

    if (opts.requireUserConfig ?? true) {
      // Stops git from guessing at user/email
      args.splice(0, 0, '-c', 'user.useConfigOnly=true');
    }

    try {
      await this.exec(args, options);
    } catch (commitErr) {
      await this.handleCommitError(commitErr);
    }
  }

  async rebaseContinue(): Promise<void> {
    const args = ['rebase', '--continue'];

    try {
      await this.exec(args, { env: { GIT_EDITOR: 'true' } });
    } catch (commitErr) {
      await this.handleCommitError(commitErr);
    }
  }

  private async handleCommitError(commitErr: any): Promise<void> {
    if (/not possible because you have unmerged files/.test(commitErr.stderr || '')) {
      commitErr.gitErrorCode = GitErrorCodes.UnmergedChanges;
      throw commitErr;
    } else if (/Aborting commit due to empty commit message/.test(commitErr.stderr || '')) {
      commitErr.gitErrorCode = GitErrorCodes.EmptyCommitMessage;
      throw commitErr;
    }

    try {
      await this.exec(['config', '--get-all', 'user.name']);
    } catch (err: any) {
      err.gitErrorCode = GitErrorCodes.NoUserNameConfigured;
      throw err;
    }

    try {
      await this.exec(['config', '--get-all', 'user.email']);
    } catch (err: any) {
      err.gitErrorCode = GitErrorCodes.NoUserEmailConfigured;
      throw err;
    }

    throw commitErr;
  }

  async branch(name: string, checkout: boolean, ref?: string): Promise<void> {
    const args = checkout ? ['checkout', '-q', '-b', name, '--no-track'] : ['branch', '-q', name];

    if (ref) {
      args.push(ref);
    }

    await this.exec(args);
  }

  async deleteBranch(name: string, force?: boolean): Promise<void> {
    const args = ['branch', force ? '-D' : '-d', name];
    await this.exec(args);
  }

  async renameBranch(name: string): Promise<void> {
    const args = ['branch', '-m', name];
    await this.exec(args);
  }

  async setBranchUpstream(name: string, upstream: string): Promise<void> {
    const args = ['branch', '--set-upstream-to', upstream, name];
    await this.exec(args);
  }

  async deleteRef(ref: string): Promise<void> {
    const args = ['update-ref', '-d', ref];
    await this.exec(args);
  }

  async merge(ref: string): Promise<void> {
    const args = ['merge', ref];

    try {
      await this.exec(args);
    } catch (err: any) {
      if (/^CONFLICT /m.test(err.stdout || '')) {
        err.gitErrorCode = GitErrorCodes.Conflict;
      }

      throw err;
    }
  }

  async mergeAbort(): Promise<void> {
    await this.exec(['merge', '--abort']);
  }

  async tag(options: { name: string; message?: string; ref?: string }): Promise<void> {
    let args = ['tag'];

    if (options.message) {
      args = [...args, '-a', options.name, '-m', options.message];
    } else {
      args = [...args, options.name];
    }

    if (options.ref) {
      args.push(options.ref);
    }

    await this.exec(args);
  }

  async deleteTag(name: string): Promise<void> {
    const args = ['tag', '-d', name];
    await this.exec(args);
  }

  async reset(treeish: string, hard: boolean = false): Promise<void> {
    const args = ['reset', hard ? '--hard' : '--soft', treeish];
    await this.exec(args);
  }

  async revert(treeish: string, paths: string[]): Promise<void> {
    const result = await this.exec(['branch']);
    let args: string[];

    // In case there are no branches, we must use rm --cached
    if (!result.stdout) {
      args = ['rm', '--cached', '-r'];
    } else {
      args = ['reset', '-q', treeish];
    }

    try {
      if (paths && paths.length > 0) {
        for (const chunk of splitInChunks(paths.map(p => this.sanitizeRelativePath(p)), MAX_CLI_LENGTH)) {
          await this.exec([...args, '--', ...chunk]);
        }
      } else {
        await this.exec([...args, '--', '.']);
      }
    } catch (err: any) {
      // In case there are merge conflicts to be resolved, git reset will output
      // some "needs merge" data. We try to get around that.
      if (/([^:]+: needs merge\n)+/m.test(err.stdout || '')) {
        return;
      }

      throw err;
    }
  }

  async addRemote(name: string, url: string): Promise<void> {
    const args = ['remote', 'add', name, url];
    await this.exec(args);
  }

  async removeRemote(name: string): Promise<void> {
    const args = ['remote', 'remove', name];
    await this.exec(args);
  }

  async renameRemote(name: string, newName: string): Promise<void> {
		const args = ['remote', 'rename', name, newName];
		await this.exec(args);
	}

  async deleteRemoteRef(remoteName: string, refName: string, options?: { force?: boolean }): Promise<void> {
    const args = ['push', remoteName, '--delete'];

    if (options?.force) {
      args.push('--force');
    }

    args.push(refName);
    await this.exec(args);
  }

  async clean(paths: string[]): Promise<void> {
    const pathsByGroup = groupBy(paths, p => Url.dirname(p));
    const groups = Object.keys(pathsByGroup).map(k => pathsByGroup[k]);

    const limiter = new Limiter(5);
    const promises: Promise<any>[] = [];
    const args = ['clean', '-f', '-q'];

    for (const paths of groups) {
      for (const chunk of splitInChunks(paths.map(p => this.sanitizeRelativePath(p)), MAX_CLI_LENGTH)) {
        promises.push(limiter.queue(() => this.exec([...args, '--', ...chunk])));
      }
    }

    await Promise.all(promises);
  }

  async fetch(options: { remote?: string; ref?: string; all?: boolean; prune?: boolean; depth?: number; silent?: boolean; } = {}): Promise<void> {
    const args = ['fetch'];
    const spawnOptions: SpawnOptions = {};

    if (options.remote) {
      args.push(options.remote);

      if (options.ref) {
        args.push(options.ref);
      }
    } else if (options.all) {
      args.push('--all');
    }

    if (options.prune) {
      args.push('--prune');
    }

    if (typeof options.depth === 'number') {
      args.push(`--depth=${options.depth}`);
    }

    if (options.silent) {
      spawnOptions.env!['ACODE_GIT_FETCH_SILENT'] = 'true';
    }

    try {
      await this.exec(args);
    } catch (err: any) {
      if (/No remote repository specified\./.test(err.stderr || '')) {
        err.gitErrorCode = GitErrorCodes.NoRemoteRepositorySpecified;
      } else if (/Could not read from remote repository/.test(err.stderr || '')) {
        err.gitErrorCode = GitErrorCodes.RemoteConnectionError;
      } else if (/! \[rejected\].*\(non-fast-forward\)/m.test(err.stderr || '')) {
        // The local branch has outgoing changes and it cannot be fast-forwarded.
        err.gitErrorCode = GitErrorCodes.BranchFastForwardRejected;
      }

      throw err;
    }
  }

  async fetchTags(options: { remote: string; tags: string[]; force?: boolean }): Promise<void> {
    const args = ['fetch'];

    args.push(options.remote);

    for (const tag of options.tags) {
      args.push(`refs/tags/${tag}:refs/tags/${tag}`);
    }

    if (options.force) {
      args.push('--force');
    }

    await this.exec(args);
  }

  async pull(rebase?: boolean, remote?: string, branch?: string, options: PullOptions = {}): Promise<void> {
    const args = ['pull'];

    if (options.tags) {
      args.push('--tags');
    }

    if (options.unshallow) {
      args.push('--unshallow');
    }

    // --auto-stash option is only available `git pull --merge` starting with git 2.27.0
    if (options.autoStash && this._git.compareGitVersionTo('2.27.0') !== -1) {
      args.push('--autostash');
    }

    if (rebase) {
      args.push('-r');
    }

    if (remote && branch) {
      args.push(remote);
      args.push(branch);
    }

    try {
      await this.exec(args);
    } catch (err: any) {
      if (/^CONFLICT \([^)]+\): \b/m.test(err.stdout || '')) {
        err.gitErrorCode = GitErrorCodes.Conflict;
      } else if (/Please tell me who you are\./.test(err.stderr || '')) {
        err.gitErrorCode = GitErrorCodes.NoUserNameConfigured;
      } else if (/Could not read from remote repository/.test(err.stderr || '')) {
        err.gitErrorCode = GitErrorCodes.RemoteConnectionError;
      } else if (/Pull(?:ing)? is not possible because you have unmerged files|Cannot pull with rebase: You have unstaged changes|Your local changes to the following files would be overwritten|Please, commit your changes before you can merge/i.test(err.stderr)) {
        err.stderr = err.stderr.replace(/Cannot pull with rebase: You have unstaged changes/i, 'Cannot pull with rebase, you have unstaged changes');
        err.gitErrorCode = GitErrorCodes.DirtyWorkTree;
      } else if (/cannot lock ref|unable to update local ref/i.test(err.stderr || '')) {
        err.gitErrorCode = GitErrorCodes.CantLockRef;
      } else if (/cannot rebase onto multiple branches/i.test(err.stderr || '')) {
        err.gitErrorCode = GitErrorCodes.CantRebaseMultipleBranches;
      } else if (/! \[rejected\].*\(would clobber existing tag\)/m.test(err.stderr || '')) {
        err.gitErrorCode = GitErrorCodes.TagConflict;
      }

      throw err;
    }
  }

  async rebase(branch: string): Promise<void> {
    const args = ['rebase'];

    args.push(branch);

    try {
      await this.exec(args);
    } catch (err: any) {
      if (/^CONFLICT \([^)]+\): \b/m.test(err.stdout || '')) {
        err.gitErrorCode = GitErrorCodes.Conflict;
      } else if (/cannot rebase onto multiple branches/i.test(err.stderr || '')) {
        err.gitErrorCode = GitErrorCodes.CantRebaseMultipleBranches;
      }

      throw err;
    }
  }

  async push(remote?: string, name?: string, setUpstream: boolean = false, followTags = false, forcePushMode?: ForcePushMode, tags = false): Promise<void> {
    const args = ['push'];

    if (forcePushMode === ForcePushMode.ForceWithLease || forcePushMode === ForcePushMode.ForceWithLeaseIfIncludes) {
      args.push('--force-with-lease');
      if (forcePushMode === ForcePushMode.ForceWithLeaseIfIncludes && this._git.compareGitVersionTo('2.30') !== -1) {
        args.push('--force-if-includes');
      }
    } else if (forcePushMode === ForcePushMode.Force) {
      args.push('--force');
    }

    if (setUpstream) {
      args.push('-u');
    }

    if (followTags) {
      args.push('--follow-tags');
    }

    if (tags) {
      args.push('--tags');
    }

    if (remote) {
      args.push(remote);
    }

    if (name) {
      args.push(name);
    }

    try {
      await this.exec(args);
    } catch (err: any) {
      if (/^error: failed to push some refs to\b/m.test(err.stderr || '')) {
        if (forcePushMode === ForcePushMode.ForceWithLease && /! \[rejected\].*\(stale info\)/m.test(err.stderr || '')) {
          err.gitErrorCode = GitErrorCodes.ForcePushWithLeaseRejected;
        } else if (forcePushMode === ForcePushMode.ForceWithLeaseIfIncludes && /! \[rejected\].*\(remote ref updated since checkout\)/m.test(err.stderr || '')) {
          err.gitErrorCode = GitErrorCodes.ForcePushWithLeaseIfIncludesRejected;
        } else {
          err.gitErrorCode = GitErrorCodes.PushRejected;
        }
      } else if (/Permission.*denied/.test(err.stderr || '')) {
        err.gitErrorCode = GitErrorCodes.PermissionDenied;
      } else if (/Could not read from remote repository/.test(err.stderr || '')) {
        err.gitErrorCode = GitErrorCodes.RemoteConnectionError;
      } else if (/^fatal: The current branch .* has no upstream branch/.test(err.stderr || '')) {
        err.gitErrorCode = GitErrorCodes.NoUpstreamBranch;
      }

      throw err;
    }
  }

  async createStash(message?: string, includeUntracked?: boolean, staged?: boolean): Promise<void> {
    try {
      const args = ['stash', 'push'];

      if (includeUntracked) {
        args.push('-u');
      }

      if (staged) {
        args.push('-S');
      }

      if (message) {
        args.push('-m', message);
      }

      await this.exec(args);
    } catch (err: any) {
      if (/No local changes to save/.test(err.stderr || '')) {
        err.gitErrorCode = GitErrorCodes.NoLocalChanges;
      }

      throw err;
    }
  }

  async popStash(index?: number): Promise<void> {
    const args = ['stash', 'pop'];
    await this.popOrApplyStash(args, index);
  }

  private async popOrApplyStash(args: string[], index?: number): Promise<void> {
    try {
      if (typeof index === 'number') {
        args.push(`stash@{${index}}`);
      }

      await this.exec(args);
    } catch (err: any) {
      if (/No stash found/.test(err.stderr || '')) {
        err.gitErrorCode = GitErrorCodes.NoStashFound;
      } else if (/error: Your local changes to the following files would be overwritten/.test(err.stderr || '')) {
        err.gitErrorCode = GitErrorCodes.LocalChangesOverwritten;
      } else if (/^CONFLICT/m.test(err.stdout || '')) {
        err.gitErrorCode = GitErrorCodes.StashConflict;
      }

      throw err;
    }
  }

  async getStatus(opts?: {
    limit?: number;
    ignoreSubmodules?: boolean;
    similarityThreshold?: number;
    untrackedChanges?: 'mixed' | 'separate' | 'hidden'
  }): Promise<{ status: IFileStatus[], statusLength: number, didHitLimit: boolean }> {
    const env = { GIT_OPTIONAL_LOCKS: '0' };
    const args = ['status', '-z'];

    if (opts?.untrackedChanges === 'hidden') {
      args.push('-uno');
    } else {
      args.push('-uall');
    }

    if (opts?.ignoreSubmodules) {
      args.push('--ignore-submodules');
    }

    if (opts?.similarityThreshold && opts.similarityThreshold !== 50 && this._git.compareGitVersionTo('2.18.0') !== -1) {
      args.push(`--find-renames=${opts.similarityThreshold}%`);
    }

    const process = this.stream(args, { env });

    const result = new Promise<{ status: IFileStatus[]; statusLength: number; didHitLimit: boolean }>((c, e) => {
      const parser = new GitStatusParser();

      const onClose = (exitCode: number) => {
        if (exitCode !== 0) {
          const stderr = stderrData.join('');
          return e(new GitError({
            message: 'Failed to execute git',
            stderr,
            exitCode,
            gitErrorCode: getGitErrorCode(stderr),
            gitCommand: 'status',
            gitArgs: args
          }));
        }

        c({ status: parser.status, statusLength: parser.status.length, didHitLimit: false });
      }

      const limit = opts?.limit ?? 10000;
      const onStdoutData = (raw: string) => {
        parser.update(raw);

        if (limit !== 0 && parser.status.length > limit) {
          process.off('close', onClose);
          process.stdout!.off('data', onStdoutData);
          process.kill();

          c({ status: parser.status.slice(0, limit), statusLength: parser.status.length, didHitLimit: true });
        }
      };

      process.stdout!.on('data', onStdoutData);

      const stderrData: string[] = [];
      process.stderr!.on('data', raw => stderrData.push(raw));
      process.on('close', onClose);
    });

    const { status, statusLength, didHitLimit } = await result;
    return { status, statusLength, didHitLimit };
  }

  async getHEADRef(): Promise<Branch | undefined> {
    let HEAD: Branch | undefined;

    try {
      HEAD = await this.getHEAD();

      if (HEAD.name) {
        // Branch
        HEAD = await this.getBranch(HEAD.name);

        // Upstream commit
        if (HEAD && HEAD.upstream) {
          const ref = HEAD.upstream.remote !== '.'
            ? `refs/remotes/${HEAD.upstream.remote}/${HEAD.upstream.name}`
            : `refs/heads/${HEAD.upstream.name}`;
          const commit = await this.revParse(ref);
          HEAD = { ...HEAD, upstream: { ...HEAD.upstream, commit } };
        }
      } else if (HEAD.commit) {
        // Tag || Commit
        const tags = await this.getRefs({ pattern: 'refs/tags' });
        const tag = tags.find(tag => tag.commit === HEAD!.commit);

        if (tag) {
          HEAD = { ...HEAD, name: tag.name, type: RefType.Tag };
        }
      }
    } catch (err) {
      // noop
    }

    return HEAD;
  }

  async getHEAD(): Promise<Ref> {
    if (!this._isUsingRefTable) {
      try {
        // Attempt to parse the HEAD file
        const result = await this.getHEADFS();

        // Git 2.45 adds support for a new reference storage backend called "reftable", promising
        // faster lookups, reads, and writes for repositories with any number of references. For
        // backwards compatibility the `.git/HEAD` file contains `ref: refs/heads/.invalid`. More
        // details are available at https://git-scm.com/docs/reftable
        if (result.name === '.invalid') {
          this._isUsingRefTable = true;
          this.logger.warn(`[Git][getHEAD] Failed to parse HEAD file: Repository is using reftable format.`);
        } else {
          return result;
        }
      } catch (err: any) {
        this.logger.warn(`[Git][getHEAD] Failed to parse HEAD file: ${err.message}`);
      }
    }

    try {
      // Fallback to using git to determine HEAD
      const result = await this.exec(['symbolic-ref', '--short', 'HEAD']);

      if (!result.stdout) {
        throw new Error('Not in a branch');
      }

      return { name: result.stdout.trim(), commit: undefined, type: RefType.Head };
    } catch (err) { }

    // Detached HEAD
    const result = await this.exec(['rev-parse', 'HEAD']);

    if (!result.stdout) {
      throw new Error('Error parsing HEAD');
    }

    return { name: undefined, commit: result.stdout.trim(), type: RefType.Head };
  }

  async getHEADFS(): Promise<Ref> {
    const raw = await fs(Url.join(`file://${this.dotGit.path}`, 'HEAD')).readFile('utf-8');

    // Branch
    const branchMatch = raw.match(/^ref: refs\/heads\/(?<name>.*)$/m);
    if (branchMatch?.groups?.name) {
      return { name: branchMatch.groups.name, commit: undefined, type: RefType.Head };
    }

    // Detached
    const commitMatch = raw.match(/^(?<commit>[0-9a-f]{40})$/m);
    if (commitMatch?.groups?.commit) {
      return { name: undefined, commit: commitMatch.groups.commit, type: RefType.Head };
    }

    throw new Error(`Unable to parse HEAD file. HEAD file contents: ${raw}.`);
  }

  async findTrackingBranches(upstreamBranch: string): Promise<Branch[]> {
    const result = await this.exec(['for-each-ref', '--format', '%(refname:short)%00%(upstream:short)', 'refs/heads']);
    return result.stdout.trim().split('\n')
      .map(line => line.trim().split('\0'))
      .filter(([_, upstream]) => upstream === upstreamBranch)
      .map(([ref]): Branch => ({ name: ref, type: RefType.Head }));
  }

  async getRefs(query: RefQuery): Promise<(Ref | Branch)[]> {
    const args = ['for-each-ref'];

    if (query.count) {
      args.push(`--count=${query.count}`);
    }

    if (query.sort && query.sort !== 'alphabetically') {
      args.push('--sort', `-${query.sort}`);
    }

    if (query.includeCommitDetails) {
      const format = this._git.compareGitVersionTo('1.9.0') !== -1
        ? `${REFS_WITH_DETAILS_FORMAT}%00%(upstream:track)`
        : REFS_WITH_DETAILS_FORMAT;
      args.push('--format', format);
    } else {
      args.push('--format', REFS_FORMAT);
    }

    if (query.pattern) {
      const patterns = Array.isArray(query.pattern) ? query.pattern : [query.pattern];
      for (const pattern of patterns) {
        args.push(pattern.startsWith('refs/') ? pattern : `refs/${pattern}`);
      }
    }

    if (query.contains) {
      args.push('--contains', query.contains);
    }

    const result = await this.exec(args);
    return parseRefs(result.stdout);
  }

  async getRemoteRefs(remote: string, opts?: { heads?: boolean; tags?: boolean; }): Promise<Ref[]> {
    const args = ['ls-remote'];

    if (opts?.heads) {
      args.push('--heads');
    }

    if (opts?.tags) {
      args.push('--tags');
    }

    args.push(remote);

    const result = await this.exec(args);

    const fn = (line: string): Ref | null => {
      let match: RegExpExecArray | null;

      if (match = /^([0-9a-f]{40})\trefs\/heads\/([^ ]+)$/.exec(line)) {
        return { name: match[1], commit: match[2], type: RefType.Head };
      } else if (match = /^([0-9a-f]{40})\trefs\/tags\/([^ ]+)$/.exec(line)) {
        return { name: match[2], commit: match[1], type: RefType.Tag };
      }

      return null;
    };

    return result.stdout.split('\n')
      .filter(line => !!line)
      .map(fn)
      .filter(ref => !!ref) as Ref[];
  }

  async getBranch(name: string): Promise<Branch> {
    if (name === 'HEAD') {
      return this.getHEAD();
    }

    const args = ['for-each-ref'];

    let supportsAheadBehind = true;
    if (this._git.compareGitVersionTo('1.9.0') === -1) {
      args.push('--format=%(refname)%00%(upstream:short)%00%(objectname)');
      supportsAheadBehind = false;
    } else if (this._git.compareGitVersionTo('2.16.0') === -1) {
      args.push('--format=%(refname)%00%(upstream:short)%00%(objectname)%00%(upstream:track)');
    } else {
      args.push('--format=%(refname)%00%(upstream:short)%00%(objectname)%00%(upstream:track)%00%(upstream:remotename)%00%(upstream:remoteref)');
    }

    if (/^refs\/(heads|remotes)\//i.test(name)) {
      args.push(name);
    } else {
      args.push(`refs/heads/${name}`, `refs/remotes/${name}`);
    }

    const result = await this.exec(args);

    const branches: Branch[] = result.stdout.trim().split('\n').map<Branch | undefined>(line => {
      let [branchName, upstream, ref, status, remoteName, upstreamRef] = line.trim().split('\0');

      if (branchName.startsWith('refs/heads/')) {
        branchName = branchName.substring(11);
        const index = upstream.indexOf('/');

        let ahead;
        let behind;
        const match = /\[(?:ahead ([0-9]+))?[,\s]*(?:behind ([0-9]+))?]|\[gone]/.exec(status);
        if (match) {
          [, ahead, behind] = match;
        }

        return {
          type: RefType.Head,
          name: branchName,
          upstream: upstream !== '' && status !== '[gone]' ? {
            name: upstreamRef ? upstreamRef.substring(11) : upstream.substring(index + 1),
            remote: remoteName ? remoteName : upstream.substring(0, index)
          } : undefined,
          commit: ref || undefined,
          ahead: Number(ahead) || 0,
          behind: Number(behind) || 0,
        };
      } else if (branchName.startsWith('refs/remotes/')) {
        branchName = branchName.substring(13);
        const index = branchName.indexOf('/');

        return {
          type: RefType.RemoteHead,
          name: branchName.substring(index + 1),
          remote: branchName.substring(0, index),
          commit: ref,
        };
      } else {
        return undefined;
      }
    }).filter((b?: Branch): b is Branch => !!b);

    if (branches.length) {
      const [branch] = branches;

      if (!supportsAheadBehind && branch.upstream) {
        try {
          const result = await this.exec(['rev-list', '--left-right', '--count', `${branch.name}...${branch.upstream.remote}/${branch.upstream.name}`]);
          const [ahead, behind] = result.stdout.trim().split('\t');

          (branch as Mutable<Branch>).ahead = Number(ahead) || 0;
          (branch as Mutable<Branch>).behind = Number(behind) || 0;
        } catch { }
      }

      return branch;
    }

    this.logger.warn(`[Git][getBranch] No such branch: ${name}`);
    return Promise.reject<Branch>(new Error(`No such branch: ${name}.`));
  }

  async getCommit(ref: string): Promise<Commit> {
    const result = await this.exec(['show', '-s', '--decorate=full', '--shortstat', `--format=${COMMIT_FORMAT}`, '-z', ref, '--']);
    const commits = parseGitCommits(result.stdout);
    if (commits.length === 0) {
      return Promise.reject<Commit>('bad commit format');
    }
    return commits[0];
  }

  async getRemotes(): Promise<Remote[]> {
    const remotes: MutableRemote[] = [];

    try {
      // Attempt to parse the config file
      remotes.push(...await this.getRemotesFS());

      if (remotes.length === 0) {
        this.logger.info('[Git][getRemotes] No remotes found in the git config file');
      }
    }
    catch (err: any) {
      this.logger.warn(`[Git][getRemotes] Error: ${err.message}`);

      // Fallback to using git to get the remotes
      remotes.push(...await this.getRemotesGit());
    }

    for (const remote of remotes) {
      // https://github.com/microsoft/vscode/issues/45271
      remote.isReadOnly = remote.pushUrl === undefined || remote.pushUrl === 'no_push';
    }

    return remotes;
  }

  private async getRemotesFS(): Promise<MutableRemote[]> {
    const raw = await fs(`file://${Url.join(this.dotGit.commonPath ?? this.dotGit.path, 'config')}`).readFile('utf-8');
    return parseGitRemotes(raw);
  }

  private async getRemotesGit(): Promise<MutableRemote[]> {
    const remotes: MutableRemote[] = [];

    const result = await this.exec(['remote', '--verbose']);
    const lines = result.stdout.trim().split('\n').filter(l => !!l);

    for (const line of lines) {
      const parts = line.split(/\s/);
      const [name, url, type] = parts;

      let remote = remotes.find(r => r.name === name);

      if (!remote) {
        remote = { name, isReadOnly: false };
        remotes.push(remote);
      }

      if (/fetch/i.test(type)) {
        remote.fetchUrl = url;
      } else if (/push/i.test(type)) {
        remote.pushUrl = url;
      } else {
        remote.fetchUrl = url;
        remote.pushUrl = url;
      }
    }

    return remotes;
  }

  async revParse(ref: string): Promise<string | undefined> {
    try {
      const result = await fs(Url.join(`file://${this.dotGit.path}`, ref)).readFile('utf-8');
      return result.trim();
    } catch (err: any) {
      this.logger.warn(`[Git][revParse] Unable to read file: ${err.message}`);
    }

    try {
      const result = await this.exec(['rev-parse', ref]);
      if (result.stderr) {
        return undefined;
      }
      return result.stdout.trim();
    } catch (err) {
      return undefined;
    }
  }

  private sanitizeRelativePath(filePath: string): string {
    this.logger.debug(`[Git][sanitizeRelativePath] filePath: ${filePath}`);

    if (!isAbsolute(filePath)) {
      filePath = sanitizeRelativePath(filePath);
      this.logger.debug(`[Git][sanitizeRelativePath] relativePath (noop): ${filePath}`);
      return filePath;
    }

    let relative: string | undefined;

    if (this.repositoryRootRealPath) {
      relative = relativePath(this.repositoryRootRealPath, filePath);
      if (relative) {
        relative = sanitizeRelativePath(relative);
        this.logger.debug(`[Git][sanitizeRelativePath] relativePath (real path): ${relative}`);
        return relative;
      }
    }

    relative = relativePath(this.repositoryRoot, filePath);
    if (relative) {
      relative = sanitizeRelativePath(relative);
      this.logger.debug(`[Git][sanitizeRelativePath] relativePath (path): ${relative}`);
      return relative;
    }

    return filePath;
  }

  async updateSubmodules(paths: string[]): Promise<void> {
		const args = ['submodule', 'update'];

		for (const chunk of splitInChunks(paths.map(p => this.sanitizeRelativePath(p)), MAX_CLI_LENGTH)) {
			await this.exec([...args, '--', ...chunk]);
		}
	}

  async getSubmodules(): Promise<Submodule[]> {
    const gutmodulesPath = Url.join(this.root, '.gitmodules');

    try {
      const gitmodulesRaw = await fs(`file://${gutmodulesPath}`).readFile('utf-8');
      return parseGitmodules(gitmodulesRaw);
    } catch (err: any) {
      if (/ENOENT/.test(err.message) || err.code === 1 || err.code === 2) {
        return [];
      }

      throw err;
    }
  }
}
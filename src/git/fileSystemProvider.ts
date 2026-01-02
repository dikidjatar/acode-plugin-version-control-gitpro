import { debounce, throttle } from "../base/decorators";
import { Disposable, IDisposable } from "../base/disposable";
import { isUri, uriToPath } from "../base/uri";
import { LogOutputChannel } from "./logger";
import { Model, ModelChangeEvent } from "./model";
import { Repository } from "./repository";
import { fromGitUri } from "./uri";
import { isDescendant, pathEquals } from "./utils";

const Url = acode.require('Url');

interface CacheRow {
  uri: string;
  timestamp: number;
}

const THREE_MINUTES = 1000 * 60 * 3;
const FIVE_MINUTES = 1000 * 60 * 5;

function sanitizeRef(ref: string, path: string, submoduleOf: string | undefined, repository: Repository): string {
  if (ref === '~') {
    const [indexStatus] = repository.indexGroup.resourceStates.filter(r => r.resourceUri === path);
    return indexStatus ? '' : 'HEAD';
  }

  if (/^~\d$/.test(ref)) {
    return `:${ref[1]}`;
  }

  // Submodule HEAD
  if (submoduleOf && (ref === 'index' || ref === 'wt')) {
    return 'HEAD';
  }

  return ref;
}

export class GitFileSystem {

  private changedRepositoryRoots = new Set<string>();
  private cache = new Map<string, CacheRow>();
  private mtime = new Date().getTime();
  private disposables: IDisposable[] = [];

  constructor(private readonly model: Model, private readonly logger: LogOutputChannel) {
    this.disposables.push(model.onDidChangeRepository(this.onDidChangeRepository, this));
    setInterval(() => this.cleanup(), FIVE_MINUTES);
  }

  private onDidChangeRepository({ repository }: ModelChangeEvent): void {
    this.changedRepositoryRoots.add(repository.root);
    this.eventuallyFireChangeEvents();
  }

  @debounce(1100)
  private eventuallyFireChangeEvents(): void {
    this.fireChangeEvents();
  }

  @throttle
  private async fireChangeEvents(): Promise<void> {
    const events: { event: Acode.EditorEvent, uri: string }[] = [];

    for (const { uri } of this.cache.values()) {
      const path = fromGitUri(uri).path;

      for (const root of this.changedRepositoryRoots) {
        if (isDescendant(root, path)) {
          events.push({ event: 'change', uri });
          break;
        }
      }
    }

    if (events.length > 0) {
      this.mtime = new Date().getTime();
      events.forEach(event => {
        const name = Url.basename(fromGitUri(event.uri).path);
        editorManager.emit(event.event, { name, url: event.uri });
      });
    }

    this.changedRepositoryRoots.clear();
  }

  private cleanup(): void {
    const now = new Date().getTime();
    const cache = new Map<string, CacheRow>();

    for (const row of this.cache.values()) {
      const { path } = fromGitUri(row.uri);
      const isOpen = editorManager.files
        .filter(file => isUri(file.uri))
        .some(file => pathEquals(uriToPath(file.uri), path));

      if (isOpen || now - row.timestamp < THREE_MINUTES) {
        cache.set(row.uri, row);
      }
    }

    this.cache = cache;
  }

  async readFile(url: string): Promise<string | Uint8Array<ArrayBuffer>> {
    await this.model.isInitialized;

    const { path, ref, submoduleOf } = fromGitUri(url);

    if (submoduleOf) {
      const repository = this.model.getRepository(submoduleOf);

      if (!repository) {
        throw new Error('File not found.');
      }

      const encoder = new TextEncoder();

      if (ref === 'index') {
        return encoder.encode(await repository.diffIndexWithHEAD(path));
      } else {
        return encoder.encode(await repository.diffWithHEAD(path));
      }
    }

    const repository = this.model.getRepository(url);

    if (!repository) {
      this.logger.warn(`[GitFileSystemProvider][readFile] Repository not found - ${url}`);
      throw new Error('File not found.');
    }

    const timestamp = new Date().getTime();
    const cacheValue: CacheRow = { uri: url, timestamp };

    this.cache.set(url, cacheValue);

    try {
      return await repository.buffer(sanitizeRef(ref, path, submoduleOf, repository), path);
    } catch {
      // Empty tree
      if (ref === await repository.getEmptyTree()) {
        this.logger.warn(`[GitFileSystemProvider][readFile] Empty tree - ${url}`);
        return new Uint8Array(0);
      }

      // File does not exist in git. This could be because the file is untracked or ignored
      this.logger.warn(`[GitFileSystemProvider][readFile] File not found - ${url}`);
      throw new Error('File not found.');
    }
  }

  async stat(url: string): Promise<Acode.Stat> {
    await this.model.isInitialized;

    const { path, ref, submoduleOf } = fromGitUri(url);
    const repository = submoduleOf ? this.model.getRepository(submoduleOf) : this.model.getRepository(url);
    if (!repository) {
      this.logger.warn(`[GitFileSystemProvider][stat] Repository not found - ${url}`);
      throw new Error('File not found.');
    }

    try {
      const details = await repository.getObjectDetails(sanitizeRef(ref, path, submoduleOf, repository), path);
      return { canRead: true, canWrite: false, isDirectory: false, isFile: true, isLink: false, modifiedDate: this.mtime, name: Url.basename(url) ?? '', size: details.size, url };
    } catch {
      // Empty tree
      if (ref === await repository.getEmptyTree()) {
        this.logger.warn(`[GitFileSystemProvider][stat] Empty tree - ${url}`);
        return { canRead: false, canWrite: false, isDirectory: false, isFile: true, isLink: false, modifiedDate: this.mtime, name: Url.basename(url) ?? '', size: 0, url };
      }

      // File does not exist in git. This could be because the file is untracked or ignored
      this.logger.warn(`[GitFileSystemProvider][stat] File not found - ${url}`);
      throw Error('File not found.');
    }
  }

  dispose(): void {
    this.disposables = Disposable.dispose(this.disposables);
  }
}

export class GitFileSystemProvider implements Acode.FileSystem {

  public static test = (url: string) => /^git:/.test(url);

  constructor(private url: string, private fs: GitFileSystem) { }

  lsDir(): Promise<Acode.File[]> {
    throw new Error("Method not implemented.");
  }

  readFile(): Promise<ArrayBuffer>;
  readFile(encoding: "utf-8"): Promise<string>;
  readFile(encoding: "json"): Promise<unknown>;
  readFile(encoding?: any): Promise<any> {
    return this.fs.readFile(this.url);
  }

  async writeFile(content: string | ArrayBuffer): Promise<void> {
    // ignore
  }

  async createFile(name: string, content?: string): Promise<string> {
    throw new Error("Method not implemented.");
  }

  createDirectory(name: string): Promise<string> {
    throw new Error("Method not implemented.");
  }

  delete(): Promise<void> {
    throw new Error("Method not implemented.");
  }

  copyTo(destination: string): Promise<string> {
    throw new Error("Method not implemented.");
  }

  moveTo(destination: string): Promise<string> {
    throw new Error("Method not implemented.");
  }

  renameTo(newName: string): Promise<string> {
    throw new Error("Method not implemented.");
  }

  async exists(): Promise<boolean> {
    try {
      await this.fs.stat(this.url);
      return true;
    } catch {
      return false;
    }
  }

  stat(): Promise<Acode.Stat> {
    return this.fs.stat(this.url);
  }
}
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { config } from "../base/config";
import { debounce } from "../base/decorators";
import { Disposable, IDisposable } from "../base/disposable";
import { Emitter, Event } from "../base/event";
import { uriToPath } from "../base/uri";
import { Status } from "./api/git";
import { AcodeFileDecorationService, FileDecoration, FileDecorationProvider } from "./fileDecorationService";
import { Model } from "./model";
import { GitResourceGroup, Repository } from "./repository";
import { PromiseSource } from "./utils";

const Url = acode.require('Url');

class GitIgnoreDecorationProvider implements FileDecorationProvider {

  private static Decoration: FileDecoration = { color: '#8C8C8C' };

  private readonly _onDidChangeDecorations = new Emitter<string[]>();
  readonly onDidChangeFileDecorations: Event<string[]> = this._onDidChangeDecorations.event;

  private queue = new Map<string, { repository: Repository; queue: Map<string, PromiseSource<FileDecoration | undefined>> }>();
  private disposables: IDisposable[] = [];;

  constructor(
    private model: Model,
    decorationService: AcodeFileDecorationService
  ) {
    const onDidChangeRepository = Event.any<any>(
      model.onDidOpenRepository,
      model.onDidCloseRepository
    );

    const onSaveFile = (file: Acode.EditorFile) => {
      if (/\.gitignore$|\.git\/info\/exclude$/.test(uriToPath(file.uri))) {
        this._onDidChangeDecorations.fire([]);
      }
    }
    editorManager.on('save-file', onSaveFile);

    this.disposables.push(onDidChangeRepository(() => this._onDidChangeDecorations.fire([])));
    this.disposables.push(Disposable.toDisposable(() => editorManager.off('save-file', onSaveFile)));
    this.disposables.push(decorationService.registerFileDecorationProvider(this));
  }

  async provideFileDecoration(path: string): Promise<FileDecoration | undefined> {
    const repository = this.model.getRepository(path);

    if (!repository) {
      return;
    }

    let queueItem = this.queue.get(repository.root);

    if (!queueItem) {
      queueItem = { repository, queue: new Map<string, PromiseSource<FileDecoration | undefined>>() };
      this.queue.set(repository.root, queueItem);
    }

    let promiseSource = queueItem.queue.get(path);

    if (!promiseSource) {
      promiseSource = new PromiseSource();
      queueItem!.queue.set(path, promiseSource);
      this.checkIgnoreSoon();
    }

    return await promiseSource.promise;
  }

  @debounce(500)
  private checkIgnoreSoon(): void {
    const queue = new Map(this.queue.entries());
    this.queue.clear();

    for (const [, item] of queue) {
      const paths = [...item.queue.keys()];

      item.repository.checkIgnore(paths).then(ignoreSet => {
        for (const [path, promiseSource] of item.queue.entries()) {
          promiseSource.resolve(ignoreSet.has(path) ? GitIgnoreDecorationProvider.Decoration : undefined);
        }
      }, err => {
        for (const [, promiseSource] of item.queue.entries()) {
          promiseSource.reject(err);
        }
      });
    }
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.queue.clear();
  }
}

class GitDecorationProvider implements FileDecorationProvider {

  private static SubmoduleDecorationData: FileDecoration = {
    badge: 'S',
    color: '#8db9e2'
  };

  private readonly _onDidChangeDecorations = new Emitter<string[]>();
  readonly onDidChangeFileDecorations: Event<string[]> = this._onDidChangeDecorations.event;

  private disposables: IDisposable[] = [];
  private decorations = new Map<string, FileDecoration>();

  constructor(
    private repository: Repository,
    decorationService: AcodeFileDecorationService
  ) {
    this.disposables.push(
      decorationService.registerFileDecorationProvider(this),
      Event.runAndSubscribe(repository.onDidRunGitStatus, () => this.onDidRunGitStatus())
    );
  }

  private onDidRunGitStatus(): void {
    const newDecorations = new Map<string, FileDecoration>();

    this.collectDecorationData(this.repository.indexGroup, newDecorations);
    this.collectDecorationData(this.repository.untrackedGroup, newDecorations);
    this.collectDecorationData(this.repository.workingTreeGroup, newDecorations);
    this.collectDecorationData(this.repository.mergeGroup, newDecorations);
    this.collectSubmoduleDecorationData(newDecorations);

    const uris = new Set([...this.decorations.keys()].concat([...newDecorations.keys()]));
    this.decorations = newDecorations;
    this._onDidChangeDecorations.fire([...uris.values()]);
  }

  private collectDecorationData(group: GitResourceGroup, bucket: Map<string, FileDecoration>): void {
    for (const r of group.resourceStates) {
      const decoration = r.resourceDecoration;

      if (decoration) {
        bucket.set(r.original, decoration);

        if (r.type === Status.INDEX_RENAMED || r.type === Status.INTENT_TO_RENAME) {
          bucket.set(r.resourceUri, decoration);
        }
      }
    }
  }

  private collectSubmoduleDecorationData(bucket: Map<string, FileDecoration>): void {
    for (const submodule of this.repository.submodules) {
      bucket.set(Url.join(this.repository.root, submodule.path), GitDecorationProvider.SubmoduleDecorationData);
    }
  }

  provideFileDecoration(uri: string): FileDecoration | undefined {
    return this.decorations.get(uri.toString());
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}

export class GitDecorations {

  private enabled = false;
  private disposables: IDisposable[] = [];
  private modelDisposables: IDisposable[] = [];
  private providers = new Map<Repository, IDisposable>();

  constructor(
    private model: Model,
    private decorationService: AcodeFileDecorationService
  ) {
    this.disposables.push(new GitIgnoreDecorationProvider(model, decorationService));

    const onEnablementChange = Event.filter(config.onDidChangeConfiguration, e => e.affectsConfiguration('vcgit.decorationsEnabled'));
    onEnablementChange(this.update, this, this.disposables);
    this.update();
  }

  private update(): void {
    const gitConfig = config.get('vcgit')!;
    const enabled = gitConfig.decorationsEnabled;
    if (this.enabled === enabled) {
      return;
    }

    if (enabled) {
      this.enable();
    } else {
      this.disable();
    }

    this.enabled = enabled;
  }

  private enable(): void {
    this.model.onDidOpenRepository(this.onDidOpenRepository, this, this.modelDisposables);
    this.model.onDidCloseRepository(this.onDidCloseRepository, this, this.modelDisposables);
    this.model.repositories.forEach(this.onDidOpenRepository, this);
  }

  private disable(): void {
    this.modelDisposables = Disposable.dispose(this.modelDisposables);
    this.providers.forEach(value => value.dispose());
    this.providers.clear();
  }

  private onDidOpenRepository(repository: Repository): void {
    this.providers.set(repository, new GitDecorationProvider(repository, this.decorationService));
  }

  private onDidCloseRepository(repository: Repository): void {
    const provider = this.providers.get(repository);

    if (provider) {
      provider.dispose();
      this.providers.delete(repository);
    }
  }

  dispose(): void {
    this.disable();
    this.disposables = Disposable.dispose(this.disposables);
  }
}
import { App } from "../base/app";
import { debounce } from "../base/decorators";
import { IDisposable } from "../base/disposable";
import { Emitter, Event } from "../base/event";
import { config } from "../base/config";
import { uriToPath } from "../base/uri";
import { SCMMenus } from "./menus";
import { ISCMMenus, ISCMProvider, ISCMRepository, ISCMRepositorySelectionMode, ISCMService, ISCMViewService, ISCMViewVisibleRepositoryChangeEvent } from "./types";
import { binarySearch, comparePaths } from "./utils";

const Url = acode.require('Url');

function getProviderStorageKey(provider: ISCMProvider): string {
  return `${provider.id}:${provider.label}${provider.rootUri ? `:${provider.rootUri}` : ''}`;
}

function getRepositoryName(repository: ISCMRepository): string {
  if (!repository.provider.rootUri) {
    return repository.provider.label;
  }

  const folder = addedFolder.find(f => uriToPath(f.url) === repository.provider.rootUri);
  return folder?.url === repository.provider.rootUri ? folder.title : Url.basename(repository.provider.rootUri) || repository.provider.name;
}

interface ISCMRepositoryView {
  readonly repository: ISCMRepository;
  selectionIndex: number;
}

interface ISCMViewServiceState {
  readonly all: string[];
  readonly visible: number[];
}

export class SCMViewService implements ISCMViewService {

  readonly menus: ISCMMenus;
  private _selectionModeConfig: ISCMRepositorySelectionMode = ISCMRepositorySelectionMode.Single;
  get selectionModeConfig(): ISCMRepositorySelectionMode {
    return this._selectionModeConfig;
  }

  private didFinishLoading: boolean = false;
  private didSelectRepository: boolean = false;
  private previousState: ISCMViewServiceState | undefined;

  private readonly disposables: IDisposable[] = [];

  private _repositories: ISCMRepositoryView[] = [];

  get repositories(): ISCMRepository[] {
    return this._repositories.map(r => r.repository);
  }

  get visibleRepositories(): ISCMRepository[] {
    return this._repositories
      .filter(r => r.selectionIndex !== -1)
      .map(r => r.repository);
  }

  set visibleRepositories(visibleRepositories: ISCMRepository[]) {
    const set = new Set(visibleRepositories);
    const added = new Set<ISCMRepository>();
    const removed = new Set<ISCMRepository>();

    for (const repositoryView of this._repositories) {
      // Selected -> !Selected
      if (!set.has(repositoryView.repository) && repositoryView.selectionIndex !== -1) {
        repositoryView.selectionIndex = -1;
        removed.add(repositoryView.repository);
      }
      // Selected | !Selected -> Selected
      if (set.has(repositoryView.repository)) {
        if (repositoryView.selectionIndex === -1) {
          added.add(repositoryView.repository);
        }
        repositoryView.selectionIndex = visibleRepositories.indexOf(repositoryView.repository);
      }
    }

    if (added.size === 0 && removed.size === 0) {
      return;
    }

    this._onDidSetVisibleRepositories.fire({ added, removed });
  }

  private _onDidChangeRepositories = new Emitter<ISCMViewVisibleRepositoryChangeEvent>();
  readonly onDidChangeRepositories: Event<ISCMViewVisibleRepositoryChangeEvent> = this._onDidChangeRepositories.event;

  private _onDidSetVisibleRepositories = new Emitter<ISCMViewVisibleRepositoryChangeEvent>;
  readonly onDidChangeVisibleRepositories = Event.any(
    this._onDidSetVisibleRepositories.event,
    Event.debounce(
      this._onDidChangeRepositories.event,
      (last, e) => {
        if (!last) return e;

        const added = new Set(last.added);
        const removed = new Set(last.removed);

        for (const repository of e.added) {
          if (removed.has(repository)) {
            removed.delete(repository);
          } else {
            added.add(repository);
          }
        }
        for (const repository of e.removed) {
          if (added.has(repository)) {
            added.delete(repository);
          } else {
            removed.add(repository);
          }
        }

        return { added, removed };
      }, 0)
  );

  constructor(readonly scmService: ISCMService) {
    this.menus = new SCMMenus(scmService);
    const onConfigListener = () => {
      const scmConfig = config.get('scm')!;
      this._selectionModeConfig = scmConfig.selectionMode === 'multiple' ? ISCMRepositorySelectionMode.Multiple : ISCMRepositorySelectionMode.Single;

      if (this._selectionModeConfig === ISCMRepositorySelectionMode.Single && this.visibleRepositories.length > 1) {
        const repository = this.visibleRepositories[0];
        this.visibleRepositories = [repository];
      } else if (this._selectionModeConfig === ISCMRepositorySelectionMode.Multiple && this.repositories.length > 1) {
        this.visibleRepositories = this.repositories;
      }
    }
    Event.filter(config.onDidChangeConfiguration, e => e.affectsConfiguration('scm.selectionMode'))(onConfigListener, null, this.disposables);
    onConfigListener();

    try {
      this.previousState = JSON.parse(localStorage.getItem('scmViewVisibleRepositories') || '');

      // If previously there were multiple visible repositories but the
      // view mode is `single`, only restore the first visible repository.
      if (this.previousState && this.previousState.visible.length > 1 && this.selectionModeConfig === ISCMRepositorySelectionMode.Single) {
        this.previousState = {
          ...this.previousState,
          visible: [this.previousState.visible[0]]
        };
      }
    } catch {
      // noop
    }

    scmService.onDidAddRepository(this.onDidAddRepository, this, this.disposables);
    scmService.onDidRemoveRepository(this.onDidRemoveRepository, this, this.disposables);

    for (const repository of scmService.repositories) {
      this.onDidAddRepository(repository);
    }

    App.onCloseApp(this.saveState, this, this.disposables);
  }

  private onDidAddRepository(repository: ISCMRepository): void {
    if (!this.didFinishLoading) {
      this.eventuallyFinishLoading();
    }

    const repositoryView = {
      repository, selectionIndex: -1
    } satisfies ISCMRepositoryView;

    let removed: Iterable<ISCMRepository> = [];

    if (this.previousState && !this.didFinishLoading) {
      const index = this.previousState.all.indexOf(getProviderStorageKey(repository.provider));

      if (index === -1) {
        // This repository is not part of the previous state which means that it
        // was either manually closed in the previous session, or the repository
        // was added after the previous session. In this case, we should select
        // all of the repositories.
        const added: ISCMRepository[] = [];

        this.insertRepositoryView(this._repositories, repositoryView);

        if (this.selectionModeConfig === ISCMRepositorySelectionMode.Multiple || !this._repositories.find(r => r.selectionIndex !== -1)) {
          // Multiple selection mode or single selection mode (select first repository)
          this._repositories.forEach((repositoryView, index) => {
            if (repositoryView.selectionIndex === -1) {
              added.push(repositoryView.repository);
            }
            repositoryView.selectionIndex = index;
          });

          this._onDidChangeRepositories.fire({ added, removed: [] });
        }

        this.didSelectRepository = false;
        return;
      }

      if (this.previousState.visible.indexOf(index) === -1) {
        // Explicit selection started
        if (this.didSelectRepository) {
          this.insertRepositoryView(this._repositories, repositoryView);
          this._onDidChangeRepositories.fire({ added: [], removed: [] });
          return;
        }
      } else {
        // First visible repository
        if (!this.didSelectRepository) {
          removed = [...this.visibleRepositories];
          this._repositories.forEach(r => {
            r.selectionIndex = -1;
          });

          this.didSelectRepository = true;
        }
      }
    }

    if (this.selectionModeConfig === ISCMRepositorySelectionMode.Multiple || !this._repositories.find(r => r.selectionIndex !== -1)) {
      // Multiple selection mode or single selection mode (select first repository)
      const maxSelectionIndex = this.getMaxSelectionIndex();
      this.insertRepositoryView(this._repositories, { ...repositoryView, selectionIndex: maxSelectionIndex + 1 });
      this._onDidChangeRepositories.fire({ added: [repositoryView.repository], removed });
    } else {
      // Single selection mode (add subsequent repository)
      this.insertRepositoryView(this._repositories, repositoryView);
      this._onDidChangeRepositories.fire({ added: [], removed });
    }
  }

  private onDidRemoveRepository(repository: ISCMRepository): void {
    if (!this.didFinishLoading) {
      this.eventuallyFinishLoading();
    }

    const repositoryIndex = this._repositories.findIndex(r => r.repository === repository);
    if (repositoryIndex === -1) {
      return;
    }

    let added: ISCMRepository[] = [];
    const removed = this._repositories.splice(repositoryIndex, 1);

    if (this._repositories.length > 0 && this.visibleRepositories.length === 0) {
      this._repositories[0].selectionIndex = 0;
      added = [this._repositories[0].repository];
    }

    this._onDidChangeRepositories.fire({ added, removed: removed.map(r => r.repository) });
  }

  isVisible(repository: ISCMRepository): boolean {
    return this._repositories.find(r => r.repository === repository)?.selectionIndex !== -1;
  }

  toggleVisibility(repository: ISCMRepository, visible?: boolean): void {
    if (typeof visible === 'undefined') {
      visible = !this.isVisible(repository);
    } else if (this.isVisible(repository) === visible) {
      return;
    }

    if (visible) {
      if (this.selectionModeConfig === ISCMRepositorySelectionMode.Single) {
        this.visibleRepositories = [repository];
      } else if (this.selectionModeConfig === ISCMRepositorySelectionMode.Multiple) {
        this.visibleRepositories = [...this.visibleRepositories, repository];
      }
    } else {
      const index = this.visibleRepositories.indexOf(repository);

      if (index > -1) {
        this.visibleRepositories = [
          ...this.visibleRepositories.slice(0, index),
          ...this.visibleRepositories.slice(index + 1)
        ];
      }
    }
  }

  async toggleSelectionMode(selectionMode: 'multiple' | 'single'): Promise<void> {
    const scmConfig = config.get('scm')!;
    await config.update('scm', { ...scmConfig, selectionMode });
  }

  private compareRepositories(op1: ISCMRepositoryView, op2: ISCMRepositoryView): number {
    // Sort by name, path
    const name1 = getRepositoryName(op1.repository);
    const name2 = getRepositoryName(op2.repository);

    const nameComparison = name1.localeCompare(name2);
    if (nameComparison === 0 && op1.repository.provider.rootUri && op2.repository.provider.rootUri) {
      return comparePaths(op1.repository.provider.rootUri, op2.repository.provider.rootUri);
    }

    return nameComparison;
  }

  private getMaxSelectionIndex(): number {
    return this._repositories.length === 0 ? -1 :
      Math.max(...this._repositories.map(r => r.selectionIndex));
  }

  private insertRepositoryView(repositories: ISCMRepositoryView[], repositoryView: ISCMRepositoryView): void {
    const index = binarySearch(repositories, repositoryView, this.compareRepositories.bind(this));
    repositories.splice(index < 0 ? ~index : index, 0, repositoryView);
  }

  private saveState(): void {
    if (!this.didFinishLoading) {
      return;
    }

    const all = this.repositories.map(r => getProviderStorageKey(r.provider));
    const visible = this.visibleRepositories.map(r => all.indexOf(getProviderStorageKey(r.provider)));
    this.previousState = { all, visible } satisfies ISCMViewServiceState;
    localStorage.setItem('scmViewVisibleRepositories', JSON.stringify(this.previousState));
  }

  @debounce(5000)
  private eventuallyFinishLoading(): void {
    this.finishLoading();
  }

  private finishLoading(): void {
    if (this.didFinishLoading) {
      return;
    }

    this.didFinishLoading = true;
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this._onDidChangeRepositories.dispose();
    this._onDidSetVisibleRepositories.dispose();
  }
}
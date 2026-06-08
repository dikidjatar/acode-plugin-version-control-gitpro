import { Disposable, DisposableMap, DisposableStore, IDisposable } from "../base/disposable";
import { CollapsableList, IListContextMenuEvent, IListDelegate, IListEvent, unthemedListStyles } from "../base/list";
import { RepositoryRenderer } from "./scmRepositoryRenderer";
import { ISCMCommandService, ISCMMenuService, ISCMRepository, ISCMService, ISCMViewService } from "./types";
import { isSCMRepository } from "./utils";
import { IView } from "./views";

class ListDelegate implements IListDelegate<ISCMRepository> {

  constructor(
    private readonly getSelectedRepositories: () => readonly ISCMRepository[]
  ) { }

  getHeight(element: ISCMRepository): number {
    return 34;
  }

  getTemplateId(element: ISCMRepository): string {
    return RepositoryRenderer.TEMPLATE_ID;
  }

  isSupportedSwipeRight(element: ISCMRepository): boolean {
    const selectedRepositories = this.getSelectedRepositories();
    if (selectedRepositories.length === 1) {
      return isSCMRepository(element) && selectedRepositories[0] !== element;
    }
    return isSCMRepository(element);
  }
}

export class ScmRepositoriesView extends Disposable.Disposable implements IView {
  readonly id: string = 'SCM Repositories View';

  private list!: CollapsableList<ISCMRepository>;

  private readonly visibilityDisposables = new DisposableStore();
  private readonly repositoryDisposables = new DisposableMap<ISCMRepository>();
  private disposables: IDisposable[] = [];

  constructor(
    private container: HTMLElement,
    private readonly scmService: ISCMService,
    private readonly scmViewService: ISCMViewService,
    private readonly scmCommandService: ISCMCommandService,
    private readonly scmMenuService: ISCMMenuService
  ) {
    super();
  }

  render(): void {
    this.createList(this.container);
    this.list.onDidChangeExpansionState(this.onDidChangeExpansionState, this, this.disposables);
    this.onDidChangeExpansionState(true);
  }

  private onDidChangeExpansionState(visible: boolean): void {
    if (!visible) {
      this.visibilityDisposables.clear();
      return;
    }

    this.visibilityDisposables.add(
      this.scmViewService.onDidChangeVisibleRepositories(() => this.updateListSelection())
    );

    this.visibilityDisposables.add(this.scmService.onDidAddRepository(this.onDidAddRepository, this));
    this.visibilityDisposables.add(this.scmService.onDidRemoveRepository(this.onDidRemoveRepository, this));
    for (const repository of this.scmService.repositories) {
      this.onDidAddRepository(repository);
    }
  }

  private createList(container: HTMLElement): void {
    this.list = new CollapsableList<ISCMRepository>(
      'Repositories',
      container,
      new ListDelegate(() => this.scmViewService.visibleRepositories),
      [new RepositoryRenderer(false, this.scmViewService, this.scmCommandService, this.scmMenuService)],
      {
        allCaps: true,
        icon: 'indicator',
        expanded: true
      }
    );
    this.list.title.dataset.type = 'root';
    this.list.style(unthemedListStyles);

    this._register(this.list);
    this._register(this.list.onDidChangeSelection(this.onListSelectionChange, this));
    this._register(this.list.onContextMenu(this.onListContextMenu, this));
    this._register(this.list.onDidSwipeRightSelect(this.onListSwipeRightSelect, this));
  }
  private onDidAddRepository(repository: ISCMRepository): void {
    const disposable = new DisposableStore();
    this.repositoryDisposables.set(repository, disposable);
    this.updateRepositories();
  }

  private onDidRemoveRepository(repository: ISCMRepository): void {
    this.repositoryDisposables.deleteAndDispose(repository);
    this.updateRepositories();
  }

  private onListContextMenu(e: IListContextMenuEvent<ISCMRepository>): void {
    if (!e.element) {
      return;
    }

    if (isSCMRepository(e.element)) {
      const provider = e.element.provider;
      const menus = this.scmViewService.menus.getRepositoryMenus(provider);
      const menu = menus.getRepositoryContextMenu(e.element);

      const target = e.anchor instanceof MouseEvent
        ? (e.anchor.target as HTMLElement)
        : e.anchor;

      this.scmMenuService.showContextMenu({
        toggler: target,
        getActions: (submenu) => {
          if (!submenu) {
            return menu.getSecondaryActions();
          } else {
            return menus.getSubmenu(menu, submenu).getSecondaryActions();
          }
        },
        onSelect: (id: string) => {
          this.scmCommandService.executeCommand(id, provider);
        }
      });
    }
  }

  private async updateRepositories(): Promise<void> {
    const repositories = this.scmViewService.repositories;
    const currentLength = this.list.length;

    this.list.splice(0, currentLength, repositories);

    setTimeout(() => this.updateListSelection(), 0);
  }

  private onListSelectionChange(e: IListEvent<ISCMRepository>): void {
    if (e.browserEvent && e.elements.length > 0) {
      const scrollTop = this.list.scrollTop;

      if (e.elements.every(e => isSCMRepository(e))) {
        this.scmViewService.visibleRepositories = e.elements;
      }

      this.list.scrollTop = scrollTop;
    }
  }

  private onListSwipeRightSelect(e: IListEvent<ISCMRepository>): void {
    if (e.elements.length === 0) {
      return;
    }

    const repository = e.elements[0];
    if (!isSCMRepository(repository)) {
      return;
    }

    const scrollTop = this.list.scrollTop;
    const currentlyVisible = this.scmViewService.visibleRepositories;
    const isVisible = this.scmViewService.isVisible(repository);

    if (isVisible) {
      // Deselect but keep at least one repository visible at all times.
      if (currentlyVisible.length > 1) {
        this.scmViewService.visibleRepositories = currentlyVisible.filter(r => r !== repository);
      }
    } else {
      // Add to the visible
      this.scmViewService.visibleRepositories = [...currentlyVisible, repository];
    }

    this.list.scrollTop = scrollTop;
  }

  private updateListSelection(): void {
    const oldSelection = this.list.getSelectedElements();
    const oldSet = new Set(oldSelection);

    const set = new Set(this.scmViewService.visibleRepositories);
    const added = new Set(Array.from(set).filter(r => !oldSet.has(r)));
    const removed = new Set(Array.from(oldSet).filter(r => !set.has(r)));

    if (added.size === 0 && removed.size === 0) {
      return;
    }

    const selection = oldSelection.filter(repo => !removed.has(repo));

    for (const repo of this.scmViewService.repositories) {
      if (added.has(repo)) {
        selection.push(repo);
      }
    }

    this.list.setSelection(selection.map(s => this.list.indexOf(s)));
  }

  override dispose(): void {
    this.visibilityDisposables.dispose();
    this.disposables = Disposable.dispose(this.disposables);
    super.dispose();
  }
}
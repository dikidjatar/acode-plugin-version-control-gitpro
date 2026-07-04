import { DisposableStore, IDisposable } from "../base/disposable";
import { Event } from "../base/event";
import { IListRenderer } from "../base/list";
import { Separator as SCMMenuSeparator } from "./menus";
import { ISCMCommandService, ISCMMenuItemAction, ISCMMenuService, ISCMRepository, ISCMViewService } from "./types";
import { renderLabelWithIcon2 } from "./utils";

/**
 * Width in px taken by a single action-item icon + minimal padding.
 * Must stay in sync with `.tile.scm-provider > .actions .action-item` in style.scss.
 * min-width: 18px + padding-left: 4px = 22px.
 */
const ACTION_ITEM_WIDTH = 22;

class RepositoryAction implements IDisposable {
  private actionContainer: HTMLElement;
  private repository: ISCMRepository | undefined;
  private disposables = new DisposableStore();

  private resizeObserver!: ResizeObserver;
  private renderScheduled = false;

  /**
   * Primary/navigation actions that don't currently fit inline the toolbar
   * and were pushed into the secondary action" menu instead, mirroring
   */
  private overflowingPrimaryActions: ISCMMenuItemAction[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly shouldRenderPrimaryAction: boolean,
    private readonly scmViewService: ISCMViewService,
    private readonly scmCommandService: ISCMCommandService,
    private readonly scmMenuService: ISCMMenuService
  ) {
    this.actionContainer = container.appendChild(tag('ul', { className: 'actions-container' }));
    this.observeResize();
  }

  private observeResize(): void {
    this.resizeObserver = new ResizeObserver(() => this.scheduleRenderActions());
    this.resizeObserver.observe(this.container);
  }

  private scheduleRenderActions(): void {
    if (this.renderScheduled) {
      return;
    }

    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.renderActions();
    });
  }

  setRepository(repository: ISCMRepository): void {
    this.clear();
    this.repository = repository;

    repository.provider.onDidChange(() => this.renderActions(), null, this.disposables);

    const menus = this.scmViewService.menus.getRepositoryMenus(repository.provider);
    const menu = menus.getRepositoryMenu(repository);

    this.disposables.add(menu);
    this.disposables.add(menu.onDidChange(() => this.renderActions()));
    this.renderActions();
  }

  private renderActions(): void {
    if (!this.repository) {
      return;
    }

    while (this.actionContainer.firstChild) {
      this.actionContainer.firstChild.remove();
    }

    this.overflowingPrimaryActions = [];

    // Render provider command actions from provider.commandActions
    const commandActions = (this.repository.provider.commandActions || [])
      .filter(action => action.title.trim().length > 0);

    commandActions.forEach(action => {
      const label = action.icon ? `$(${action.icon})` : action.title;
      const actionItem = this.createActionItem(renderLabelWithIcon2(label), () => {
        editorManager.editor.execCommand(action.id, ...(action.arguments || []));
      });
      this.actionContainer.appendChild(actionItem);
    });
    this.container.style.minWidth = `${(commandActions.length * ACTION_ITEM_WIDTH) + ACTION_ITEM_WIDTH}px`;

    this.renderPrimaryActions(commandActions.length);
    this.renderSecondaryAction();
  }

  private renderPrimaryActions(commandActionCount: number): void {
    if (!this.shouldRenderPrimaryAction) {
      return;
    }

    const menus = this.scmViewService.menus.getRepositoryMenus(this.repository!.provider);
    const menu = menus.getRepositoryMenu(this.repository!);

    const primaryActions = menu.getPrimaryActions();
    if (primaryActions.length === 0) {
      return;
    }

    const renderedItems: HTMLElement[] = [];
    primaryActions.forEach(action => {
      const label = action.icon ? `<span class="icon ${action.icon}"></span>` : action.title;
      const actionItem = this.createActionItem(label, () => {
        this.scmCommandService.executeCommand(action.id, this.repository!.provider);
      });
      actionItem.classList.toggle('disabled', !action.enabled);
      this.actionContainer.appendChild(actionItem);
      renderedItems.push(actionItem);
    });

    const availableWidth = this.container.clientWidth;
    if (availableWidth <= 0) {
      return;
    }

    const maxVisibleItems = Math.floor(availableWidth / ACTION_ITEM_WIDTH);
    const hasSecondaryActions = menu.hasSecondaryActions();
    const totalItemsIfAllInline = commandActionCount + primaryActions.length + (hasSecondaryActions ? 1 : 0);

    if (totalItemsIfAllInline <= maxVisibleItems) {
      return;
    }

    // From here on we know we'll need the secondary actions toggle no matter
    // what either it already existed or we now have overflow to hold,
    // so always reserve a slot for it.
    const maxPrimaryVisible = Math.max(0, maxVisibleItems - commandActionCount - 1);

    for (let i = maxPrimaryVisible; i < renderedItems.length; i++) {
      renderedItems[i].remove();
      this.overflowingPrimaryActions.push(primaryActions[i]);
    }
  }

  private renderSecondaryAction(): void {
    const menus = this.scmViewService.menus.getRepositoryMenus(this.repository!.provider);
    const menu = menus.getRepositoryMenu(this.repository!);

    if (!menu.hasSecondaryActions() && this.overflowingPrimaryActions.length === 0) {
      return;
    }

    const secondaryActionToggler = this.createActionItem(`<span class="icon more_vert"></span>`, () => {
      this.scmMenuService.showContextMenu({
        toggler: secondaryActionToggler!,
        getActions: (submenu) => this.getActions(submenu),
        onSelect: (id) => {
          this.scmCommandService.executeCommand(id, this.repository!.provider);
        }
      });
    });
    this.actionContainer.appendChild(secondaryActionToggler);
  }

  private createActionItem(label: string, onClick: () => void): HTMLElement {
    const actionItem = tag('li', { className: 'action-item' });
    const actionLabel = actionItem.appendChild(tag('div', { className: 'action-label' }));
    actionLabel.innerHTML = label;
    Event.fromDOMEvent(actionItem, 'click')(e => {
      e.stopPropagation();
      onClick();
    }, undefined, this.disposables);
    return actionItem;
  }

  private getActions(submenu?: string): ISCMMenuItemAction[] {
    const menus = this.scmViewService.menus.getRepositoryMenus(this.repository!.provider);
    const repositoryMenu = menus.getRepositoryMenu(this.repository!);

    if (submenu) {
      const menu = menus.getSubmenu(repositoryMenu, submenu);
      return menu.getSecondaryActions();
    }

    const secondaryActions = repositoryMenu.getSecondaryActions();

    if (this.overflowingPrimaryActions.length === 0) {
      return secondaryActions;
    }

    // Overflowed primary/navigation actions surface
    // at the top of the secondary actions menu
    return secondaryActions.length > 0
      ? [...this.overflowingPrimaryActions, new SCMMenuSeparator(), ...secondaryActions]
      : [...this.overflowingPrimaryActions];
  }

  private clear(): void {
    this.disposables.clear();
    this.repository = undefined;
    this.overflowingPrimaryActions = [];
    while (this.actionContainer.firstChild) {
      this.actionContainer.firstChild.remove();
    }
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.actionContainer.remove();
    this.disposables.dispose();
  }
}

export interface RepositoryTemplate {
  readonly icon: HTMLElement;
  readonly label: HTMLElement;
  readonly action: RepositoryAction;
  readonly elementDisposables: DisposableStore;
  readonly templateDisposables: DisposableStore;
}

export class RepositoryRenderer implements IListRenderer<ISCMRepository, RepositoryTemplate> {
  public static readonly TEMPLATE_ID = 'repositories';

  get templateId(): string { return RepositoryRenderer.TEMPLATE_ID; }

  constructor(
    private renderPrimaryAction: boolean,
    private scmViewService: ISCMViewService,
    private scmCommandService: ISCMCommandService,
    private scmMenuService: ISCMMenuService
  ) { }

  renderTemplate(container: HTMLElement): RepositoryTemplate {
    container.classList.add('scm-provider');
    const iconLabel = container.appendChild(tag('div', { className: 'icon-label' }));
    const iconLabelContainer = iconLabel.appendChild(tag('div', { className: 'icon-label-container' }));
    const icon = iconLabelContainer.appendChild(tag('span', { className: 'icon' }));
    const label = iconLabelContainer.appendChild(tag('span', { className: 'text' }));

    const templateDisposables = new DisposableStore();
    const actions = container.appendChild(tag('div', { className: 'actions' }));
    const action = new RepositoryAction(actions, this.renderPrimaryAction, this.scmViewService, this.scmCommandService, this.scmMenuService);
    templateDisposables.add(action);
    const elementDisposables = templateDisposables.add(new DisposableStore());

    return { icon, label, action, elementDisposables, templateDisposables };
  }

  renderElement(repository: ISCMRepository, index: number, templateData: RepositoryTemplate): void {
    templateData.elementDisposables.clear();

    const updateIcon = () => {
      const isVisible = this.scmViewService.isVisible(repository);
      const icon = repository.provider.icon
        ? repository.provider.icon
        : 'vscode-codicons_repo';

      const showSelectedIcon = icon === 'vscode-codicons_repo' && isVisible && this.scmViewService.repositories.length > 1;

      templateData.icon.className = showSelectedIcon
        ? `icon ${icon}_selected`
        : `icon ${icon}`;
    }

    // Re-evaluate the icon whenever the visible repository set changes so
    // the selected/unselected state is reflected immediately on click.
    templateData.elementDisposables.add(this.scmViewService.onDidChangeVisibleRepositories(updateIcon));
    updateIcon();

    templateData.label.textContent = repository.provider.name;
    templateData.action.setRepository(repository);
  }

  disposeElement(element: ISCMRepository, index: number, templateData: RepositoryTemplate): void {
    templateData.elementDisposables.clear();
  }

  disposeTemplate(templateData: RepositoryTemplate): void {
    templateData.templateDisposables.dispose();
  }
}
import { DisposableStore, IDisposable } from "../base/disposable";
import { Event } from "../base/event";
import { IListRenderer } from "../base/list";
import { ISCMCommandService, ISCMMenuItemAction, ISCMMenuService, ISCMRepository, ISCMViewService } from "./types";
import { renderLabelWithIcon2 } from "./utils";

class RepositoryAction implements IDisposable {
  private actionContainer: HTMLElement;
  // private primaryActionsContainer: HTMLElement;
  private repository: ISCMRepository | undefined;
  private disposables = new DisposableStore();

  constructor(
    private readonly container: HTMLElement,
    private readonly shouldRenderPrimaryAction: boolean,
    private readonly scmViewService: ISCMViewService,
    private readonly scmCommandService: ISCMCommandService,
    private readonly scmMenuService: ISCMMenuService
  ) {
    this.actionContainer = container.appendChild(tag('ul', { className: 'actions-container' }));
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

    // Render provider command actions from provider.commandActions
    const commandActions = this.repository.provider.commandActions || [];
    commandActions.forEach(action => {
      if (action.title.trim().length === 0) {
        return;
      }
      const actionItem = this.createActionItem(renderLabelWithIcon2(action.title), () => {
        editorManager.editor.execCommand(action.id, ...(action.arguments || []));
      })
      this.actionContainer.appendChild(actionItem);
    });
    this.container.style.minWidth = `${(commandActions.length * 22) + 22}px`;

    this.renderPrimaryActions();
    this.renderSecondaryAction();
  }

  private renderPrimaryActions(): void {
    if (!this.shouldRenderPrimaryAction) {
      return;
    }

    const menus = this.scmViewService.menus.getRepositoryMenus(this.repository!.provider);
    const menu = menus.getRepositoryMenu(this.repository!);

    // Render primary actions
    const primaryActions = menu.getPrimaryActions();
    if (this.shouldRenderPrimaryAction) {
      primaryActions.forEach(action => {
        const actionItem = this.createActionItem(action.title, () => {
          this.scmCommandService.executeCommand(action.id, this.repository!.provider);
        });
        this.actionContainer.appendChild(actionItem);
        actionItem.classList.toggle('disabled', !action.enabled);
      });
      const commandActionLength = this.repository?.provider.commandActions?.length ?? 0;
      this.container.style.minWidth = `${(primaryActions.length * 22) + (commandActionLength * 22) + 22}px`;
    }
  }

  private renderSecondaryAction(): void {
    const menus = this.scmViewService.menus.getRepositoryMenus(this.repository!.provider);
    const menu = menus.getRepositoryMenu(this.repository!);

    if (!menu.hasSecondaryActions()) {
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
    } else {
      return repositoryMenu.getSecondaryActions();
    }
  }

  private clear(): void {
    this.disposables.clear();
    this.repository = undefined;
    while (this.actionContainer.firstChild) {
      this.actionContainer.firstChild.remove();
    }
  }

  dispose(): void {
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
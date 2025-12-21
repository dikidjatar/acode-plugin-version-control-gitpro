import { DisposableStore, IDisposable } from "../base/disposable";
import { Event } from "../base/event";
import { IListRenderer } from "../base/list";
import { ISCMCommandService, ISCMMenuItemAction, ISCMMenuService, ISCMRepository, ISCMViewService } from "./types";

class RepositoryAction implements IDisposable {
  private actionContainer: HTMLElement;
  // private primaryActionsContainer: HTMLElement;
  private repository: ISCMRepository | undefined;
  private disposables = new DisposableStore();

  constructor(
    container: HTMLElement,
    private readonly shouldRenderPrimaryAction: boolean,
    private readonly scmViewService: ISCMViewService,
    private readonly scmCommandService: ISCMCommandService,
    private readonly scmMenuService: ISCMMenuService
  ) {
    this.actionContainer = container.appendChild(tag('div', { className: 'actions-container' }));
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

      const actionItem = tag('li', { className: 'action-item' });
      actionItem.innerHTML = action.title;
      this.actionContainer.appendChild(actionItem);

      Event.fromDOMEvent(actionItem, 'click')(e => {
        e.stopPropagation();
        editorManager.editor.execCommand(action.id, ...(action.arguments || []));
      }, undefined, this.disposables);
    });

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
        const actionItem = tag('li', { className: 'action-item primary-action' });
        actionItem.innerHTML = action.title;
        this.actionContainer.appendChild(actionItem);

        actionItem.classList.toggle('disabled', !action.enabled);
        
        Event.fromDOMEvent(actionItem, 'click')(e => {
          e.stopPropagation();
          this.scmCommandService.executeCommand(action.id, this.repository!.provider);
        }, undefined, this.disposables);
      });
    }
  }

  private renderSecondaryAction(): void {
    const menus = this.scmViewService.menus.getRepositoryMenus(this.repository!.provider);
    const menu = menus.getRepositoryMenu(this.repository!);

    if (!menu.hasSecondaryActions()) {
      return;
    }

    const secondaryActionToggler = tag('li', { className: 'action-item secondary-toggler' });
    secondaryActionToggler.innerHTML = `<span class="icon more_vert"></span>`;
    this.actionContainer.appendChild(secondaryActionToggler);

    Event.fromDOMEvent(secondaryActionToggler, 'click')((e) => {
      e.stopPropagation();
      this.scmMenuService.showContextMenu({
        toggler: secondaryActionToggler!,
        getActions: (submenu) => this.getActions(submenu),
        onSelect: (id) => {
          this.scmCommandService.executeCommand(id, this.repository!.provider);
        }
      });
    }, undefined, this.disposables);
  }

  private getActions(submenu?: string): ISCMMenuItemAction[] {
    const menus = this.scmViewService.menus.getRepositoryMenus(this.repository!.provider);
    if (submenu) {
      const menu = menus.getSubmenu(submenu);
      return menu.getSecondaryActions();
    } else {
      const menu = menus.getRepositoryMenu(this.repository!);
      return menu.getSecondaryActions();
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

    return { icon, label, action, templateDisposables };
  }

  renderElement(repository: ISCMRepository, index: number, templateData: RepositoryTemplate): void {
    templateData.icon.className = repository.provider.icon
      ? `icon ${repository.provider.icon}`
      : 'icon repo';
    templateData.label.textContent = repository.provider.name;
    templateData.action.setRepository(repository);
  }

  disposeTemplate(templateData: RepositoryTemplate): void {
    templateData.templateDisposables.dispose();
  }
}
import { DisposableStore, IDisposable } from "../base/disposable";
import { Emitter, Event } from "../base/event";
import { ISCMMenu, ISCMMenuItem, ISCMMenuItemAction, ISCMMenus, ISCMProvider, ISCMRepository, ISCMRepositoryMenus, ISCMResource, ISCMResourceGroup, ISCMService, SCMMenuContext, SCMMenuRegistry } from "./types";

/**
 * Parses menu group string into group name and order
 * Examples:
 *   "navigation" -> { group: "navigation", order: 0 }
 *   "1_modification@5" -> { group: "1_modification", order: 5 }
 *   "inline@1" -> { group: "inline", order: 1 }
 */
function parseMenuGroup(groupStr?: string): { group: string; order: number; isPrimary: boolean } {
  if (!groupStr) {
    return { group: 'secondary', order: 0, isPrimary: false };
  }

  // Primary groups these appear as inline actions
  const primaryGroups = ['navigation', 'inline'];

  const parts = groupStr.split('@');
  const group = parts[0];
  const order = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  const isPrimary = primaryGroups.includes(group);

  return { group, order: isNaN(order) ? 0 : order, isPrimary };
}

function sortMenuItems(items: ISCMMenuItem[]): ISCMMenuItem[] {
  return items.sort((a, b) => {
    const groupA = parseMenuGroup(a.group);
    const groupB = parseMenuGroup(b.group);

    if (groupA.isPrimary !== groupB.isPrimary) {
      return groupA.isPrimary ? -1 : 1;
    }

    if (groupA.group !== groupB.group) {
      return groupA.group.localeCompare(groupB.group);
    }

    return groupA.order - groupB.order;
  });
}

export class SCMMenuItemAction implements ISCMMenuItemAction {

  constructor(
    public readonly id: string,
    public readonly title: string,
    public readonly submenu: boolean,
    public readonly enabled: boolean
  ) { }

  content(): string {
    if (this.submenu) {
      return `<li data-submenu="${this.id}"${this.enabled ? '' : ' class="disabled"'} tabindex="0">
        <span class="text">${this.title}</span>
        <span class="icon add"></span>
      </li>`;
    } else {
      return `<li data-action="${this.id}"${this.enabled ? '' : ' class="disabled"'} tabindex="0">
        <span class="text">${this.title}</span>
      </li>`;
    }
  }
}

class Separator implements ISCMMenuItemAction {

  readonly id: string = '';
  readonly title: string = '';
  readonly submenu: boolean = false;
  readonly enabled: boolean = true;

  content(): string {
    return '<hr tabindex="0"></hr>';
  }
}

class SCMMenu implements ISCMMenu {

  private _primaryActions: ISCMMenuItemAction[] = [];
  private _secondaryGroups: Map<string, ISCMMenuItemAction[]> = new Map();
  private _onDidChange = new Emitter<void>();
  readonly onDidChange: Event<void> = this._onDidChange.event;

  private readonly disposables = new DisposableStore();

  constructor(private readonly menuId: string, private readonly context: SCMMenuContext) {
    this.build();

    // Listen to menu registry changes
    this.disposables.add(
      SCMMenuRegistry.onDidChangeMenu(changedMenuId => {
        if (changedMenuId === this.menuId) {
          this.rebuild();
        }
      })
    );
  }

  private build(): void {
    const menuItems = SCMMenuRegistry.getMenuItems(this.menuId, this.context);
    const sortedItems = sortMenuItems(menuItems);

    this._primaryActions = [];
    this._secondaryGroups.clear();

    for (const item of sortedItems) {
      const enabled = typeof item.enablement === 'undefined' ? true : item.enablement();
      const action = new SCMMenuItemAction(item.command.id, item.command.title, item.submenu ?? false, enabled);

      const { group, isPrimary } = parseMenuGroup(item.group);

      if (isPrimary) {
        this._primaryActions.push(action);
      } else {
        if (!this._secondaryGroups.has(group)) {
          this._secondaryGroups.set(group, []);
        }
        this._secondaryGroups.get(group)!.push(action);
      }
    }
  }

  private rebuild(): void {
    this.build();
    this._onDidChange.fire();
  }

  getPrimaryActions(): ISCMMenuItemAction[] {
    return this._primaryActions;
  }

  getSecondaryActions(): ISCMMenuItemAction[] {
    const secondaryActions: ISCMMenuItemAction[] = [];

    const sortedGroupNames = [...this._secondaryGroups.keys()].sort();

    for (const groupId of sortedGroupNames) {
      const actions = this._secondaryGroups.get(groupId)!;

      if (secondaryActions.length > 0) {
        secondaryActions.push(new Separator());
      }

      for (const action of actions) {
        secondaryActions.push(action);
      }
    }

    return secondaryActions;
  }

  isEmpty(): boolean {
    return this._primaryActions.length === 0 && this._secondaryGroups.size === 0;
  }

  hasSecondaryActions(): boolean {
    return this._secondaryGroups.size > 0 &&
      Array.from(this._secondaryGroups.values()).some(actions => actions.length > 0);
  }

  dispose(): void {
    this.disposables.dispose();
    this._primaryActions = [];
    this._secondaryGroups.clear();
  }
}

class SCMMenusItem implements IDisposable {

  private _resourceFolderMenu: ISCMMenu | undefined;
  get resourceFolderMenu(): ISCMMenu {
		if (!this._resourceFolderMenu) {
			this._resourceFolderMenu = new SCMMenu('scm/resourceFolder/context', this.context);
		}

		return this._resourceFolderMenu;
	}

  private genericResourceGroupMenu: ISCMMenu | undefined;
  private genericResourceMenu: ISCMMenu | undefined;

  constructor(private context: SCMMenuContext) { }

  getResourceGroupMenu(resourceGroup: ISCMResourceGroup): ISCMMenu {
    if (!this.genericResourceGroupMenu) {
      this.genericResourceGroupMenu = new SCMMenu('scm/resourceGroup/context', this.context);
    }
    return this.genericResourceGroupMenu;
  }

  getResourceMenu(resource: ISCMResource): ISCMMenu {
    if (!this.genericResourceMenu) {
      this.genericResourceMenu = new SCMMenu('scm/resourceState/context', this.context);
    }
    return this.genericResourceMenu;
  }

  dispose(): void {
    this.genericResourceGroupMenu?.dispose();
    this.genericResourceMenu?.dispose();
  }
}

class SCMRepositoryMenus implements IDisposable, ISCMRepositoryMenus {

  private repositoryMenu: ISCMMenu | undefined;
  private repositoryContextMenu: ISCMMenu | undefined;

  private context: SCMMenuContext;

  private readonly resourceGroupMenusItems = new Map<ISCMResourceGroup, SCMMenusItem>();

  private readonly disposables = new DisposableStore();

  constructor(private readonly provider: ISCMProvider) {
    this.context = {
      scmProvider: provider.providerId,
      scmProviderRootUri: provider.rootUri,
      scmProviderHasRoorUri: !!provider.rootUri
    };

    provider.onDidChangeResourceGroups(this.onDidChangeResourceGroups, this, this.disposables);
    this.onDidChangeResourceGroups();
  }

  getRepositoryMenu(repository: ISCMRepository): ISCMMenu {
    if (!this.repositoryMenu) {
      this.repositoryMenu = new SCMMenu('scm/repository/menu', this.context);
    }
    return this.repositoryMenu;
  }

  getRepositoryContextMenu(repository: ISCMRepository): ISCMMenu {
    if (!this.repositoryContextMenu) {
      this.repositoryContextMenu = new SCMMenu('scm/sourceControl', this.context);
    }
    return this.repositoryContextMenu;
  }

  getResourceGroupMenu(group: ISCMResourceGroup): ISCMMenu {
    return this.getOrCreateResourceGroupMenusItem(group).getResourceGroupMenu(group);
  }

  getResourceMenu(resource: ISCMResource): ISCMMenu {
    return this.getOrCreateResourceGroupMenusItem(resource.resourceGroup).getResourceMenu(resource);
  }

  getResourceFolderMenu(group: ISCMResourceGroup): ISCMMenu {
		return this.getOrCreateResourceGroupMenusItem(group).resourceFolderMenu;
	}

  getSubmenu(submenu: string): ISCMMenu {
    return new SCMMenu(submenu, this.context);
  }

  private getOrCreateResourceGroupMenusItem(group: ISCMResourceGroup): SCMMenusItem {
    let result = this.resourceGroupMenusItems.get(group);
    if (!result) {
      this.context.scmResourceGroup = group.id;
      result = new SCMMenusItem(this.context);
      this.resourceGroupMenusItems.set(group, result);
    }
    return result;
  }

  private onDidChangeResourceGroups(): void {
    for (const resourceGroup of this.resourceGroupMenusItems.keys()) {
      if (!this.provider.groups.includes(resourceGroup)) {
        this.resourceGroupMenusItems.get(resourceGroup)?.dispose();
        this.resourceGroupMenusItems.delete(resourceGroup);
      }
    }
  }

  dispose(): void {
    this.repositoryMenu?.dispose();
    this.repositoryContextMenu?.dispose();
    this.resourceGroupMenusItems.forEach(item => item.dispose());
    this.disposables.dispose();
  }
}

export class SCMMenus implements ISCMMenus, IDisposable {

  private readonly disposables = new DisposableStore();
  private readonly menus = new Map<ISCMProvider, { menus: SCMRepositoryMenus; dispose: () => void }>();

  constructor(scmService: ISCMService) {
    scmService.onDidRemoveRepository(this.onDidRemoveRepository, this, this.disposables);
  }

  private onDidRemoveRepository(repository: ISCMRepository): void {
    const menus = this.menus.get(repository.provider);
    menus?.dispose();
    this.menus.delete(repository.provider);
  }

  getRepositoryMenus(provider: ISCMProvider): ISCMRepositoryMenus {
    let result = this.menus.get(provider);

    if (!result) {
      const menus = new SCMRepositoryMenus(provider);
      const dispose = () => {
        menus.dispose();
        this.menus.delete(provider);
      }

      result = { menus, dispose };
    }

    return result.menus;
  }

  dispose(): void {
    this.disposables.dispose();
  }
}
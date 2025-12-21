import { Disposable, IDisposable } from "../base/disposable";
import { Emitter, Event } from "../base/event";
import { ResourceTree } from "./resourceTree";

export const enum ViewMode {
  List = 'list',
  Tree = 'tree'
}

export const defualtScmConfig: ISCMConfig = {
  inputMaxLineCount: 10,
  inputMinLineCount: 1,
  alwaysShowRepositories: true,
  showActionButton: true,
  selectionMode: 'multiple',
  defaultViewMode: 'list'
}

export interface ISCMResourceDecoration {
  icon?: string;
  strikeThrough?: boolean;
  letter?: string;
  color?: string;
}

export interface ISCMResource {
  readonly resourceGroup: ISCMResourceGroup;
  readonly sourceUri: string;
  readonly decorations: ISCMResourceDecoration;
}

export interface ISCMResourceGroup {
  readonly id: string;
  readonly provider: ISCMProvider;

  readonly resources: readonly ISCMResource[];
  readonly resourceTree: ResourceTree<ISCMResource, ISCMResourceGroup>;
  readonly onDidChangeResources: Event<void>;

  readonly label: string;
  readonly hideWhenEmpty?: boolean;

  readonly onDidChange: Event<void>;
}

export interface ISCMProvider extends IDisposable {
  readonly id: string;
  readonly providerId: string;
  readonly label: string;
  readonly name: string;

  readonly groups: readonly ISCMResourceGroup[];
  readonly onDidChangeResourceGroups: Event<void>;
  readonly onDidChangeResources: Event<void>;

  readonly onDidChange: Event<void>;

  readonly rootUri?: string;
  readonly icon?: string;
  readonly count?: number;
  readonly commandActions: ISCMCommandAction[] | undefined;
  readonly actionButton: ISCMActionButtonDescriptor | undefined;
}

export interface ISCMRepository extends IDisposable {
  readonly id: string;
  readonly provider: ISCMProvider;
  readonly input: ISCMInput;
  readonly onDidChangeSelection: Event<boolean>
}

export interface ISCMInputChangeEvent {
  readonly value: string;
}

export interface ISCMActionButtonDescriptor {
  command: ISCMCommandAction;
  secondaryCommands?: ISCMCommandAction[][];
  enabled: boolean;
}

export interface ISCMActionButton {
  readonly type: 'actionButton';
  readonly repository: ISCMRepository;
  readonly buton: ISCMActionButtonDescriptor;
}

export interface ISCMInput {
  readonly repository: ISCMRepository;

  readonly value: string;
  setValue(value: string): void;
  readonly onDidChange: Event<ISCMInputChangeEvent>;

  placeholder: string;
  readonly onDidChangePlaceholder: Event<string>;

  enabled: boolean;
  readonly onDidChangeEnablement: Event<boolean>;

  visible: boolean;
  readonly onDidChangeVisibility: Event<boolean>;
}

export interface ISCMService {
  readonly onDidAddRepository: Event<ISCMRepository>;
  readonly onDidRemoveRepository: Event<ISCMRepository>;
  readonly repositories: ISCMRepository[];

  readonly repositoryCount: number;

  registerSCMProvider(provider: ISCMProvider): ISCMRepository;

  getRepository(id: string): ISCMRepository | undefined;
}

export interface ISCMCommandAction {
  readonly id: string;
  readonly title: string;
  arguments?: unknown[];
}

export interface ISCMMenuItemAction {
  readonly id: string;
  readonly title: string;
  readonly submenu: boolean;
  readonly enabled: boolean;
  content(): string;
}

export interface ISCMMenu extends IDisposable {
  readonly onDidChange: Event<void>;
  getPrimaryActions(): ISCMMenuItemAction[];
  getSecondaryActions(): ISCMMenuItemAction[];
  isEmpty(): boolean;
  hasSecondaryActions(): boolean;
}

export interface ISCMRepositoryMenus {
  getRepositoryMenu(repository: ISCMRepository): ISCMMenu;
  getRepositoryContextMenu(repository: ISCMRepository): ISCMMenu;
  getResourceGroupMenu(group: ISCMResourceGroup): ISCMMenu;
  getResourceMenu(resource: ISCMResource): ISCMMenu;
  getResourceFolderMenu(group: ISCMResourceGroup): ISCMMenu;
  getSubmenu(submenu: string): ISCMMenu;
}

export interface ISCMMenus {
  getRepositoryMenus(provider: ISCMProvider): ISCMRepositoryMenus;
}

export interface ISCMMenuItem {
  command: ISCMCommandAction;
  group?: 'navigation' | string;
  submenu?: boolean;
  enablement?: () => boolean;
  when?: (context: SCMMenuContext) => boolean;
}

export interface SCMMenuContext {
  scmProvider?: string;
  scmProviderRootUri?: string;
  scmProviderHasRoorUri?: boolean;
  scmResourceGroup?: string;
}

export interface ISCMMenuService {
  showContextMenu(delegate: {
    toggler: HTMLElement,
    getActions(submenu?: string): ISCMMenuItemAction[],
    onSelect(id: string): void;
  }): void;
}

export interface ISCMMenuRegistry {
  readonly onDidChangeMenu: Event<string>;
  registerMenuItems(menuId: string, items: ISCMMenuItem[]): IDisposable;
  registerMenuItem(menuId: string, item: ISCMMenuItem): IDisposable;
  getMenuItems(menuId: string, context: SCMMenuContext): ISCMMenuItem[];
}

export const SCMMenuRegistry: ISCMMenuRegistry = new class implements ISCMMenuRegistry {
  private menus = new Map<string, ISCMMenuItem[]>();

  private _onDidChangeMenu = new Emitter<string>();
  readonly onDidChangeMenu: Event<string> = this._onDidChangeMenu.event;

  registerMenuItems(menuId: string, items: ISCMMenuItem[]): IDisposable {
    const disposables: IDisposable[] = [];
    items.forEach(item => {
      disposables.push(this.registerMenuItem(menuId, item));
    });
    return Disposable.create(...disposables);
  }

  registerMenuItem(menuId: string, item: ISCMMenuItem): IDisposable {
    if (!this.menus.has(menuId)) {
      this.menus.set(menuId, []);
    }

    const menuItems = this.menus.get(menuId)!;
    menuItems.push(item);

    this._onDidChangeMenu.fire(menuId);

    return {
      dispose: () => {
        const index = menuItems.indexOf(item);

        if (index !== -1) {
          menuItems.splice(index, 1);
        }

        if (menuItems.length === 0) {
          this.menus.delete(menuId);
        }

        this._onDidChangeMenu.fire(menuId);
      }
    }
  }

  getMenuItems(menuId: string, context: SCMMenuContext): ISCMMenuItem[] {
    const items: ISCMMenuItem[] = [];

    const menuItems = this.menus.get(menuId) || [];
    for (const menu of menuItems) {
      if (menu.when && !menu.when(context)) {
        continue;
      }

      items.push(menu);
    }

    return items;
  }
}

export const enum ISCMRepositorySelectionMode {
  Single = 'single',
  Multiple = 'multiple'
}

export interface ISCMViewVisibleRepositoryChangeEvent {
  readonly added: Iterable<ISCMRepository>;
  readonly removed: Iterable<ISCMRepository>;
}

export interface ISCMViewService extends IDisposable {
  readonly menus: ISCMMenus;

  repositories: ISCMRepository[];
  readonly onDidChangeRepositories: Event<ISCMViewVisibleRepositoryChangeEvent>;

  visibleRepositories: readonly ISCMRepository[];
  readonly onDidChangeVisibleRepositories: Event<ISCMViewVisibleRepositoryChangeEvent>;

  isVisible(repository: ISCMRepository): boolean;
  toggleVisibility(repository: ISCMRepository, visible?: boolean): void;
}

export type SCMRawResource = [
  number /* handle */,
  string /* resourceUri */,
  string | undefined /* icon */,
  boolean /* strike through*/,
  string /* letter */,
  string /* color */
];

export type SCMRawResourceSplice = [
  number /* start */,
  number /* delete count */,
  SCMRawResource[]
];

export type SCMRawResourceSplices = [
  number, /* handle */
  SCMRawResourceSplice[]
];

export interface SCMProviderFeatures {
  count?: number;
  commandActions?: ISCMCommandAction[];
  actionButton?: ISCMActionButtonDescriptor;
}

export interface SCMArgumentProcessor {
  processArgument(arg: any): any;
}

export interface ISCMCommandService {
  registerArgumentProcessor(processor: SCMArgumentProcessor): void;
  executeCommand(commandId: string, ...args: unknown[]): void;
}

export const enum SCMMarshalledId {
  ScmResource,
  ScmResourceGroup,
  ScmProvider
}

export interface IMainSCM {
  setSelectedSourceControl(selectedSourceControlHandle: number | undefined): void;
  onInputBoxValueChange(sourceControlHandle: number, value: string): void;
}
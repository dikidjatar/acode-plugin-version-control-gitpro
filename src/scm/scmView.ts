import { config } from "../base/config";
import { decorationService } from "../base/decorationService";
import { Disposable, DisposableMap, DisposableStore, IDisposable } from "../base/disposable";
import { Emitter, Event } from "../base/event";
import { CollapsableList, IListContextMenuEvent, IListDelegate, IListMouseEvent, IListRenderer } from "../base/list";
import { SCMMenuItemAction } from "./menus";
import { IResourceNode, ResourceTree } from "./resourceTree";
import { RepositoryRenderer } from "./scmRepositoryRenderer";
import { ISCMActionButton, ISCMActionButtonDescriptor, ISCMCommandService, ISCMInput, ISCMMenuItemAction, ISCMMenuService, ISCMRepository, ISCMRepositoryMenus, ISCMResource, ISCMResourceGroup, ISCMSeparator, ISCMService, ISCMViewService, ISCMViewVisibleRepositoryChangeEvent, ViewMode } from "./types";
import { disposableTimeout, isSCMActionButton, isSCMInput, isSCMRepository, isSCMResource, isSCMResourceGroup, isSCMResourceNode, isSCMSeparator, renderLabelWithIcon } from "./utils";
import { IView } from "./views";

const selectmenu = acode.require('select');
const Url = acode.require('Url');

type TreeElement = ISCMRepository | ISCMInput | ISCMActionButton | ISCMSeparator | ISCMResourceGroup | ISCMResource | IResourceNode<ISCMResource, ISCMResourceGroup>;

export class SCMSeparatorRenderer implements IListRenderer<ISCMSeparator, void> {

  static readonly TEMPLATE_ID = 'separator';
  get templateId(): string { return SCMSeparatorRenderer.TEMPLATE_ID; }

  renderTemplate(container: HTMLElement): void {
    container.classList.add('scm-separator');
    container.appendChild(tag('div', { className: 'separator' }));
  }

  renderElement(element: ISCMSeparator, index: number, templateData: void): void {

  }

  disposeTemplate(templateData: void): void {

  }
}

interface ActionButtonTemplate {
  readonly actionButton: SCMActionButton;
  diposable: IDisposable;
  readonly templateDisposable: IDisposable;
}

class ActionButtonRenderer implements IListRenderer<ISCMActionButton, ActionButtonTemplate> {

  static readonly DEFAULT_HEIGHT = 36;

  static readonly TEMPLATE_ID = 'actionButton';
  get templateId(): string { return ActionButtonRenderer.TEMPLATE_ID; }

  private actionButtons = new Map<ISCMActionButton, SCMActionButton>();

  constructor(private scmMenuService: ISCMMenuService) { }

  renderTemplate(container: HTMLElement): ActionButtonTemplate {
    container.classList.add('scm-action-button');
    const buttonContainer = container.appendChild(tag('div', { className: 'button-container' }));
    const actionButton = new SCMActionButton(buttonContainer, this.scmMenuService);
    return { actionButton, diposable: Disposable.None, templateDisposable: actionButton };
  }

  renderElement(actionButton: ISCMActionButton, index: number, templateData: ActionButtonTemplate): void {
    templateData.diposable.dispose();

    const disposables = new DisposableStore();
    templateData.actionButton.setButton(actionButton.buton);

    // Remember action button
    this.actionButtons.set(actionButton, templateData.actionButton);
    disposables.add({ dispose: () => this.actionButtons.delete(actionButton) });

    templateData.diposable = disposables;
  }

  disposeElement(element: ISCMActionButton, index: number, templateData: ActionButtonTemplate): void {
    templateData.diposable.dispose();
  }

  disposeTemplate(templateData: ActionButtonTemplate): void {
    templateData.diposable.dispose();
    templateData.templateDisposable.dispose();
  }
}

interface InputTemplate {
  readonly inputWidget: SCMInputWidget;
  inputWidgetHeight: number;
  readonly elementDisposables: DisposableStore;
  readonly templateDisposable: IDisposable;
}

let WIDGET_ID = 0;

class InputRenderer implements IListRenderer<ISCMInput, InputTemplate> {

  public static readonly DEFAULT_HEIGHT = 34;

  public static readonly TEMPLATE_ID = 'input';
  get templateId(): string { return InputRenderer.TEMPLATE_ID; }

  private inputWidgets = new Map<ISCMInput, SCMInputWidget>();
  private contentHeights = new WeakMap<ISCMInput, number>();

  constructor(private updateHeight: (input: ISCMInput, height: number) => void) { }

  renderTemplate(container: HTMLElement): InputTemplate {
    container.classList.add('scm-input');

    const templateDisposable = new DisposableStore();
    const inputWidget = new SCMInputWidget(container);
    templateDisposable.add(inputWidget);

    return { inputWidget, inputWidgetHeight: InputRenderer.DEFAULT_HEIGHT, elementDisposables: new DisposableStore(), templateDisposable };
  }

  renderElement(input: ISCMInput, index: number, templateData: InputTemplate): void {
    templateData.inputWidget.input = input;

    // Remember widget
    this.inputWidgets.set(input, templateData.inputWidget);
    templateData.elementDisposables.add({
      dispose: () => this.inputWidgets.delete(input)
    });

    // Reset widget height so it's recalculated
    templateData.inputWidgetHeight = InputRenderer.DEFAULT_HEIGHT;

    // Rerender the element whenever the editor content height changes
    const onDidChangeContentHeight = () => {
      const contentHeight = templateData.inputWidget.getContentHeight();
      this.contentHeights.set(input, contentHeight);

      if (templateData.inputWidgetHeight !== contentHeight) {
        this.updateHeight(input, contentHeight);
        templateData.inputWidgetHeight = contentHeight;
      }
    };

    const startListeningContentHeightChange = () => {
      templateData.elementDisposables.add(templateData.inputWidget.onDidChangeContentHeight(onDidChangeContentHeight));
      onDidChangeContentHeight();
    };

    // Setup height change listener on next tick
    disposableTimeout(startListeningContentHeightChange, 0, templateData.elementDisposables);
  }

  disposeElement(element: ISCMInput, index: number, templateData: InputTemplate): void {
    templateData.elementDisposables.clear();
  }

  disposeTemplate(templateData: InputTemplate): void {
    templateData.elementDisposables.dispose();
    templateData.templateDisposable.dispose();
  }

  getHeight(input: ISCMInput): number {
    return (this.contentHeights.get(input) ?? InputRenderer.DEFAULT_HEIGHT);
  }

  getRenderedInputWidget(input: ISCMInput): SCMInputWidget | undefined {
    return this.inputWidgets.get(input);
  }
}

interface ResourceGroupTemplate {
  readonly container: HTMLElement;
  readonly icon: HTMLElement;
  readonly name: HTMLElement;
  readonly count: HTMLElement;
  readonly elementDisposables: DisposableStore;
}

class ResourceGroupRenderer implements IListRenderer<ISCMResourceGroup, ResourceGroupTemplate> {
  public static readonly TEMPLATE_ID = 'resource group';
  get templateId(): string { return ResourceGroupRenderer.TEMPLATE_ID; }

  constructor(
    private isCollapsed: (group: ISCMResourceGroup) => boolean
  ) { }

  renderTemplate(container: HTMLElement): ResourceGroupTemplate {
    container.classList.add('resource-group');
    const icon = container.appendChild(tag('span', { className: 'icon indicator' }));
    const name = container.appendChild(tag('span', { className: 'text' }));
    const countContainer = container.appendChild(tag('span', { className: 'count-container' }));
    const count = countContainer.appendChild(tag('span', { className: 'count' }));
    return { container, icon, name, count, elementDisposables: new DisposableStore() };
  }

  renderElement(group: ISCMResourceGroup, index: number, templateData: ResourceGroupTemplate): void {
    const collapsed = this.isCollapsed(group);

    if (collapsed) {
      templateData.container.classList.remove('expanded');
    } else {
      templateData.container.classList.add('expanded');
    }

    templateData.name.textContent = group.label;
    templateData.count.textContent = `${group.resources.length}`;
  }

  disposeElement(element: ISCMResourceGroup, index: number, templateData: ResourceGroupTemplate): void {
    templateData.elementDisposables.clear();
  }

  disposeTemplate(templateData: ResourceGroupTemplate): void {
    templateData.elementDisposables.dispose();
  }
}

interface ResourceTemplate {
  readonly container: HTMLElement;
  readonly name: HTMLElement;
  readonly icon: HTMLElement;
  readonly letter: HTMLElement;
  readonly elementDisposables: DisposableStore;
}

function getDepth(node: IResourceNode<any, any> | undefined): number {
  let depth = 0;
  while (node && node.parent) {
    depth++;
    node = node.parent;
  }
  return depth;
}

class ResourceRenderer implements IListRenderer<ISCMResource | IResourceNode<ISCMResource, ISCMResourceGroup>, ResourceTemplate> {

  public static readonly TEMPLATE_ID = 'resource';
  get templateId(): string { return ResourceRenderer.TEMPLATE_ID; }

  constructor(private viewMode: () => ViewMode) { }

  renderTemplate(container: HTMLElement): ResourceTemplate {
    const icon = container.appendChild(tag('span'));
    const name = container.appendChild(tag('span', { className: 'text' }));
    const letter = container.appendChild(tag('span', { className: 'letter' }));
    return { container, name, icon, letter, elementDisposables: new DisposableStore() };
  }

  renderElement(resourceOrFolder: ISCMResource | IResourceNode<ISCMResource, ISCMResourceGroup>, index: number, templateData: ResourceTemplate): void {
    const isNode = ResourceTree.isResourceNode(resourceOrFolder);
    const uri = isNode ? resourceOrFolder.uri : resourceOrFolder.sourceUri;
    const fileName = isNode ? resourceOrFolder.name : (uri.split('/').pop() || uri);

    let depth = 0;

    if (this.viewMode() === ViewMode.Tree) {
      if (isNode) {
        depth = getDepth(resourceOrFolder);
      } else {
        if (resourceOrFolder.resourceGroup) {
          const node = resourceOrFolder.resourceGroup.resourceTree.getNode(uri);
          depth = getDepth(node);
        }
      }
    }

    templateData.container.classList.add('resource');
    templateData.container.style.paddingLeft = `${depth * 20}px`;

    if (isNode) {
      templateData.icon.className = 'icon folder';
      templateData.name.textContent = fileName;
    } else {
      templateData.name.textContent = fileName;
      templateData.icon.className = resourceOrFolder.decorations.icon || '';

      if (resourceOrFolder.decorations.strikeThrough) {
        templateData.name.classList.add('strike-through');
        templateData.elementDisposables.add(Disposable.toDisposable(() => {
          templateData.name.classList.remove('strike-through');
        }));
      }

      const decoration = decorationService.getDecoration(uri);

      if (decoration?.badge) {
        templateData.letter.textContent = decoration.badge;
        if (decoration.color) templateData.letter.style.color = decoration.color;
      }
    }

    templateData.container.dataset.type = isNode ? 'dir' : 'file';
    templateData.container.dataset.name = fileName;
  }

  disposeElement(element: ISCMResource | IResourceNode<ISCMResource, ISCMResourceGroup>, index: number, template: ResourceTemplate): void {
    template.elementDisposables.clear();
  }

  disposeTemplate(template: ResourceTemplate): void {
    template.elementDisposables.dispose();
  }
}

class ListDelegate implements IListDelegate<TreeElement> {

  constructor(private readonly inputRenderer: InputRenderer) { }

  getHeight(element: TreeElement): number {
    if (isSCMInput(element)) {
      return this.inputRenderer.getHeight(element);
    } else if (isSCMActionButton(element)) {
      return ActionButtonRenderer.DEFAULT_HEIGHT + 8;
    } else if (isSCMSeparator(element)) {
      return 5;
    } else {
      return 30;
    }
  }

  getTemplateId(element: TreeElement): string {
    if (isSCMRepository(element)) {
      return RepositoryRenderer.TEMPLATE_ID;
    } else if (isSCMInput(element)) {
      return InputRenderer.TEMPLATE_ID;
    } else if (isSCMActionButton(element)) {
      return ActionButtonRenderer.TEMPLATE_ID;
    } else if (isSCMSeparator(element)) {
      return SCMSeparatorRenderer.TEMPLATE_ID;
    } else if (isSCMResourceGroup(element)) {
      return ResourceGroupRenderer.TEMPLATE_ID;
    } else if (isSCMResource(element) || isSCMResourceNode(element)) {
      return ResourceRenderer.TEMPLATE_ID;
    } else {
      throw new Error('Unknown element');
    }
  }
}

class SCMInputWidget {
  readonly id: string;

  private _input: ISCMInput | undefined;
  private readonly inputElement: HTMLTextAreaElement;

  private readonly repositoryDisposables = new DisposableStore();
  private readonly disposables = new DisposableStore();

  private _onDidChangeContentHeight = new Emitter<void>()
  readonly onDidChangeContentHeight: Event<void> = this._onDidChangeContentHeight.event;

  get input(): ISCMInput | undefined {
    return this._input;
  }

  set input(input: ISCMInput | undefined) {
    if (input === this.input) {
      return;
    }

    this.repositoryDisposables.clear();

    if (!input) {
      this.inputElement.value = '';
      this._input = undefined;
      return;
    }

    this.inputElement.value = input.value;

    const updatePlaceholderText = () => {
      const placeholder = input.placeholder;
      this.inputElement.placeholder = placeholder;
    }
    this.repositoryDisposables.add(input.onDidChangePlaceholder(updatePlaceholderText));
    updatePlaceholderText();

    const updateEnablement = (enabled: boolean) => {
      this.inputElement.disabled = !enabled;
    };
    this.repositoryDisposables.add(input.onDidChangeEnablement(enabled => updateEnablement(enabled)));
    updateEnablement(input.enabled);

    this._input = input;
  }

  constructor(container: HTMLElement) {
    this.id = `widget-${WIDGET_ID + 1}`;
    const inputContainer = container.appendChild(tag('div', { className: 'scm-input-container' }));
    this.inputElement = inputContainer.appendChild(tag('textarea', { className: 'input-textarea' }));

    Event.fromDOMEvent(this.inputElement, 'input')(() => {
      if (!this.input) {
        return;
      }

      this.input.setValue(this.inputElement.value);

      const { height } = this.inputElement.getBoundingClientRect();
      const scrollHeight = this.inputElement.scrollHeight;

      if (scrollHeight !== height) {
        this._onDidChangeContentHeight.fire();
      }
    }, null, this.disposables);
  }

  getContentHeight(): number {
    const lineHeight = 16;
    const height = this.inputElement.scrollHeight;

    const scmConfig = config.get('scm');

    const inputMinLinesConfig = scmConfig?.inputMinLineCount
    const inputMinLines = typeof inputMinLinesConfig === 'number' ? Math.min(Math.max(inputMinLinesConfig, 1), 20) : 1;
    const editorMinHeight = inputMinLines * lineHeight

    const inputMaxLinesConfig = scmConfig?.inputMaxLineCount
    const inputMaxLines = typeof inputMaxLinesConfig === 'number' ? Math.min(Math.max(inputMaxLinesConfig, 1), 20) : 10;
    const editorMaxHeight = inputMaxLines * lineHeight

    const result = Math.min(Math.max(height, editorMinHeight), editorMaxHeight);
    return result;
  }

  dispose(): void {
    this.input = undefined;
    this.repositoryDisposables.dispose();
    this.disposables.dispose();
  }
}

interface RepositoryTreeState {
  repository: ISCMRepository;
  elements: TreeElement[];
}

export class SCMView extends Disposable.Disposable implements IView {

  readonly id: string = 'SCM View';

  private listScrollTop: number | undefined;
  private list!: CollapsableList<TreeElement>;

  private inputRenderer!: InputRenderer;
  private actionButtonRenderer!: ActionButtonRenderer;
  private collapsedResourceGroups = new Set<ISCMResourceGroup>();
  private expandedNodes = new Set<IResourceNode<ISCMResource, ISCMResourceGroup>>();

  private repositoryStates = new Map<ISCMRepository, RepositoryTreeState>();
  private readonly items = new DisposableMap<ISCMRepository, IDisposable>();
  private visibilityDisposables = new DisposableStore();
  private disposables = new DisposableStore();

  private _viewMode: ViewMode = ViewMode.List;
  get viewMode(): ViewMode { return this._viewMode; }
  set viewMode(mode: ViewMode) {
    if (this._viewMode === mode) {
      return;
    }

    this._viewMode = mode;
    this.updateAllRepositories();
  }

  constructor(
    private container: HTMLElement,
    private readonly scmService: ISCMService,
    private readonly scmViewService: ISCMViewService,
    private readonly scmCommandService: ISCMCommandService,
    private readonly scmMenuService: ISCMMenuService
  ) {
    super();

    const updateViewMode = () => {
      const scmConfig = config.get('scm')!;
      this._viewMode = scmConfig.defaultViewMode === 'list' ? ViewMode.List : ViewMode.Tree;
    }
    Event.filter(config.onDidChangeConfiguration, e => e.affectsConfiguration('scm.defaultViewMode'))(updateViewMode, null, this.disposables);
    updateViewMode();
  }

  get title(): HTMLElement {
    return this.list.title;
  }

  render(): void {
    this.createList(this.container);

    this.list.onDidChangeExpansionState(this.onDidChangeExpansionState, this, this.disposables);
    this.onDidChangeExpansionState(true);
  }

  private onDidChangeExpansionState(visible: boolean): void {
    if (visible) {
      Event.filter(config.onDidChangeConfiguration,
        e =>
          e.affectsConfiguration('scm.alwaysShowRepositories') ||
          e.affectsConfiguration('scm.inputMinLineCount') ||
          e.affectsConfiguration('scm.inputMaxLineCount') ||
          e.affectsConfiguration('scm.showActionButton'))
        (() => this.updateAllRepositories(), this, this.visibilityDisposables);

      this.scmViewService.onDidChangeVisibleRepositories(this.onDidChangeVisibleRepositories, this, this.visibilityDisposables);
      this.onDidChangeVisibleRepositories({ added: this.scmViewService.visibleRepositories, removed: [] });

      // Restore scroll position
      if (typeof this.listScrollTop === "number") {
        this.list.scrollTop = this.listScrollTop;
        this.listScrollTop = undefined;
      }
    } else {
      this.visibilityDisposables.clear();
      this.list.splice(0, this.list.length, []);
      this.onDidChangeVisibleRepositories({ added: [], removed: [...this.items.keys()] });
      this.listScrollTop = this.list.scrollTop;
    }
  }

  private createList(container: HTMLElement): void {
    this.inputRenderer = new InputRenderer((input, height) => {
      this.list.updateElementHeight(input, height);
    });
    this.actionButtonRenderer = new ActionButtonRenderer(this.scmMenuService);

    const resourceGroupRenderer = new ResourceGroupRenderer(
      (group) => this.collapsedResourceGroups.has(group)
    );

    const resourceRenderer = new ResourceRenderer(() => this.viewMode);

    this.list = new CollapsableList(
      'Changes',
      container,
      new ListDelegate(this.inputRenderer),
      [
        this.inputRenderer,
        this.actionButtonRenderer,
        new RepositoryRenderer(true, this.scmViewService, this.scmCommandService, this.scmMenuService),
        new SCMSeparatorRenderer(),
        resourceGroupRenderer,
        resourceRenderer
      ],
      {
        allCaps: true,
        icon: 'indicator',
        expanded: true
      }
    );
    this.list.title.dataset.type = 'root';
    this._register(this.list);
    this._register(this.list.onMouseClick(this.onListClick, this));
    this._register(this.list.onContextMenu(this.onListContextMenu, this));
    this._register(this.list.onDidChangeContentHeight(this.updateHeight, this));

    const onResize = () => {
      this.updateHeight(this.list.contentHeight);
    }

    window.addEventListener('resize', onResize);
    this.disposables.add(Disposable.toDisposable(() => {
      window.removeEventListener('resize', onResize);
    }));
  }

  private toggleResourceGroup(group: ISCMResourceGroup): void {
    if (this.collapsedResourceGroups.has(group)) {
      this.collapsedResourceGroups.delete(group);
    } else {
      this.collapsedResourceGroups.add(group);
    }

    const provider = group.provider;
    const repository = this.scmService.repositories.find(r => r.provider === provider);
    if (repository) {
      this.updateRepositoryElements(repository);
    }
  }

  private getTreeElements(group: ISCMResourceGroup): TreeElement[] {
    const elements: TreeElement[] = [];
    const root = group.resourceTree.root;

    const traverse = (node: IResourceNode<ISCMResource, ISCMResourceGroup>) => {
      const children = [...node.children]
        .sort((a, b) => {
          const aIsFolder = a.childrenCount > 0;
          const bIsFolder = b.childrenCount > 0;

          if (aIsFolder && !bIsFolder) return -1;
          if (!aIsFolder && bIsFolder) return 1;
          return a.name.localeCompare(b.name);
        });

      for (const child of children) {
        if (child.element && child.childrenCount === 0) {
          elements.push(child.element);
        } else {
          elements.push(child);

          if (this.expandedNodes.has(child)) {
            traverse(child);
          }
        }
      }
    };

    traverse(root);
    return elements;
  }

  private buildRepositoryElements(repository: ISCMRepository): TreeElement[] {
    const scmConfig = config.get('scm');
    const showActionButton = scmConfig?.showActionButton === true;
    const alwaysShowRepositories = scmConfig?.alwaysShowRepositories === true;
    const repositoriesCount = this.scmViewService.visibleRepositories.length;

    const elements: TreeElement[] = [];
    const actionButton = repository.provider.actionButton;
    const resourceGroups = repository.provider.groups;

    if (repositoriesCount > 1 || alwaysShowRepositories) {
      elements.push(repository);
    }

    if (repository.input.visible) {
      elements.push(repository.input);
    }

    if (showActionButton && actionButton) {
      elements.push({
        type: 'actionButton',
        repository,
        buton: actionButton
      });
    }

    for (const group of resourceGroups) {
      if (group.resources.length === 0 && group.hideWhenEmpty) {
        continue;
      }

      elements.push(group);

      const isCollapsed = this.collapsedResourceGroups.has(group);
      if (!isCollapsed) {

        if (this.viewMode === ViewMode.List) {
          elements.push(...group.resources);
        } else {
          elements.push(...this.getTreeElements(group));
        }
      }
    }

    if (repositoriesCount > 1) {
      elements.push({ type: 'separator' } as ISCMSeparator);
    }

    return elements;
  }

  private updateRepositoryElements(repository: ISCMRepository): void {
    const newElements = this.buildRepositoryElements(repository);
    const previousState = this.repositoryStates.get(repository);

    this.repositoryStates.set(repository, { repository, elements: newElements });

    if (!this.scmViewService.isVisible(repository)) {
      return;
    }

    if (!previousState) {
      const insertionIndex = this.findRepositoryInsertionIndex(repository);
      this.list.splice(insertionIndex, 0, newElements);
      return;
    }

    const oldElements = previousState.elements;
    const startIndex = this.findRepositoryStartIndex(repository);

    if (startIndex === -1) {
      const insertionIndex = this.findRepositoryInsertionIndex(repository);
      this.list.splice(insertionIndex, 0, newElements);
      return;
    }

    this.list.splice(startIndex, oldElements.length, newElements);
  }

  private findRepositoryStartIndex(repository: ISCMRepository): number {
    const providerId = repository.provider.id;

    for (let i = 0; i < this.list.length; i++) {
      const element = this.list.element(i);
      const elementProviderId = this.getElementProviderId(element);

      if (elementProviderId === providerId) {
        return i;
      }
    }

    return -1;
  }

  private findRepositoryInsertionIndex(repository: ISCMRepository): number {
    const visibleRepos = this.scmViewService.visibleRepositories;
    const targetIndex = visibleRepos.indexOf(repository);

    if (targetIndex === 0) {
      return 0;
    }

    const previousRepo = visibleRepos[targetIndex - 1];
    const previousState = this.repositoryStates.get(previousRepo);

    if (!previousState) {
      return 0;
    }

    const previousStartIndex = this.findRepositoryStartIndex(previousRepo);
    if (previousStartIndex === -1) {
      return 0;
    }

    return previousStartIndex + previousState.elements.length;
  }

  private getElementProviderId(element: TreeElement): string | undefined {
    if (isSCMRepository(element)) {
      return element.provider.id;
    } else if (isSCMInput(element)) {
      return element.repository.provider.id;
    } else if (isSCMActionButton(element)) {
      return element.repository.provider.id;
    } else if (isSCMResourceGroup(element)) {
      return element.provider.id;
    } else if (isSCMResource(element)) {
      return element.resourceGroup.provider.id;
    } else if (isSCMResourceNode(element)) {
      return element.context.provider.id;
    }
    return undefined;
  }

  private removeRepositoryElements(repository: ISCMRepository): void {
    const state = this.repositoryStates.get(repository);

    if (!state) {
      return;
    }

    const startIndex = this.findRepositoryStartIndex(repository);

    if (startIndex !== -1) {
      this.list.splice(startIndex, state.elements.length, []);
    }

    this.repositoryStates.delete(repository);
  }

  private updateAllRepositories(): void {
    const allElements: TreeElement[] = [];

    for (const repository of this.scmViewService.visibleRepositories) {
      const elements = this.buildRepositoryElements(repository);
      this.repositoryStates.set(repository, { repository, elements });
      allElements.push(...elements);
    }

    this.list.splice(0, this.list.length, allElements);
  }

  private onDidChangeVisibleRepositories({ added, removed }: ISCMViewVisibleRepositoryChangeEvent): void {
    for (const repository of removed) {
      this.removeRepositoryElements(repository);
      this.items.deleteAndDispose(repository);
    }

    for (const repository of added) {
      const repositoryDisposables = new DisposableStore();

      this.updateRepositoryElements(repository);

      repositoryDisposables.add(repository.input.onDidChangeVisibility(() => this.updateRepositoryElements(repository)));
      repositoryDisposables.add(repository.provider.onDidChangeResourceGroups(() => this.updateRepositoryElements(repository)));
      repositoryDisposables.add(repository.provider.onDidChange(() => this.updateRepositoryElements(repository)));

      const resourceGroupDisposables = repositoryDisposables.add(new DisposableMap<ISCMResourceGroup, IDisposable>());

      const onDidChangeResourceGroups = () => {
        for (const [resourceGroup] of resourceGroupDisposables) {
          if (!repository.provider.groups.includes(resourceGroup)) {
            resourceGroupDisposables.deleteAndDispose(resourceGroup);
          }
        }

        for (const resourceGroup of repository.provider.groups) {
          if (!resourceGroupDisposables.has(resourceGroup)) {
            const disposableStore = new DisposableStore();

            disposableStore.add(resourceGroup.onDidChange(() => this.updateRepositoryElements(repository)));
            disposableStore.add(resourceGroup.onDidChangeResources(() => this.updateRepositoryElements(repository)));
            resourceGroupDisposables.set(resourceGroup, disposableStore);
          }
        }
      };

      repositoryDisposables.add(repository.provider.onDidChangeResourceGroups(onDidChangeResourceGroups));
      onDidChangeResourceGroups();

      this.items.set(repository, repositoryDisposables);
    }
  }

  private onListClick(e: IListMouseEvent<TreeElement>): void {
    if (!e.element) {
      return;
    } else if (isSCMRepository(e.element)) {
      return;
    } else if (isSCMInput(e.element)) {
      e.browserEvent.stopPropagation();
    } else if (isSCMActionButton(e.element)) {
      return;
    } else if (isSCMResourceGroup(e.element)) {
      this.toggleResourceGroup(e.element);
      return;
    } else if (isSCMResource(e.element)) {
      e.element.open();
    } else if (isSCMResourceNode(e.element)) {
      const node = e.element;
      if (this.expandedNodes.has(node)) {
        this.expandedNodes.delete(node);
      } else {
        this.expandedNodes.add(node);
      }

      const provider = node.context.provider;
      const repository = this.scmService.repositories.find(r => r.provider === provider);
      if (repository) {
        this.updateRepositoryElements(repository);
      }
      return;
    }
  }

  private async onListContextMenu(e: IListContextMenuEvent<TreeElement>): Promise<void> {
    if (!e.element) {
      return;
    }

    const element = e.element;
    let menus: ISCMRepositoryMenus | undefined;
    let actions: ISCMMenuItemAction[] = [];
    let context: unknown = element;
    let showSelectMenu: boolean = false;
    let selectMenuTitle: string = '';

    if (isSCMRepository(element)) {
      menus = this.scmViewService.menus.getRepositoryMenus(element.provider);
      const menu = menus.getRepositoryContextMenu(element);
      actions = menu.getSecondaryActions();
      context = element.provider;
    } else if (isSCMInput(element) || isSCMActionButton(element)) {
      // noop
    } else if (isSCMResourceGroup(element)) {
      menus = this.scmViewService.menus.getRepositoryMenus(element.provider);
      const menu = menus.getResourceGroupMenu(element);
      actions = menu.getSecondaryActions();
      showSelectMenu = true;
      selectMenuTitle = `Group (${element.label})`;
    } else if (isSCMResource(element)) {
      menus = this.scmViewService.menus.getRepositoryMenus(element.resourceGroup.provider);
      const menu = menus.getResourceMenu(element);
      actions = menu.getSecondaryActions();
      showSelectMenu = true;
      selectMenuTitle = Url.basename(element.sourceUri)!;
    } else if (isSCMResourceNode(element)) {
      if (element.element) {
        const menus = this.scmViewService.menus.getRepositoryMenus(element.element.resourceGroup.provider);
        const menu = menus.getResourceMenu(element.element);
        actions = menu.getSecondaryActions();
        showSelectMenu = true;
        selectMenuTitle = Url.basename(element.element.sourceUri)!;
        context = element.element;
      } else {
        const menus = this.scmViewService.menus.getRepositoryMenus(element.context.provider);
        const menu = menus.getResourceFolderMenu(element.context);
        actions = menu.getSecondaryActions();
        showSelectMenu = true;
        selectMenuTitle = element.name;
        context = collectAllResources(element);
      }
    }

    if (!actions.length) {
      return;
    }

    if (showSelectMenu) {
      const items: Acode.SelectItem[] = [];
      for (const action of actions) {
        items.push({ text: action.title, value: action.id, disabled: !action.enabled });
      }
      const command = await selectmenu(selectMenuTitle, items);

      if (!command) {
        return;
      }

      if (Array.isArray(context)) {
        this.scmCommandService.executeCommand(command, ...context);
      } else {
        this.scmCommandService.executeCommand(command, context);
      }
      return;
    }

    const toggler = e.anchor instanceof MouseEvent
      ? (e.anchor.target as HTMLElement)
      : e.anchor;

    this.scmMenuService.showContextMenu({
      toggler,
      getActions: (submenu: string) => {
        if (submenu) {
          const menu = menus?.getSubmenu(submenu);
          return menu?.getSecondaryActions() ?? [];
        } else {
          return actions;
        }
      },
      onSelect: (id: string) => {
        this.scmCommandService.executeCommand(id, context);
      }
    });
  }

  private updateHeight(contentHeight: number): void {
    const repositoriesCount = this.scmViewService.repositories.length;
    const empty = repositoriesCount === 0;

    const rootHeight = this.container.getBoundingClientRect().height;
    const headerHeight = this.container.querySelector('.header')!.getBoundingClientRect().height;
    const repositoriesViewPaneElement = this.container.querySelectorAll('.list.collapsible')[0] as HTMLElement;
    const repositoriesViewHeight = repositoriesViewPaneElement?.getBoundingClientRect().height || 30;

    const { dispose } = Event.fromDOMEvent(repositoriesViewPaneElement, 'click')(() => {
      this.updateHeight(this.list.contentHeight);
      dispose();
    });

    const size = rootHeight - headerHeight - repositoriesViewHeight;
    const maxSize = Math.min(contentHeight + 30, size);

    if (this.list.isExpanded()) {
      this.list.layout(empty ? Number.POSITIVE_INFINITY : maxSize);
    } else {
      this.list.layout(30);
    }
  }

  override dispose(): void {
    this.visibilityDisposables.dispose();
    this.disposables.dispose();
    this.items.dispose();
    super.dispose();
  }
}

function collectAllResources(node: IResourceNode<ISCMResource, ISCMResourceGroup>): ISCMResource[] {
  const resources: ISCMResource[] = [];
  if (node.element) resources.push(node.element);
  for (const child of node.children) {
    resources.push(...collectAllResources(child));
  }
  return resources;
}

class SCMActionButton implements IDisposable {

  private button: HTMLElement | undefined;
  private disposables = new DisposableStore();

  constructor(
    private readonly container: HTMLElement,
    private readonly scmMenuService: ISCMMenuService
  ) { }

  setButton(button: ISCMActionButtonDescriptor | undefined): void {
    this.clear();
    if (!button) {
      return;
    }

    if (button.secondaryCommands?.length) {
      const actions: ISCMMenuItemAction[] & { arguments?: unknown[] }[] = [];
      for (let index = 0; index < button.secondaryCommands.length; index++) {
        const commands = button.secondaryCommands[index];
        for (const command of commands) {
          const action = new SCMMenuItemAction(command.id, command.title, false, true);
          actions.push({
            id: action.id,
            title: action.title,
            submenu: action.submenu,
            content: () => action.content(),
            arguments: command.arguments,
          } as unknown as ISCMMenuItemAction[] & { arguments?: unknown[] });
        }
      }

      const dropdownMenu = tag('span', { className: 'icon indicator', style: { pointerEvents: 'all' } });
      this.button = this.container.appendChild(
        tag('div', {
          className: 'button-dropdown',
          children: [
            tag('div',
              {
                className: 'text',
                children: [...renderLabelWithIcon(button.command.title).map(content => typeof content === 'string' ? tag('span', { innerHTML: content }) : content)]
              }),
            tag('div', {
              className: 'button-separator',
              children: [
                tag('div', { style: { backgroundColor: 'rgba(255, 255, 255, 0.4)' } })
              ]
            }),
            dropdownMenu
          ]
        })
      );

      Event.fromDOMEvent(dropdownMenu, 'click')((e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showMenu(actions, dropdownMenu);
      }, null, this.disposables);
    } else {
      this.button = this.container.appendChild(tag('div', { className: 'button' }));
      this.button.append(...renderLabelWithIcon(button.command.title).map(content => typeof content === 'string' ? tag('span', { className: 'text', innerHTML: content }) : content));
    }

    this.button.classList.toggle('disabled', !button.enabled);
    Event.fromDOMEvent(this.button, 'click')((e) => {
      e.stopPropagation();
      editorManager.editor.execCommand(button.command.id, ...(button.command.arguments || []));
    }, null, this.disposables);
  }

  private showMenu(actions: ISCMMenuItemAction[] & { arguments?: unknown[] }[], toggler: HTMLElement): void {
    this.scmMenuService.showContextMenu({
      toggler,
      getActions: () => actions,
      onSelect: (id: string) => {
        const action = actions.find(a => a.id === id) as unknown as ISCMMenuItemAction & { arguments?: unknown[] };
        if (!action) {
          return;
        }
        editorManager.editor.execCommand(action.id, ...(action.arguments || []));
      }
    });
  }

  private clear(): void {
    this.disposables.clear();
    this.button = undefined;
    while (this.container.firstChild) {
      this.container.firstChild.remove();
    }
  }

  dispose(): void {
    this.disposables.dispose();
  }
}
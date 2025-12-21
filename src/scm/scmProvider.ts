import { DisposableStore, IDisposable } from "../base/disposable";
import { Emitter, Event } from "../base/event";
import { ResourceTree } from "./resourceTree";
import { IMainSCM, ISCMActionButtonDescriptor, ISCMCommandAction, ISCMProvider, ISCMRepository, ISCMResource, ISCMResourceDecoration, ISCMResourceGroup, ISCMService, SCMMarshalledId, SCMProviderFeatures, SCMRawResourceSplices } from "./types";

class SCMResourceGroup implements ISCMResourceGroup {

  readonly resources: ISCMResource[] = [];

  private _resourceTree: ResourceTree<ISCMResource, ISCMResourceGroup> | undefined;
  get resourceTree(): ResourceTree<ISCMResource, ISCMResourceGroup> {
    if (!this._resourceTree) {
      const rootUri = this.provider.rootUri ?? '/';
      this._resourceTree = new ResourceTree<ISCMResource, ISCMResourceGroup>(this, rootUri);
      for (const resource of this.resources) {
        this._resourceTree.add(resource.sourceUri, resource);
      }
    }

    return this._resourceTree;
  }

  private readonly _onDidChange = new Emitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private readonly _onDidChangeResources = new Emitter<void>();
  readonly onDidChangeResources = this._onDidChangeResources.event;

  get label(): string { return this._label; }
  set label(label: string) {
    this._label = label;
    this._onDidChange.fire();
  }

  get hideWhenEmpty(): boolean | undefined {
    return this._hideWhenEmpty;
  }
  set hideWhenEmpty(hideWhenEmpty: boolean) {
    this._hideWhenEmpty = hideWhenEmpty;
    this._onDidChange.fire();
  }

  constructor(
    private readonly sourceControlHandle: number,
    private readonly handle: number,
    public provider: ISCMProvider,
    public id: string,
    private _label: string,
    private _hideWhenEmpty?: boolean
  ) {
  }

  splice(start: number, deleteCount: number, toInsert: ISCMResource[]) {
    this.resources.splice(start, deleteCount, ...toInsert);
    this._resourceTree = undefined;
    this._onDidChangeResources.fire();
  }

  toJSON() {
    return {
      $mid: SCMMarshalledId.ScmResourceGroup,
      sourceControlHandle: this.sourceControlHandle,
      groupHandle: this.handle
    };
  }
}

class SCMResource implements ISCMResource {

  constructor(
    private readonly sourceControlHandle: number,
    private readonly groupHandle: number,
    private readonly handle: number,
    readonly sourceUri: string,
    readonly resourceGroup: ISCMResourceGroup,
    readonly decorations: ISCMResourceDecoration
  ) {

  }

  toJSON() {
    return {
      $mid: SCMMarshalledId.ScmResource,
      sourceControlHandle: this.sourceControlHandle,
      groupHandle: this.groupHandle,
      handle: this.handle
    }
  }
}

class SCMProvider implements ISCMProvider {

  get id(): string { return `scm${this._handle}`; }
  get providerId(): string { return this._providerId; }

  readonly groups: SCMResourceGroup[] = [];
  private readonly _onDidChangeResourceGroups = new Emitter<void>();
  readonly onDidChangeResourceGroups = this._onDidChangeResourceGroups.event;

  private _onDidChangeResources = new Emitter<void>();
  readonly onDidChangeResources: Event<void> = this._onDidChangeResources.event;

  private _onDidChange = new Emitter<void>;
  readonly onDidChange: Event<void> = this._onDidChange.event;

  private readonly _groupsByHandle: { [handle: number]: SCMResourceGroup } = Object.create(null);

  get handle(): number { return this._handle; }
  get label(): string { return this._label; }
  get rootUri(): string | undefined { return this._rootUri; }
  get icon(): string | undefined { return this._icon; }

  private readonly _name: string | undefined;
  get name(): string { return this._name ?? this.label }

  private _count: number | undefined;
  get count(): number | undefined { return this._count; }

  private _commandActions: ISCMCommandAction[] | undefined = undefined;
  get commandActions(): ISCMCommandAction[] | undefined {
    return this._commandActions;
  }

  private _actionButton: ISCMActionButtonDescriptor | undefined;
  get actionButton(): ISCMActionButtonDescriptor | undefined {
    return this._actionButton;
  }

  private features: SCMProviderFeatures = {};

  constructor(
    private readonly _handle: number,
    private readonly _providerId: string,
    private readonly _label: string,
    private readonly _rootUri: string | undefined,
    private readonly _icon: string | undefined
  ) {
    if (_rootUri && _rootUri !== '/') {
      this._name = acode.require('Url').basename(_rootUri)!;
    }
  }

  updateSourceControl(features: SCMProviderFeatures): void {
    this.features = { ...this.features, ...features };
    let changed = false;

    if (typeof features.count !== 'undefined') {
      this._count = features.count;
      changed = true;
    }

    if (typeof features.commandActions !== 'undefined') {
      changed = true;
      this._commandActions = features.commandActions;
    }

    if (typeof features.actionButton !== 'undefined') {
      changed = true;
      this._actionButton = features.actionButton;
    }

    if (changed) {
      this._onDidChange.fire();
    }
  }

  registerGroups(_groups: [number /* handle */, string /* id */, string /* label */, boolean | undefined /* hideWhenEmpty */][]) {
    const groups = _groups.map(([handle, id, label, hideWhenEmpty]) => {
      const group = new SCMResourceGroup(this.handle, handle, this, id, label, hideWhenEmpty);
      this._groupsByHandle[handle] = group;
      return group;
    });

    this.groups.splice(this.groups.length, 0, ...groups);
    this._onDidChangeResourceGroups.fire();
  }

  updateGroup(handle: number, features: { hideWhenEmpty?: boolean }): void {
    const group = this._groupsByHandle[handle];

    if (!group) {
      return;
    }

    group.hideWhenEmpty = !!features.hideWhenEmpty;
  }

  updateGroupLabel(handle: number, label: string): void {
    const group = this._groupsByHandle[handle];

    if (!group) {
      return;
    }

    group.label = label;
  }

  spliceGroupResourceStates(splices: SCMRawResourceSplices[]): void {
    for (const [groupHandle, groupSlices] of splices) {
      const group = this._groupsByHandle[groupHandle];

      if (!group) {
        console.warn(`SCM group ${groupHandle} not found in provider ${this.label}`);
        continue;
      }

      groupSlices.reverse();

      for (const [start, deleteCount, rawResources] of groupSlices) {
        const resources = rawResources.map(rawResource => {
          const [handle, sourceUri, icon, strikeThrough, letter, color] = rawResource;

          const decorations = {
            icon,
            strikeThrough,
            letter,
            color
          } satisfies ISCMResourceDecoration;

          return new SCMResource(
            this.handle,
            groupHandle,
            handle,
            sourceUri,
            group,
            decorations
          );
        });

        group.splice(start, deleteCount, resources);
      }
    }

    this._onDidChangeResources.fire();
  }

  unregisterGroup(handle: number): void {
    const group = this._groupsByHandle[handle];

    if (!group) {
      return;
    }

    delete this._groupsByHandle[handle];
    this.groups.splice(this.groups.indexOf(group), 1);
    this._onDidChangeResourceGroups.fire();
  }

  toJSON() {
    return {
      $mid: SCMMarshalledId.ScmProvider,
      handle: this.handle
    };
  }

  dispose(): void {
    console.log(`Dispose provider. id: ${this.id}, label: ${this.label}`);
  }
}

export class SCM {
  private _repositories = new Map<number, ISCMRepository>();
  private _repositoryDisposables = new Map<number, IDisposable>();
  private readonly disposables = new DisposableStore();

  constructor(
    private _mainScm: IMainSCM,
    private readonly scmService: ISCMService
  ) { }

  dispose(): void {
    this._repositories.forEach(r => r.dispose());
    this._repositoryDisposables.forEach(d => d.dispose());
    this.disposables.dispose();
  }

  registerSourceControl(handle: number, id: string, label: string, rootUri: string | undefined, icon: string | undefined): void {
    const provider = new SCMProvider(handle, id, label, rootUri, icon);
    const repository = this.scmService.registerSCMProvider(provider);
    this._repositories.set(handle, repository);

    const disposable = repository.input.onDidChange(({ value }) => {
      this._mainScm.onInputBoxValueChange(handle, value);
    });;
    this._repositoryDisposables.set(handle, disposable);

    if (repository.input.value) {
      setTimeout(() => this._mainScm.onInputBoxValueChange(handle, repository.input.value), 0);
    }
  }

  registerGroups(sourceControlHandle: number, groups: [number /* handle */, string /* id */, string /* label */, boolean | undefined /* hideWhenEmpty */][], splices: SCMRawResourceSplices[]): void {
    const repository = this._repositories.get(sourceControlHandle);

    if (!repository) {
      return;
    }

    const provider = repository.provider as SCMProvider;
    provider.registerGroups(groups);
    provider.spliceGroupResourceStates(splices);
  }

  updateGroup(sourceControlHandle: number, groupHandle: number, features: { hideWhenEmpty?: boolean }): void {
    const repository = this._repositories.get(sourceControlHandle);

    if (!repository) {
      return;
    }

    const provider = repository.provider as SCMProvider;
    provider.updateGroup(groupHandle, features);
  }

  updateGroupLabel(sourceControlHandle: number, groupHandle: number, label: string): void {
    const repository = this._repositories.get(sourceControlHandle);

    if (!repository) {
      return;
    }

    const provider = repository.provider as SCMProvider;
    provider.updateGroupLabel(groupHandle, label);
  }

  spliceResourceStates(sourceControlHandle: number, splices: SCMRawResourceSplices[]): void {
    const repository = this._repositories.get(sourceControlHandle);

    if (!repository) {
      return;
    }

    const provider = repository.provider as SCMProvider;
    provider.spliceGroupResourceStates(splices);
  }

  unregisterGroup(sourceControlHandle: number, handle: number): void {
    const repository = this._repositories.get(sourceControlHandle);

    if (!repository) {
      return;
    }

    const provider = repository.provider as SCMProvider;
    provider.unregisterGroup(handle);
  }

  unregisterSourceControl(handle: number): void {
    const repository = this._repositories.get(handle);

    if (!repository) {
      return;
    }

    this._repositoryDisposables.get(handle)!.dispose();
    this._repositoryDisposables.delete(handle);

    repository.dispose();
    this._repositories.delete(handle);
  }

  updateSourceControl(handle: number, features: SCMProviderFeatures): void {
    const repository = this._repositories.get(handle);

    if (!repository) {
      return;
    }

    const provider = repository.provider as SCMProvider;
    provider.updateSourceControl(features);
  }

  setInputBoxValue(sourceControlHandle: number, value: string): void {
    const repository = this._repositories.get(sourceControlHandle);

    if (!repository) {
      return;
    }

    repository.input.setValue(value);
  }

  setInputBoxPlaceholder(sourceControlHandle: number, placeholder: string): void {
    const repository = this._repositories.get(sourceControlHandle);

    if (!repository) {
      return;
    }

    repository.input.placeholder = placeholder;
  }

  setInputBoxEnablement(sourceControlHandle: number, enabled: boolean): void {
    const repository = this._repositories.get(sourceControlHandle);

    if (!repository) {
      return;
    }

    repository.input.enabled = enabled;
  }

  setInputBoxVisibility(sourceControlHandle: number, visible: boolean): void {
    const repository = this._repositories.get(sourceControlHandle);

    if (!repository) {
      return;
    }

    repository.input.visible = visible;
  }
}
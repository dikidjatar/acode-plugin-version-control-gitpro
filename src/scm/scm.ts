import { App } from '../base/app';
import { config } from '../base/config';
import { debounce } from '../base/decorators';
import { SyncDescriptor } from '../base/descriptor';
import { Disposable, IDisposable } from '../base/disposable';
import { Emitter, Event } from '../base/event';
import { SettingsItems, SettingsPage } from '../base/settingsPage';
import { SourceControl, SourceControlActionButton, SourceControlCommandAction, SourceControlInputBox, SourceControlMenuItem, SourceControlProgess, SourceControlResourceDecorations, SourceControlResourceGroup, SourceControlResourceState, SourceControlViewContainer } from './api/sourceControl';
import { SCMMenuService } from './scmMenuService';
import { SCM } from './scmProvider';
import { ScmRepositoriesView } from './scmRepositoriesView';
import { SCMService } from './scmService';
import { SCMView } from './scmView';
import { SCMViewContainer } from './scmViewContainer';
import { SCMViewService } from './scmViewService';
import { IMainSCM, ISCMCommandAction, ISCMCommandService, ISCMMenuItem, ISCMProvider, ISCMService, SCMArgumentProcessor, SCMMarshalledId, SCMMenuContext, SCMMenuRegistry, SCMRawResource, SCMRawResourceSplice, SCMRawResourceSplices, defualtScmConfig } from './types';
import { comparePaths } from './utils';

const terminal = acode.require('terminal');

type ProviderHandle = number;
type GroupHandle = number;
type ResourceStateHandle = number;

class SCMCommandService implements ISCMCommandService {

  private readonly _argumentProcessors: SCMArgumentProcessor[] = [];

  registerArgumentProcessor(processor: SCMArgumentProcessor): void {
    this._argumentProcessors.push(processor);
  }

  executeCommand(commandId: string, ...args: unknown[]): void {
    args = args.map(arg => this._argumentProcessors.reduce((r, p) => p.processArgument(this._toJSON(r)), arg));
    editorManager.editor.execCommand(commandId, args);
  }

  private _toJSON(arg: any): any {
    if (arg && typeof arg.toJSON === 'function') {
      return arg.toJSON();
    }
    return arg;
  }
}

function compareResourceStatesDecorations(a: SourceControlResourceDecorations, b: SourceControlResourceDecorations): number {
  if (a.strikeThrough !== b.strikeThrough) {
    return a.strikeThrough ? 1 : -1;
  }

  if (a.color && b.color) {
    return a.color.localeCompare(b.color);
  } else if (a.color) {
    return 1;
  } else if (b.color) {
    return -1;
  }

  if (a.letter && b.letter) {
    return a.letter.localeCompare(b.letter);
  } else if (a.letter) {
    return 1;
  } else if (b.letter) {
    return -1;
  }

  if (!a.icon && !b.icon) {
    return 0;
  } else if (!a.icon) {
    return -1;
  } else if (!b.icon) {
    return 1;
  }

  return a.icon.localeCompare(b.icon);
}

function compareResourceStates(a: SourceControlResourceState, b: SourceControlResourceState): number {
  let result = comparePaths(a.resourceUri, b.resourceUri);

  if (result !== 0) {
    return result;
  }

  if (a.decorations && b.decorations) {
    result = compareResourceStatesDecorations(a.decorations, b.decorations);
  } else if (a.decorations) {
    return 1;
  } else if (b.decorations) {
    return -1;
  }

  return result;
}

interface ISplice<T> {
  readonly start: number;
  readonly deleteCount: number;
  readonly toInsert: readonly T[];
}

interface IMutableSplice<T> extends ISplice<T> {
  readonly toInsert: T[];
  deleteCount: number;
}

function sortedDiff<T>(before: ReadonlyArray<T>, after: ReadonlyArray<T>, compare: (a: T, b: T) => number): ISplice<T>[] {
  const result: IMutableSplice<T>[] = [];

  function pushSplice(start: number, deleteCount: number, toInsert: T[]): void {
    if (deleteCount === 0 && toInsert.length === 0) {
      return;
    }

    const latest = result[result.length - 1];

    if (latest && latest.start + latest.deleteCount === start) {
      latest.deleteCount += deleteCount;
      latest.toInsert.push(...toInsert);
    } else {
      result.push({ start, deleteCount, toInsert });
    }
  }

  let beforeIdx = 0;
  let afterIdx = 0;

  while (true) {
    if (beforeIdx === before.length) {
      pushSplice(beforeIdx, 0, after.slice(afterIdx));
      break;
    }
    if (afterIdx === after.length) {
      pushSplice(beforeIdx, before.length - beforeIdx, []);
      break;
    }

    const beforeElement = before[beforeIdx];
    const afterElement = after[afterIdx];
    const n = compare(beforeElement, afterElement);
    if (n === 0) {
      // equal
      beforeIdx += 1;
      afterIdx += 1;
    } else if (n < 0) {
      // beforeElement is smaller -> before element removed
      pushSplice(beforeIdx, 1, []);
      beforeIdx += 1;
    } else if (n > 0) {
      // beforeElement is greater -> after element added
      pushSplice(beforeIdx, 0, [afterElement]);
      afterIdx += 1;
    }
  }

  return result;
}

class SourceControlResourceGroupImpl implements SourceControlResourceGroup {

  private static _handlePool: number = 0;
  private _resourceHandlePool: number = 0;
  private _resourceStates: SourceControlResourceState[] = [];

  #scm: SCM;

  private _resourceStatesMap = new Map<ResourceStateHandle, SourceControlResourceState>();
  private _resourceStatesCommandsMap = new Map<ResourceStateHandle, SourceControlCommandAction>();

  private readonly _onDidUpdateResourceStates = new Emitter<void>();
  readonly onDidUpdateResourceStates = this._onDidUpdateResourceStates.event;

  private _disposed = false;
  get disposed(): boolean { return this._disposed; }
  private readonly _onDidDispose = new Emitter<void>();
  readonly onDidDispose = this._onDidDispose.event;

  private _handlesSnapshot: number[] = [];
  private _resourceSnapshot: SourceControlResourceState[] = [];

  get id(): string { return this._id };
  get label(): string { return this._label };
  set label(label: string) {
    this._label = label;
    this.#scm.updateGroupLabel(this._sourceControlHandle, this.handle, label);
  }

  private _hideWhenEmpty: boolean | undefined = undefined;
  get hideWhenEmpty(): boolean | undefined { return this._hideWhenEmpty };
  set hideWhenEmpty(hideWhenEmpty: boolean | undefined) {
    this._hideWhenEmpty = hideWhenEmpty;
    this.#scm.updateGroup(this._sourceControlHandle, this.handle, { hideWhenEmpty: this._hideWhenEmpty });
  }

  get resourceStates(): SourceControlResourceState[] { return this._resourceStates };
  set resourceStates(resources: SourceControlResourceState[]) {
    this._resourceStates = [...resources];
    this._onDidUpdateResourceStates.fire();
  }

  readonly handle = SourceControlResourceGroupImpl._handlePool++;

  constructor(
    scm: SCM,
    private _sourceControlHandle: number,
    private _id: string,
    private _label: string
  ) {
    this.#scm = scm;
  }

  getResourceState(handle: number): SourceControlResourceState | undefined {
    return this._resourceStatesMap.get(handle);
  }

  executeResourceCommand(handle: number): boolean {
    const command = this._resourceStatesCommandsMap.get(handle);

    if (!command) {
      return false;
    }

    return editorManager.editor.execCommand(command.id, command.arguments);
  }

  _takeResourceStateSnapshot(): SCMRawResourceSplice[] {
    const snapshot = [...this.resourceStates].sort(compareResourceStates);
    const diffs = sortedDiff(this._resourceSnapshot, snapshot, compareResourceStates);

    const splices = diffs.map<ISplice<{ rawResource: SCMRawResource; handle: number }>>(diff => {
      const toInsert = diff.toInsert.map(r => {
        const handle = this._resourceHandlePool++;
        this._resourceStatesMap.set(handle, r);

        const sourceUri = r.resourceUri;

        if (r.command) {
          this._resourceStatesCommandsMap.set(handle, r.command);
        }

        const icon = r.decorations?.icon;
        const strikeThrough = r.decorations && !!r.decorations.strikeThrough;
        const letter = r.decorations?.letter;
        const color = r.decorations?.color;

        const rawResource = [handle, sourceUri, icon, strikeThrough, letter, color] as SCMRawResource;

        return { rawResource, handle };
      });

      return { start: diff.start, deleteCount: diff.deleteCount, toInsert };
    });

    const rawResourceSplices = splices
      .map(({ start, deleteCount, toInsert }) => [start, deleteCount, toInsert.map(i => i.rawResource)] as SCMRawResourceSplice);

    const reverseSplices = splices.reverse();

    for (const { start, deleteCount, toInsert } of reverseSplices) {
      const handles = toInsert.map(i => i.handle);
      const handlesToDelete = this._handlesSnapshot.splice(start, deleteCount, ...handles);

      for (const handle of handlesToDelete) {
        this._resourceStatesMap.delete(handle);
        this._resourceStatesCommandsMap.delete(handle);
      }
    }

    this._resourceSnapshot = snapshot;
    return rawResourceSplices;
  }

  dispose(): void {
    this._disposed = true;
    this._onDidDispose.fire();
  }

}

class SourceControlInputBoxImpl implements SourceControlInputBox {

  #scm: SCM;

  private _value: string = '';

  get value(): string {
    return this._value;
  }

  set value(value: string) {
    value = value ?? '';
    this.#scm.setInputBoxValue(this._sourceControlHandle, value);
    this.updateValue(value);
  }

  private readonly _onDidChange = new Emitter<string>();

  get onDidChange(): Event<string> {
    return this._onDidChange.event;
  }

  private _placeholder: string = '';

  get placeholder(): string {
    return this._placeholder;
  }

  set placeholder(placeholder: string) {
    this.#scm.setInputBoxPlaceholder(this._sourceControlHandle, placeholder);
    this._placeholder = placeholder;
  }

  private _enabled: boolean = true;

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(enabled: boolean) {
    enabled = !!enabled;

    if (this._enabled === enabled) {
      return;
    }

    this._enabled = enabled;
    this.#scm.setInputBoxEnablement(this._sourceControlHandle, enabled);
  }

  private _visible: boolean = true;

  get visible(): boolean {
    return this._visible;
  }

  set visible(visible: boolean) {
    visible = !!visible;

    if (this._visible === visible) {
      return;
    }

    this._visible = visible;
    this.#scm.setInputBoxVisibility(this._sourceControlHandle, visible);
  }

  constructor(scm: SCM, private _sourceControlHandle: number) {
    this.#scm = scm;
  }

  onInputBoxValueChange(value: string): void {
    this.updateValue(value);
  }

  private updateValue(value: string): void {
    this._value = value;
    this._onDidChange.fire(value);
  }
}

class SourceControlImpl implements SourceControl {
  private static _handlePool: number = 0;

  #scm: SCM;

  private _groups: Map<GroupHandle, SourceControlResourceGroupImpl> = new Map<GroupHandle, SourceControlResourceGroupImpl>();

  get id(): string {
    return this._id;
  }

  get label(): string {
    return this._label;
  }

  get rootUri(): string | undefined {
    return this._rootUri;
  }

  private _inputBox: SourceControlInputBox;
  get inputBox(): SourceControlInputBox { return this._inputBox; }

  private _count: number | undefined = undefined;
  get count(): number | undefined {
    return this._count;
  }
  set count(count: number) {
    if (this._count === count) {
      return;
    }

    this._count = count;
    this.#scm.updateSourceControl(this.handle, { count });
  }

  private _commandActions: ISCMCommandAction[] | undefined = undefined;
  get commandActions(): ISCMCommandAction[] | undefined {
    return this._commandActions;
  }
  set commandActions(commandActions: ISCMCommandAction[] | undefined) {
    this._commandActions = commandActions;
    this.#scm.updateSourceControl(this.handle, { commandActions: commandActions });
  }

  private _actionButton: SourceControlActionButton | undefined;
  get actionButton(): SourceControlActionButton | undefined {
    return this._actionButton;
  }
  set actionButton(actionButton: SourceControlActionButton | undefined) {
    this._actionButton = actionButton;
    this.#scm.updateSourceControl(this.handle, { actionButton: actionButton });
  }

  private _selected: boolean = false;
  get selected(): boolean {
    return this._selected;
  }

  private readonly _onDidChangeSelection = new Emitter<boolean>();
  readonly onDidChangeSelection = this._onDidChangeSelection.event;

  readonly handle: number = SourceControlImpl._handlePool++;

  constructor(
    scm: SCM,
    private _id: string,
    private _label: string,
    private _rootUri?: string,
    _icon?: string
  ) {
    this.#scm = scm;
    this._inputBox = new SourceControlInputBoxImpl(scm, this.handle);
    this.#scm.registerSourceControl(this.handle, _id, _label, _rootUri, _icon);
  }

  private createdResourceGroups = new Map<SourceControlResourceGroupImpl, IDisposable>();
  private updatedResourceGroups = new Set<SourceControlResourceGroupImpl>();

  createResourceGroup(id: string, label: string): SourceControlResourceGroup {
    const group = new SourceControlResourceGroupImpl(this.#scm, this.handle, id, label);
    const disposable = Event.once(group.onDidDispose)(() => this.createdResourceGroups.delete(group));
    this.createdResourceGroups.set(group, disposable);
    this.eventuallyAddResourceGroups();
    return group;
  }

  @debounce(100)
  eventuallyAddResourceGroups(): void {
    const groups: [number /* handle */, string /* id */, string /* label */, boolean | undefined /* hideWhenEmpty */][] = [];
    const splices: SCMRawResourceSplices[] = [];

    for (const [group, disposable] of this.createdResourceGroups) {
      disposable.dispose();

      const updateListener = group.onDidUpdateResourceStates(() => {
        this.updatedResourceGroups.add(group);
        this.eventuallyUpdateResourceStates();
      });

      Event.once(group.onDidDispose)(() => {
        this.updatedResourceGroups.delete(group);
        updateListener.dispose();
        this._groups.delete(group.handle);
        this.#scm.unregisterGroup(this.handle, group.handle);
      });

      groups.push([group.handle, group.id, group.label, group.hideWhenEmpty]);

      const snapshot = group._takeResourceStateSnapshot();

      if (snapshot.length > 0) {
        splices.push([group.handle, snapshot]);
      }

      this._groups.set(group.handle, group);
    }

    this.#scm.registerGroups(this.handle, groups, splices);
    this.createdResourceGroups.clear();
  }

  @debounce(100)
  eventuallyUpdateResourceStates(): void {
    const splices: SCMRawResourceSplices[] = [];

    this.updatedResourceGroups.forEach(group => {
      const snapshot = group._takeResourceStateSnapshot();

      if (snapshot.length === 0) {
        return;
      }

      splices.push([group.handle, snapshot]);
    });

    if (splices.length > 0) {
      this.#scm.spliceResourceStates(this.handle, splices);
    }

    this.updatedResourceGroups.clear();
  }

  getResourceGroup(handle: GroupHandle): SourceControlResourceGroupImpl | undefined {
    return this._groups.get(handle);
  }

  setSelectionState(selected: boolean): void {
    this._selected = selected;
    this._onDidChangeSelection.fire(selected);
  }

  dispose(): void {
    this._groups.forEach(group => group.dispose());
    this.#scm.unregisterSourceControl(this.handle);
  }
}

class MainSCM implements IMainSCM {

  private _sourceControls: Map<ProviderHandle, SourceControlImpl> = new Map<ProviderHandle, SourceControlImpl>();

  private _selectedSourceControlHandle: number | undefined;

  #scm: SCM;

  constructor(
    scmService: ISCMService,
    commandService: ISCMCommandService
  ) {
    const argumentProcessor = (arg: any): any => {
      if (arg && arg.$mid === SCMMarshalledId.ScmResource) {
        const sourceControl = this._sourceControls.get(arg.sourceControlHandle);
        if (!sourceControl) {
          return arg;
        }

        const group = sourceControl.getResourceGroup(arg.groupHandle);

        if (!group) {
          return arg;
        }

        return group.getResourceState(arg.handle);
      } else if (arg && arg.$mid === SCMMarshalledId.ScmResourceGroup) {
        const sourceControl = this._sourceControls.get(arg.sourceControlHandle);

        if (!sourceControl) {
          return arg;
        }

        return sourceControl.getResourceGroup(arg.groupHandle);
      } else if (arg && arg.$mid === SCMMarshalledId.ScmProvider) {
        const sourceControl = this._sourceControls.get(arg.handle);

        if (!sourceControl) {
          return arg;
        }

        return sourceControl;
      }

      if (Array.isArray(arg)) {
        return arg.map(item => argumentProcessor(item));
      }

      return Array.isArray(arg) ? arg.map(item => argumentProcessor(item)) : arg;
    }

    commandService.registerArgumentProcessor({ processArgument: argumentProcessor });
    this.#scm = new SCM(this, scmService);
  }

  dispose(): void {
    this.#scm.dispose();
  }

  createSourceControl(id: string, label: string, rootUri: string | undefined, icon: string | undefined): SourceControl {
    console.log(`MainSCM#createSourceControl id=${id}, label=${label}, rootUri=${rootUri}`,);
    const sourceControl = new SourceControlImpl(this.#scm, id, label, rootUri, icon);
    this._sourceControls.set(sourceControl.handle, sourceControl);
    return sourceControl;
  }

  setSelectedSourceControl(selectedSourceControlHandle: number | undefined): void {
    console.log('MainSCM#setSelectedSourceControl', selectedSourceControlHandle);
    if (selectedSourceControlHandle !== undefined) {
      this._sourceControls.get(selectedSourceControlHandle)?.setSelectionState(true);
    }

    if (this._selectedSourceControlHandle !== undefined) {
      this._sourceControls.get(this._selectedSourceControlHandle)?.setSelectionState(false);
    }

    this._selectedSourceControlHandle = selectedSourceControlHandle;
  }

  onInputBoxValueChange(sourceControlHandle: number, value: string): void {
    console.log('MainSCM#onInputBoxValueChange', sourceControlHandle);
    const sourceControl = this._sourceControls.get(sourceControlHandle);

    if (!sourceControl) {
      return;
    }

    const inputBox = sourceControl.inputBox as SourceControlInputBoxImpl;
    inputBox.onInputBoxValueChange(value);
  }

  executeResourceCommand(sourceControlHandle: number, groupHandle: number, handle: number): boolean {
    console.log('MainSCM#$executeResourceCommand', sourceControlHandle, groupHandle, handle);
    const sourceControl = this._sourceControls.get(sourceControlHandle);

    if (!sourceControl) {
      return false;
    }

    const group = sourceControl.getResourceGroup(groupHandle);

    if (!group) {
      return false;
    }

    return group.executeResourceCommand(handle);
  }
}

let mainScm: MainSCM;
let scmViewContainer: SCMViewContainer;

export namespace scm {

  export function createSourceControl(id: string, label: string, rootUri: string | undefined, icon: string | undefined): SourceControl {
    return mainScm.createSourceControl(id, label, rootUri, icon);
  }

  export function getViewContainer(): SourceControlViewContainer {
    return scmViewContainer;
  }

  export function getSCMProgress(): SourceControlProgess {
    return scmViewContainer.getProgress();
  }

  export async function initialize(baseUrl: string): Promise<IDisposable> {
    const disposables: IDisposable[] = [];

    await config.init('scm', defualtScmConfig);
    const appSettings = acode.require('settings');
    appSettings.uiSettings['scm-settings'] = scmSettings();

    acode.addIcon('scm', baseUrl + 'assets/scm.svg', { monochrome: true });
    acode.addIcon('repo', baseUrl + 'assets/repo.svg', { monochrome: true });

    const scmService = new SCMService();
    const scmViewService = new SCMViewService(scmService);
    const smcCommandService = new SCMCommandService();
    const scmMenuService = new SCMMenuService();
    scmViewContainer = new SCMViewContainer(scmService);
    mainScm = new MainSCM(scmService, smcCommandService);
    disposables.push(scmViewService);
    disposables.push(scmViewContainer);
    disposables.push(mainScm);
    disposables.push(scmMenuService);

    editorManager.editor.commands.addCommand({
      name: 'scm.openInIntegratedTerminal',
      exec: async (editor: any, providers: ISCMProvider[]) => {
        if (!Array.isArray(providers) || providers.length !== 1) {
          return;
        }

        const provider = providers[0];

        if (!provider.rootUri) {
          return;
        }

        if (localStorage.sidebarShown === '1') {
          acode.exec('toggle-sidebar');
        }

        const terminalInstance = await terminal.createServer({
          name: provider.name,
          serverMode: true
        });

        setTimeout(() => {
          terminal.write(terminalInstance.id, `cd "${provider.rootUri}"\n`);
        }, 500);
      }
    })

    SCMMenuRegistry.registerMenuItem('scm/sourceControl', {
      command: { id: 'scm.openInIntegratedTerminal', title: 'Open in Integrated Terminal' },
      group: '99_terminal',
      when: (ctx: SCMMenuContext) => ctx.scmProviderHasRoorUri === true
    });

    const sidebarApps = acode.require('sidebarApps');
    sidebarApps.add(
      'scm',
      'scm',
      'Source Control',
      (container: HTMLElement) => {
        scmViewContainer.create(container);
        scmViewContainer.registerViewWelcomeContent({
          content: 'No source control providers registered.',
          when: () => 'default'
        });

        scmViewContainer.addViews([{
          id: 'scm.repositories',
          ctorDescriptor: new SyncDescriptor(ScmRepositoriesView, [container, scmService, scmViewService, smcCommandService, scmMenuService]),
          index: 0,
          when: () => App.hasContext('scm.providerCount') && App.getContext<number>('scm.providerCount') !== 0
        }]);

        scmViewContainer.addViews([{
          id: 'scm.view',
          ctorDescriptor: new SyncDescriptor(SCMView, [container, scmService, scmViewService, smcCommandService, scmMenuService]),
          index: 1,
          when: () => App.hasContext('scm.providerCount') && App.getContext<number>('scm.providerCount') !== 0
        }]);
      },
      false,
      (container: HTMLElement) => {
        const scrollableLists = container.getAll(":scope .scroll[data-scroll-top]");
        scrollableLists?.forEach(el => {
          el.scrollTop = Number((el as HTMLElement).dataset.scrollTop);
        });
      }
    );

    disposables.push(Disposable.toDisposable(() => {
      sidebarApps.remove('scm');
    }));

    registerSCMApi();

    return {
      dispose: () => {
        Disposable.dispose(disposables);
      }
    }
  }

  export function registerMenuItems(menuId: string, items: ISCMMenuItem[]): IDisposable {
    return SCMMenuRegistry.registerMenuItems(menuId, items);
  }

  function registerSCMApi(): void {
    acode.define('scm', {
      createSourceControl(id: string, label: string, rootUri?: string, icon?: string): SourceControl {
        return createSourceControl(id, label, rootUri, icon);
      },
      getViewContainer() {
        return getViewContainer();
      },
      registerMenuItems(menuId: string, items: SourceControlMenuItem[]): IDisposable {
        return SCMMenuRegistry.registerMenuItems(menuId, items);
      },
      setContext(id: string, value: unknown) {
        App.setContext(id, value);
      },
      getContext(id: string, defaultValue: unknown) {
        return App.getContext(id, defaultValue);
      }
    });
  }

  function scmSettings(): SettingsPage {
    const configs = config.get('scm', defualtScmConfig)!;

    const settings: SettingsItems = [
      {
        key: 'inputMaxLineCount',
        value: configs.inputMaxLineCount,
        text: 'SCM: Input Max Line Count',
        info: 'Controls the maximum number of lines that the input will auto-grow to.',
        prompt: 'Status Limit',
        promptType: 'number'
      },
      {
        key: 'inputMinLineCount',
        value: configs.inputMinLineCount,
        text: 'SCM: Input Min Line Count',
        info: 'Controls the minimum number of lines that the input will auto-grow from.',
        prompt: 'Status Limit',
        promptType: 'number'
      },
      {
        key: 'alwaysShowRepositories',
        checkbox: configs.alwaysShowRepositories,
        text: 'SCM: Always Show Repositories',
        info: 'Controls whether inline actions are always visible in the Source Control view.'
      },
      {
        key: 'showActionButton',
        checkbox: configs.showActionButton,
        text: 'SCM: Show Action Button',
        info: 'Controls whether an action button can be shown in the Source Control view.'
      },
      {
        key: 'selectionMode',
        value: configs.selectionMode,
        text: 'SCM Repositories: Selection Mode',
        info: 'Controls the selection mode of the repositories in the Source Control Repositories view.',
        select: ['single', 'multiple']
      },
      {
        key: 'defaultViewMode',
        value: configs.defaultViewMode,
        select: ['list', 'tree'],
        text: 'SCM: Default View Mode',
        info: 'Controls the default Source Control repository view mode.'
      }
    ];

    return new SettingsPage('SCM', settings, callback);

    function callback(key: string, value: unknown): void {
      const configs = config.get('scm', defualtScmConfig)!;
      config.update('scm', { ...configs, [key]: value });
    }
  }
}
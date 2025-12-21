import { Disposable, DisposableStore } from "./disposable";
import { Emitter } from "./event";

const actionStack = acode.require('actionStack');
const appSetting = acode.require('settings');

export class App {
  private static _isInitialized: boolean = false;
  private static _disposables = new DisposableStore();

  private static _contextValues = new Map<string, any>();

  private static readonly _onCloseApp = new Emitter<void>();
  public static readonly onCloseApp = this._onCloseApp.event;

  private static readonly _onDidChangeContext = new Emitter<string>();
  public static readonly onDidChangeContext = this._onDidChangeContext.event;

  private static readonly _onDidChangeWorkspaceFolder = new Emitter<WorkspaceFoldersChangeEvent>();
  public static readonly onDidChangeWorkspaceFolder = this._onDidChangeWorkspaceFolder.event;

  public static initialize(): void {
    if (this._isInitialized) {
      return;
    }

    this._isInitialized = true;

    const onCloseApp = actionStack.onCloseApp;
    actionStack.onCloseApp = () => {
      this._onCloseApp.fire();
      if (typeof onCloseApp === 'function') {
        onCloseApp();
      }
    }

    this.setContext('addedFolderCount', addedFolder.length);

    const onDidAddWorkspaceFolder = (e: WorkspaceFolderChangeEvent) => {
      const lastAddedFolderCount = this.getContext('addedFolderCount', addedFolder.length);
      this.setContext('addedFolderCount', lastAddedFolderCount + 1)
      this._onDidChangeWorkspaceFolder.fire({ added: [e], removed: [] });
    }
    const onDidRemoveWorkspaceFolder = (e: WorkspaceFolderChangeEvent) => {
      const lastAddedFolderCount = this.getContext('addedFolderCount', addedFolder.length);
      this.setContext('addedFolderCount', lastAddedFolderCount - 1);
      this._onDidChangeWorkspaceFolder.fire({ added: [], removed: [e] });
    }
    editorManager.on('add-folder', onDidAddWorkspaceFolder);
    editorManager.on('remove-folder', onDidRemoveWorkspaceFolder);
    this._disposables.add(Disposable.toDisposable(() => {
      editorManager.off('add-folder', onDidAddWorkspaceFolder);
      editorManager.off('remove-folder', onDidRemoveWorkspaceFolder);
    }));

    this._disposables.add(this._onDidChangeContext);
    this._disposables.add(this._onDidChangeWorkspaceFolder);
  }

  static setContext(id: string, value: any): void {
    this._contextValues.set(id, value);
    this._onDidChangeContext.fire(id);
  }

  static getContext<T>(id: string, defaultValue?: T): T {
    const value = this._contextValues.get(id);
    if (!value && defaultValue) {
      return defaultValue;
    }
    return value;
  }

  static hasContext(id: string): boolean {
    return this._contextValues.has(id);
  }

  public static open(target: URL | string): void {
    if (typeof target === 'string') {
      const url = URL.parse(target);
      if (!url) {
        return;
      }
      target = url;
    }

    const protocol = target.protocol.slice(0, -1);

    if (protocol === 'command') {
      let command = target.pathname;
      if (/%[0-9a-fA-F]{2}/.test(command)) {
        command = decodeURIComponent(command);
      }
      const args = parseCommandArgs(target.search);
      editorManager.editor.execCommand(command, ...args);
    } else if (protocol === 'setting') {
      const setting = target.pathname;
      const args = parseCommandArgs(target.search);
      this.openSetting(setting, args.length > 0 ? args[0] : undefined);
    } else if (protocol === 'http' || protocol === 'https' || protocol === 'file') {
      system.openInBrowser(target.href);
    }
  }

  public static openSetting(setting: string, goto?: string): void {
    const uiSetting = appSetting.uiSettings[setting];
    if (!uiSetting) {
      return;
    }
    uiSetting.show(goto);
  }
}

App.initialize();

export interface WorkspaceFolderChangeEvent {
  name: string;
  url: string;
}

export interface WorkspaceFoldersChangeEvent {
  added: WorkspaceFolderChangeEvent[];
  removed: WorkspaceFolderChangeEvent[];
}

function parseCommandArgs(search: string): any[] {
  if (!search) {
    return [];
  }

  try {
    let result = JSON.parse(decodeURIComponent(search.slice(1)));
    if (!Array.isArray(result)) {
      result = [result];
    }
    return result;
  } catch (error) {
    return [];
  }
}
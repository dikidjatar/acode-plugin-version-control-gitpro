import { App } from "./app";
import { config, ConfigurationChangeEvent } from "./config";
import { decorationService, FileDecoration } from "./decorationService";
import { debounce } from "./decorators";
import { DisposableStore } from "./disposable";
import { Event } from "./event";
import { uriToPath } from "./uri";

const sidebarApps = acode.require('sidebarApps');
const filesContainer = sidebarApps.get('files')!;

type RootOntoggle = ((this: Acode.Collapsible) => void | Promise<void>);
type FileTreeExpandedChange = ((folderUrl: string, isExpanded: boolean) => void);

interface FileTreeOptions {
  onExpandedChange: FileTreeExpandedChange | undefined;
  expandedState: { [key: string]: boolean } | undefined;
}

interface FileTree {
  readonly options: FileTreeOptions;
  findElement(url: string): HTMLElement | null;
}

function getRoots(): Acode.Collapsible[] {
  return Array.from(filesContainer.querySelectorAll('[data-type="root"]')) as Acode.Collapsible[];
}

function getTilesFromNode(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll('.tile[data-url]')) as HTMLElement[];
}

class RootElementCallbackManager {

  private originalOntoggle: RootOntoggle | undefined;
  private originalOnExpandedChange: FileTreeExpandedChange | undefined;
  private isPatched = false;
  private fileTree: FileTree | undefined;

  constructor(private readonly root: Acode.Collapsible) {
    this.originalOntoggle = root.ontoggle;
  }

  getFileTree(): FileTree | undefined {
    return this.fileTree;
  }

  setupCallbacks(onToggle: RootOntoggle, onExpandedChange: FileTreeExpandedChange): void {
    if (this.isPatched) {
      return;
    }

    const originalOntoggle = this.originalOntoggle;
    const root = this.root;

    root.ontoggle = async function (this: Acode.Collapsible) {
      await originalOntoggle?.call(this);
      await onToggle.call(this);
    }

    this.fileTree = (this.root.$ul as unknown as { _fileTree: FileTree | undefined })._fileTree;
    this.originalOnExpandedChange = this.fileTree?.options.onExpandedChange;

    if (this.fileTree) {
      this.fileTree.options.onExpandedChange = (folderUrl: string, isExpanded: boolean) => {
        this.originalOnExpandedChange?.(folderUrl, isExpanded);
        onExpandedChange(folderUrl, isExpanded);
      }
    }

    this.isPatched = true;
  }

  restore(): void {
    if (!this.isPatched) {
      return;
    }

    this.root.ontoggle = this.originalOntoggle as RootOntoggle;
    if (this.fileTree) {
      this.fileTree.options.onExpandedChange = this.originalOnExpandedChange;
      this.fileTree = undefined;
    }
    this.isPatched = false;
  }
}

class FileTreeElementManager {
  private readonly managers = new WeakMap<Acode.Collapsible, RootElementCallbackManager>();

  setupRoot(root: Acode.Collapsible, options: {
    onToggle: RootOntoggle,
    onExpandedChange: FileTreeExpandedChange
  }): void {
    let manager = this.managers.get(root);
    if (!manager) {
      manager = new RootElementCallbackManager(root);
      this.managers.set(root, manager);
    }

    manager.setupCallbacks(options.onToggle, options.onExpandedChange);
  }

  getFileTree(root: Acode.Collapsible): FileTree | undefined {
    const manager = this.managers.get(root);
    if (manager) {
      return manager.getFileTree();
    }
    return undefined;
  }

  restore(root: Acode.Collapsible): void {
    const manager = this.managers.get(root);
    if (manager) {
      manager.restore();
    }
  }

  restoreAll(): void {
    const roots = getRoots();
    for (const root of roots) {
      this.restore(root);
    }
  }
}

function applyDecoration(element: HTMLElement): void {
  const url = element.dataset.url;

  if (!url) {
    return;
  }

  const path = uriToPath(url);
  const decoration = decorationService.getDecoration(path);

  if (!decoration) {
    clearDecoration(element);
    return;
  }

  if (decoration.propagate !== false) {
    renderDecoration(element, decoration);
  }
}

function renderDecoration(element: HTMLElement, decoration: FileDecoration): void {
  const text = element.querySelector('.text') as HTMLElement;
  let badge = element.querySelector('.badge') as HTMLElement | null;

  if (decoration.badge) {
    if (!badge) {
      badge = tag('span', {
        className: 'badge',
        style: {
          fontSize: '1em',
          height: '30px',
          minWidth: '30px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center'
        }
      });
      if (text.nextSibling) {
        element.insertBefore(badge, text.nextSibling);
      } else {
        element.appendChild(badge);
      }
    }
    badge.textContent = decoration.badge;
  } else if (badge) {
    badge.remove();
    badge = null;
  }

  const color = decoration.color || 'var(--primary-text-color)';
  text.style.color = color;
  if (badge) {
    badge.style.color = color;
  }
}

function clearDecoration(element: HTMLElement): void {
  const text = element.querySelector('.text') as HTMLElement;
  if (text) {
    text.style.color = 'var(--primary-text-color)';
  }

  const badge = element.querySelector('.badge');
  if (badge) {
    badge.remove();
  }
}

function applyDecorations(node: HTMLElement): void {
  const elements = getTilesFromNode(node);
  for (let i = 0; i < elements.length; i++) {
    applyDecoration(elements[i]);
  }
}

function clearDecorations(node: HTMLElement): void {
  const elements = getTilesFromNode(node);
  for (let i = 0; i < elements.length; i++) {
    clearDecoration(elements[i]);
  }
}

export class FileTreeDecoration {

  private readonly elementManager: FileTreeElementManager;
  private readonly disposables = new DisposableStore();
  private enabled = false;

  constructor() {
    this.elementManager = new FileTreeElementManager();
    config.onDidChangeConfiguration(this.onConfigurationChange, this, this.disposables);
    decorationService.onDidChangeDecorations(this.onDidChangeDecorations, this, this.disposables);
    App.onDidChangeWorkspaceFolder(this.onDidChangeWorkspaceFolder, this, this.disposables);
    Event.fromEditorManager('new-file')(this.onNewEditorFile, this, this.disposables);
    this.onConfigurationChange(undefined);
  }

  private onConfigurationChange(e: ConfigurationChangeEvent | undefined): void {
    if (e && !e.affectsConfiguration('vcgit.showDecorationInFileTree')) {
      return;
    }

    const gitConfig = config.get('vcgit');
    const enabled = gitConfig!.showDecorationInFileTree;

    if (this.enabled === enabled) {
      return;
    }

    this.enabled = enabled;
    if (enabled) {
      this.refresh();
    } else {
      this.clearAll();
    }
  }

  private onDidChangeWorkspaceFolder(): void {
    this.onDidChangeDecorations();
  }

  private onNewEditorFile(file: any): void {
    if (!this.enabled || !(file.tab instanceof HTMLElement)) {
      return;
    }

    file.tab.setAttribute("data-url", file.uri);
    applyDecoration(file.tab);
  }

  @debounce(300)
  private onDidChangeDecorations(): void {
    if (!this.enabled) {
      return;
    }

    this.refresh();
  }

  private refresh(): void {
    const roots = getRoots();
    for (const root of roots) {
      this.setupRootElement(root);
    }
    this.updateFileTabDecorations();
  }

  private setupRootElement(root: Acode.Collapsible): void {
    this.elementManager.setupRoot(root, {
      onToggle: () => {
        if (!root.unclasped) {
          this.elementManager.restore(root);
          const { dispose } = Event.fromDOMEvent(root, 'click')(() => {
            if (!root.unclasped) {
              return;
            }
            dispose();
            setTimeout(() => this.setupRootElement(root), 300);
          });
        } else {
          applyDecorations(root.parentElement!);
        }
      },
      onExpandedChange: (folderUrl) => {
        setTimeout(() => {
          const fileTree = this.elementManager.getFileTree(root);
          if (!fileTree) {
            return;
          }

          const folderElement = fileTree.findElement(folderUrl);
          if (folderElement?.parentElement) {
            applyDecorations(folderElement.parentElement);
          }
        }, 0);
      }
    });

    applyDecorations(root.parentElement!);
  }

  private updateFileTabDecorations(): void {
    const files = editorManager.files;
    for (let i = 0; i < files.length; i++) {
      const file = files[i] as any;
      if (file.tab instanceof HTMLElement) {
        file.tab.setAttribute("data-url", file.uri);
      }
    }
    applyDecorations(editorManager.openFileList);
  }

  private clearAll(): void {
    this.elementManager.restoreAll();
    clearDecorations(filesContainer);
    clearDecorations(editorManager.openFileList);
  }

  dispose(): void {
    this.clearAll();
    this.disposables.dispose();
  }
}
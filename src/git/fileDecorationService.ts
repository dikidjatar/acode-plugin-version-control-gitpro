import { debounce } from "../base/decorators";
import { Disposable, DisposableStore, IDisposable } from "../base/disposable";
import { Event } from "../base/event";
import { uriToPath } from "../base/uri";

const sidebarApps = acode.require("sidebarApps");

export class FileDecoration {
  badge?: string;

  color?: string;

  propagate?: boolean;

  constructor(badge?: string, color?: string) {
    this.badge = badge;
    this.color = color;
  }
}

export interface FileDecorationProvider extends IDisposable {
  onDidChangeFileDecorations?: Event<string[]>;
  provideFileDecoration(
    uri: string,
  ): FileDecoration | undefined | Promise<FileDecoration | undefined>;
}

export class AcodeFileDecorationService {
  private readonly providers: Set<FileDecorationProvider> = new Set();
  private readonly filesContainer: HTMLElement | undefined;

  private readonly disposables = new DisposableStore();

  constructor() {
    this.filesContainer = sidebarApps.get("files");

    Event.fromEditorManager("new-file")((file) => {
      if (file.tab instanceof HTMLElement) {
        file.tab.setAttribute("data-url", file.uri);
        this.applyDecoration(file.tab);
      }
    });
  }

  registerFileDecorationProvider(
    provider: FileDecorationProvider,
  ): IDisposable {
    const disposable = new DisposableStore();
    this.providers.add(provider);
    provider.onDidChangeFileDecorations?.(
      this.onDidChangeFileDecorations,
      this,
      disposable,
    );

    this.refresh();

    disposable.add(
      Disposable.toDisposable(() => {
        this.providers.delete(provider);
        this.refresh();
      }),
    );

    return disposable;
  }

  @debounce(500)
  private onDidChangeFileDecorations(): void {
    this.refresh();
  }

  private refresh(): void {
    const elements: Node[] = [];
    if (this.filesContainer) {
      elements.push(...this.filesContainer.querySelectorAll(".tile[data-url]"));
    }
    this.updateFileTabUrl();
    elements.push(
      ...editorManager.openFileList.querySelectorAll(".tile[data-url]"),
    );

    elements.forEach((element) => this.applyDecoration(element as HTMLElement));
  }

  private updateFileTabUrl(): void {
    editorManager.files
      .filter((file) => !!file.uri)
      .forEach((file) => {
        const fieTab = file.tab as unknown;
        if (fieTab instanceof HTMLElement) {
          fieTab.setAttribute("data-url", file.uri);
        }
      });
  }

  private applyDecoration(element: HTMLElement) {
    const url = element.dataset.url;

    if (!url) {
      return;
    }

    const path = uriToPath(url);

    for (const provider of this.providers) {
      const updateDecoration = (decoration: FileDecoration | undefined) => {
        if (!decoration) {
          return;
        }

        if (decoration.propagate !== false) {
          this.renderFileDecoration(element, decoration);
        }
      };

      const result = provider.provideFileDecoration(path);

      if (result instanceof Promise) {
        result.then(updateDecoration);
      } else {
        updateDecoration(result);
      }
    }
  }

  private renderFileDecoration(
    element: HTMLElement,
    decoration: FileDecoration,
  ) {
    this.clearDecoration(element);

    const text = element.querySelector(".text") as HTMLElement;
    const badge = tag("span", {
      className: "badge",
      style: {
        fontSize: "1em",
        height: "30px",
        minWidth: "30px",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      },
    });

    if (decoration.color) {
      badge.style.color = decoration.color;
      text.style.color = decoration.color;
    }

    if (decoration.badge) {
      badge.textContent = decoration.badge;

      if (text.nextSibling) {
        element.insertBefore(badge, text.nextSibling);
      } else {
        element.appendChild(badge);
      }
    }
  }

  private clearDecoration(element: HTMLElement) {
    const text = element.querySelector(".text") as HTMLElement;
    const badge = element.querySelector(".badge");

    if (text) {
      text.style.color = "var(--primary-text-color)";
    }

    if (badge) {
      badge.remove();
    }
  }

  dispose(): void {
    this.providers.forEach((provider) => provider.dispose());
    this.disposables.dispose();
  }
}

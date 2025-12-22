import { Disposable, DisposableStore, IDisposable } from "../base/disposable";
import { Event } from "../base/event";
import { uriToPath } from "../base/uri";

const sidebarApps = acode.require('sidebarApps');

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
  provideFileDecoration(uri: string): FileDecoration | undefined | Promise<FileDecoration | undefined>;
}

export class AcodeFileDecorationService {

  private providers: Set<FileDecorationProvider> = new Set();
  private container: HTMLElement | undefined;
  private observer: MutationObserver;

  constructor() {
    this.container = sidebarApps.get('files');
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const target = mutation.target;

          if (target instanceof HTMLElement) {
            if (target.classList.contains('collapsible')) {
              setTimeout(() => this.processNode(target), 100);
            }
          }
        }
      }
    });

    if (this.container) {
      this.observer.observe(this.container, {
        attributes: true,
        subtree: true,
        attributeFilter: ['class']
      });
    }
  }

  registerFileDecorationProvider(provider: FileDecorationProvider): IDisposable {
    const disposable = new DisposableStore();
    this.providers.add(provider);
    provider.onDidChangeFileDecorations?.(this.refresh, this, disposable);

    this.refresh();

    disposable.add(Disposable.toDisposable(() => {
      this.providers.delete(provider);
      this.refresh();
    }));

    return disposable;
  }

  private refresh(): void {
    if (!this.container) {
      return;
    }

    this.processNode(this.container);
  }

  private processNode(node: HTMLElement): void {
    const elements = Array.from(node.querySelectorAll('.tile[data-url]')) as HTMLElement[];
    elements.forEach(element => this.clearDecoration(element));
    elements.forEach(element => this.applyDecoration(element));
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
      }

      const result = provider.provideFileDecoration(path);

      if (result instanceof Promise) {
        result.then(updateDecoration);
      } else {
        updateDecoration(result);
      }
    }
  }

  private renderFileDecoration(element: HTMLElement, decoration: FileDecoration) {
    const text = element.querySelector('.text') as HTMLElement;
    const badge = tag('span', {
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
    const text = element.querySelector('.text') as HTMLElement;
    const badge = element.querySelector('.badge');

    if (text) {
      text.style.color = 'var(--primary-text-color)';
    }

    if (badge) {
      badge.remove();
    }
  }

  dispose(): void {
    this.observer.disconnect();
    this.providers.forEach(provider => provider.dispose());
  }
}
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

export interface FileDecorationProvider {
  onDidChangeFileDecorations?: Event<string[]>;
  provideFileDecoration(uri: string): FileDecoration | undefined;
}

class AcodeFileDecorationService {

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
              this.processNode(target);
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

  register(provider: FileDecorationProvider): IDisposable {
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

  private async processNode(node: HTMLElement): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 100));

    const elements = Array.from(node.querySelectorAll('.tile[data-url]')) as HTMLElement[];
    elements.forEach(element => this.applyDecoration(element));
  }

  private applyDecoration(element: HTMLElement) {
    this.clearDecoration(element);

    const url = element.dataset.url;

    if (!url) {
      return;
    }

    const path = uriToPath(url);

    for (const provider of this.providers) {
      const decoration = provider.provideFileDecoration(path);

      if (!decoration) {
        continue;
      }

      if (decoration.propagate !== false) {
        this.renderFileDecoration(element, decoration);
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

    if (decoration.badge) {
      badge.textContent = decoration.badge;
    }

    if (decoration.color) {
      badge.style.color = decoration.color;
      text.style.color = decoration.color;
    }

    if (text.nextSibling) {
      element.insertBefore(badge, text.nextSibling);
    } else {
      element.appendChild(badge);
    }
  }

  private clearDecoration(element: HTMLElement) {
    const text = element.querySelector('.text') as HTMLElement;
    const badge = element.querySelector('.badge');

    text.style.color = 'var(--primary-text-color)';

    if (badge) {
      badge.remove();
    }
  }
}

const service = new AcodeFileDecorationService();

export function registerFileDecorationProvider(provider: FileDecorationProvider): IDisposable {
  return service.register(provider);
}
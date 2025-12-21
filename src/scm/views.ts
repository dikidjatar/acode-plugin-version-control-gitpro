import { App } from "../base/app";
import { SyncDescriptor } from "../base/descriptor";
import { Disposable, DisposableStore, IDisposable } from "../base/disposable";
import { Emitter, Event } from "../base/event";
import { parseLinkedText } from "../base/linkedText";

export interface IViewDescriptor {
  readonly id: string;
  readonly ctorDescriptor: SyncDescriptor<IView>;
  readonly when?: () => boolean;
  readonly index?: number;
}

export interface IView {
  render(): void;
  dispose(): void;
}

export interface IViewContent {
  readonly content: string;
  when(): boolean | 'default';
}

interface IItem {
  content: IViewContent;
  visible: Boolean;
}

export interface IViewWelcomeDelegate {
  readonly onDidChangeViewWelcomeState: Event<void>;
  readonly onDidChangeViewWelcomeContent: Event<void>;
  shouldShowWelcome(): boolean;
  getViewWelcomeContent(): IViewContent[];
}

class ViewWelcomeController {

  private defaultItem: IItem | undefined;
  private items: IItem[] = [];

  private _enabled: boolean = false;
  get enabled(): boolean { return this._enabled; }
  private element: HTMLElement | undefined;

  private readonly disposables = new DisposableStore();
  private readonly enabledDisposables = this.disposables.add(new DisposableStore());
  private readonly renderDisposables = this.disposables.add(new DisposableStore());

  constructor(
    private readonly container: HTMLElement,
    private readonly delegate: IViewWelcomeDelegate
  ) {
    this.disposables.add(Event.runAndSubscribe(this.delegate.onDidChangeViewWelcomeState, () => this.onDidChangeViewWelcomeState()));
  }

  private onDidChangeViewWelcomeState(): void {
    const enabled = this.delegate.shouldShowWelcome();

    if (this._enabled === enabled) {
      return;
    }

    this._enabled = enabled;

    if (!enabled) {
      this.enabledDisposables.clear();
      return;
    }

    const viewWelcomeContainer = this.container.appendChild(tag('div', { className: 'welcome-view' }));
    this.element = viewWelcomeContainer.appendChild(tag('div', { className: 'welcome-view-content', tabIndex: 0 }));

    this.enabledDisposables.add(Disposable.toDisposable(() => {
      viewWelcomeContainer.remove();
      this.element = undefined;
    }));

    this.enabledDisposables.add(this.delegate.onDidChangeViewWelcomeContent(this.onDidChangeViewWelcomeContent, this));
    this.onDidChangeViewWelcomeContent();
  }

  private onDidChangeViewWelcomeContent(): void {
    const contents = this.delegate.getViewWelcomeContent();

    this.items = [];

    for (const content of contents) {
      if (content.when() === 'default') {
        this.defaultItem = { content, visible: true };
      } else {
        const visible = content.when() === true;
        this.items.push({ content, visible });
      }
    }

    this.render();
  }

  private render(): void {
    this.renderDisposables.clear();
    this.element!.textContent = '';

    const contents = this.getContent();

    if (contents.length === 0) {
      return;
    }

    for (const { content } of contents) {
      const lines = content.split('\n');

      for (let line of lines) {
        line = line.trim();

        if (!line) {
          continue;
        }

        const linkedText = parseLinkedText(line);

        if (linkedText.nodes.length === 1 && typeof linkedText.nodes[0] !== 'string') {
          const node = linkedText.nodes[0];
          const buttonContainer = this.element!.appendChild(tag('div', { className: 'button-container' }));
          buttonContainer.append(tag('button', { innerText: node.label }));
          Event.fromDOMEvent(buttonContainer, 'click')(_ => {
            App.open(node.href);
          }, undefined, this.renderDisposables);
          this.renderDisposables.add(Disposable.toDisposable(() => {
            buttonContainer.remove();
          }));
        } else {
          const p = this.element!.appendChild(tag('p'));

          for (const node of linkedText.nodes) {
            if (typeof node === 'string') {
              p.append(tag('span', { className: 'text', textContent: node }));
            } else {
              const link = p.appendChild(tag('span', { className: 'text link' }));
              link.textContent = node.label;
              Event.fromDOMEvent(link, 'click')(_ => {
                App.open(node.href);
              }, undefined, this.disposables);
            }
          }
        }
      }
    }
  }

  private getContent(): IViewContent[] {
    const visibleItems = this.items.filter(v => v.visible);

    if (visibleItems.length === 0 && this.defaultItem) {
      return [this.defaultItem.content];
    }

    return visibleItems.map(v => v.content);
  }

  dispose(): void {
    this.disposables.dispose();
  }
}

interface ViewDescriptorItem {
  viewDescriptor: IViewDescriptor;
  view?: IView;
}

export class ViewContainer extends Disposable.Disposable {

  private _viewDescriptors: ViewDescriptorItem[] = [];
  private _viewWelcomeContents: Set<IViewContent> = new Set<IViewContent>();

  protected _onDidChangeViewWelcomeState = this._register(new Emitter<void>());
  readonly onDidChangeViewWelcomeState = this._onDidChangeViewWelcomeState.event;

  protected _onDidChangeViewWelcomeContent = this._register(new Emitter<void>());
  readonly onDidChangeViewWelcomeContent = this._onDidChangeViewWelcomeContent.event;

  create(parent: HTMLElement): void {
    this._register(new ViewWelcomeController(parent, this));
  }

  addViews(views: IViewDescriptor[]): void {
    for (const vd of views) {
      if (this._viewDescriptors.some(v => v.viewDescriptor.id === vd.id)) {
        continue;
      }
      const item: ViewDescriptorItem = { viewDescriptor: vd };
      this._viewDescriptors.push(item);
    }

    // keep descriptors ordered by index
    this._viewDescriptors.sort((a, b) => {
      const ai = a.viewDescriptor.index ?? Number.POSITIVE_INFINITY;
      const bi = b.viewDescriptor.index ?? Number.POSITIVE_INFINITY;
      return ai - bi;
    });

    this.updateViews();
  }

  protected createView(viewDescriptor: IViewDescriptor): IView {
    return Reflect.construct(viewDescriptor.ctorDescriptor.ctor, viewDescriptor.ctorDescriptor.staticArguments) as IView;
  }

  getView(id: string): IView | undefined {
    const view = this._viewDescriptors.find(v => v.viewDescriptor.id === id);
    return view?.view;
  }

  updateViews(): void {
    for (const item of this._viewDescriptors) {
      const when = item.viewDescriptor.when;
      const shouldShow = when === undefined ? true : !!when();

      if (shouldShow) {
        if (!item.view) {
          try {
            item.view = this.createView(item.viewDescriptor);
            item.view.render();
          } catch {
            if (item.view) {
              item.view.dispose();
              item.view = undefined;
            }
            continue;
          }
        }
      } else {
        if (item.view) {
          item.view.dispose();
          item.view = undefined;
        };
      }
    }
  }

  registerViewWelcomeContent(viewContent: IViewContent): IDisposable {
    this._viewWelcomeContents.add(viewContent);
    this._onDidChangeViewWelcomeContent.fire();

    return Disposable.toDisposable(() => {
      this._viewWelcomeContents.delete(viewContent);
      this._onDidChangeViewWelcomeContent.fire();
    });
  }

  getViewWelcomeContent(): IViewContent[] {
    return Array.from(this._viewWelcomeContents);
  }

  shouldShowWelcome(): boolean {
    return false;
  }

  public override dispose(): void {
    super.dispose();
    this._viewDescriptors.forEach(vd => vd.view?.dispose());
    this._viewDescriptors = [];
  }
}
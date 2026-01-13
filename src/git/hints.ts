import { Disposable, IDisposable } from "../base/disposable";
import { Emitter, Event } from "../base/event";

const actionStack = acode.require('actionStack');
const InputHints = acode.require('inputHints');

export interface HintItem {
  label: string;
  icon?: string;
  description?: string;
  smallDescription?: string;
  detail?: string;
  type?: 'item' | 'separator';
}

export interface InputHintOptions {
  value?: string;
  type?: string;
  placeholder?: string;
  enterKeyHint?: string;
  ignoreFocusOut?: boolean;
}

class Progress {

  private readonly element: HTMLElement;
  private readonly progress: HTMLElement;

  constructor(container: HTMLElement) {
    this.element = container.appendChild(tag('div'));
    this.progress = this.element.appendChild(tag('div'));

    this.element.style.display = 'none';
    this.element.style.width = '100%';
    this.element.style.height = '1px';
    this.element.style.position = 'relative';
    this.element.style.overflow = 'hidden';

    this.progress.style.width = '20%';
    this.progress.style.height = '100%';
    this.progress.style.position = 'absolute';
    this.progress.style.animation = 'linearMove 2s linear infinite';
    this.progress.style.backgroundColor = '#007bff';
  }

  hide() { this.element.style.display = 'none'; }
  show() { this.element.style.display = 'block'; }
}

/**
 * Custom palette input hints
 * @see https://github.com/Acode-Foundation/Acode/blob/main/src/components/palette/index.js
 */
export class InputHint<T extends HintItem> {

  private readonly input: HTMLInputElement;
  private readonly palette: HTMLElement;
  private readonly mask: HTMLElement;
  private readonly style: HTMLStyleElement;
  private getList: ((hints: Acode.Hint[]) => void) | undefined;
  private _items: T[] = [];
  private disposables: IDisposable[] = [];
  private isDisposed: boolean = false;
  private readonly progress: Progress;

  private readonly _onDidSelect = new Emitter<T | undefined>();
  readonly onDidSelect = this._onDidSelect.event;

  private readonly _onDidHide = new Emitter<void>();
  readonly onDidHide = this._onDidHide.event;

  private readonly _onDidChangeValue = new Emitter<void>();
  readonly onDidChangeValue = this._onDidChangeValue.event;

  get items(): T[] { return this._items; }
  set items(items: T[]) {
    if (this.isDisposed) {
      return;
    }

    this._items = items;
    this.getList?.(getHintItems(items));
  }

  private _lastInputValue: string = '';
  get value(): string { return this.input.value; }
  set value(value: string) {
    if (this.isDisposed) {
      return;
    }

    this.input.value = value;
    this.input.dispatchEvent(new globalThis.Event('input'));
  }

  get placeholder() { return this.input.placeholder; }
  set placeholder(placeholder: string) { this.input.placeholder = placeholder; }
  get type(): string { return this.input.type; }
  set type(type: string) { this.input.type = type; }

  private ignoreFocusOutDisposable: IDisposable | undefined;
  private _ignoreFocusOut: boolean = false;
  get ignoreFocusOut(): boolean { return this._ignoreFocusOut; }
  set ignoreFocusOut(ignoreFocusOut: boolean) {
    if (this._ignoreFocusOut === ignoreFocusOut) {
      return;
    }
    this._ignoreFocusOut = ignoreFocusOut;
    this.updateIgnoreFocusOut();
  }

  set enterKeyHint(enterKeyHint: string) { this.input.enterKeyHint = enterKeyHint; }

  set loading(loading: boolean) {
    if (loading) {
      this.progress.show();
    } else {
      this.progress.hide();
    }
  }

  constructor() {
    this.input = tag('input');
    this.input.onkeydown = this.onKeyDown.bind(this);
    this.style = document.head.appendChild(tag('style'));
    this.style.innerHTML = `#hints > li[action="hint"] > div.git-hint-item .icon::before {
      display: flex !important;
      justify-content: center !important;
      align-items: center !important;
      width: 14px !important;
      height: 14px !important;
    }
    @keyframes linearMove {
      0% {
        transform: translateX(-100%);
      }

      50% {
        transform: translateX(200%);
      }

      100% {
        transform: translateX(500%);
      }
    }`;
    this.mask = tag('div', { className: 'mask' });
    this.palette = tag('div', { id: 'palette' });
    this.palette.style.flexDirection = 'column';
    this.palette.appendChild(this.input);
    this.progress = new Progress(this.palette);
    InputHints(
      this.input,
      getList => this.getList = getList,
      value => {
        this.input.value = this._lastInputValue;
        const item = this.items[Number(value)];
        this._onDidSelect.fire(item.type !== 'separator' ? item : undefined);
      }
    );
    app.append(this.palette, this.mask);

    this.input.focus();
    this.input.dispatchEvent(new globalThis.Event('input'));
    Event.fromDOMEvent(this.input, 'input')(() => {
      this._lastInputValue = this.input.value;
      this._onDidChangeValue.fire();
    }, null, this.disposables);

    this.updateIgnoreFocusOut();

    actionStack.push({ id: 'input-hints', action: this.dispose.bind(this) });
  }

  private updateIgnoreFocusOut() {
    if (!this.ignoreFocusOut) {
      const disposables: IDisposable[] = [];
      Event.fromDOMEvent(this.input, 'blur')(this.dispose, this, disposables);
      Event.fromDOMEvent(this.mask, 'click')(this.dispose, this, disposables);
      this.ignoreFocusOutDisposable = Disposable.toDisposable(() => Disposable.dispose(disposables));
    } else {
      this.ignoreFocusOutDisposable?.dispose();
      this.ignoreFocusOutDisposable = undefined;
    }
  }

  public async hint(): Promise<T | undefined> {
    if (this.isDisposed) {
      return;
    }

    const result = await Promise.race<T | undefined>([
      new Promise(c => this.onDidSelect(item => c(item))),
      new Promise<undefined>(c => this.onDidHide(() => c(undefined)))
    ]);

    this.dispose();
    return result;
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape') {
      return;
    }

    this.dispose();
  }

  public dispose(): void {
    actionStack.remove('input-hints');
    this.style.remove();
    this.palette.remove();
    this.mask.remove();
    this.disposables = Disposable.dispose(this.disposables);
    this.isDisposed = true;
    setTimeout(() => this._onDidHide.fire(), 50);
  }
}

export async function showInputHints<T extends HintItem>(hints: T[] | Promise<T[]>, options: InputHintOptions = {}): Promise<T | undefined> {
  const inputHint = new InputHint<T>();
  inputHint.value = options.value || '';
  inputHint.type = options.type || '';
  inputHint.placeholder = options.placeholder || '';
  if (options.enterKeyHint) {
    inputHint.enterKeyHint = options.enterKeyHint;
  }
  if (options.ignoreFocusOut) {
    inputHint.ignoreFocusOut = options.ignoreFocusOut;
  }

  const items = hints instanceof Promise ? await hints : hints;
  inputHint.items = items;
  return await inputHint.hint();
}

function getHintItems(items: HintItem[]): Acode.Hint[] {
  return items.map((item, index) => ({
    text: buildHintContent(item),
    value: `${index}`
  }));
}

function buildHintContent(item: HintItem): string {
  return item.type !== 'separator' ? `<div class="git-hint-item" style="width: 100%;">
    <div style="display: flex; align-items: center;">
      ${item.icon ? `<span class="icon ${item.icon}" style="width: 30px; height: 20px; background-size: 14px;"></span>` : ''}
      <span ${item.smallDescription ? `data-str="${item.smallDescription}"` : ''}>${item.label} ${item.description && !item.smallDescription ? `<span style="opacity: 0.6">${item.description}</span>` : ''}</span>
    </div>
    ${item.detail ? `<p style="width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 10px; opacity: 0.6">${item.detail}</p>` : ''}
  </div>` : `<small>${item.label}</small>`;
}
import { Disposable, IDisposable } from "../base/disposable";

const palette = acode.require('palette');

export interface HintItem {
  label: string;
  icon?: string;
  description?: string;
  smallDescription?: string;
  detail?: string;
  type?: 'item' | 'separator';
}

export function showInputHints<T extends HintItem>(hints: T[] | (() => Promise<T[]>), options?: { placeholder: string }): Promise<T | undefined> {
  let items: T[] = [];

  const getItems = async () => {
    const promiseOrList = typeof hints === 'function' ? hints() : hints;
    if (promiseOrList instanceof Promise) {
      return getHintItems(items = await promiseOrList);
    }
    return getHintItems(items = promiseOrList);
  };

  return new Promise<T | undefined>((resolve) => {
    const styleDisposable = addStyle();
    palette(getItems as any, (value: string) => {
      const item = items.find((_, index) => index === Number(value));
      resolve(item?.type === 'separator' ? undefined : item);
    }, options?.placeholder, () => styleDisposable.dispose());
  });
}

function getHintItems(items: HintItem[]): Acode.HintObj[] {
  return items.map((item, index) => ({
    text: buildHintContent(item),
    value: `${index}`
  }));
}

function addStyle(): IDisposable {
  const style = document.head.appendChild(tag('style'));
  style.innerHTML = `
  #hints > li[action="hint"] > div.git-hint-item .icon::before {
    display: flex !important;
    justify-content: center !important;
    align-items: center !important;
    width: 14px !important;
    height: 14px !important;
  }`;
  return Disposable.toDisposable(() => style.remove());
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
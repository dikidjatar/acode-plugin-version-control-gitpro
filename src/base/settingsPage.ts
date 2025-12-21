const Page: any = acode.require('page');
const actionStack = acode.require('actionStack');
const alert = acode.require('alert');
const prompt = acode.require('prompt');
const select = acode.require('select');

export type SettingsItems = Acode.PluginSettings['list'];

type CheckboxElement = { checked: boolean; value: boolean; toggle(): void; } & HTMLElement;

export class SettingsPage {

  private _page: Acode.WCPage;
  private _listContainer: HTMLElement;

  constructor(
    private _title: string,
    settings: SettingsItems,
    callback: (key: string, value: unknown) => void
  ) {
    const _undefined = undefined as any;
    this._page = Page(_title, { lead: _undefined, tail: _undefined });
    this._page.id = 'settings';
    this._page.onhide = () => {
      actionStack.remove(_title);
    }
    this._listContainer = tag('div', { tabIndex: 0, className: 'main list' });
    this._listItems(this._listContainer, settings, callback);
    this._page.body = this._listContainer;
    this._page.append(tag('div', { style: { height: '50vh' } }));
  }

  private get _children(): HTMLElement[] {
    return [...this._listContainer.children] as HTMLElement[];
  }

  private _listItems(
    container: HTMLElement,
    items: SettingsItems,
    callback: (key: string, value: unknown) => void
  ): void {
    this._sortedItems(items);
    const listItems: HTMLElement[] = [];

    items.forEach((item) => {
      const listItem = tag('div', { className: 'list-item' });
      listItem.tabIndex = 1;
      listItem.dataset.key = item.key;
      listItem.dataset.action = 'list-item';

      listItem.appendChild(tag('span', { className: `icon ${item.icon || 'no-icon'}` }));

      const settingContainer = listItem.appendChild(tag('div', { className: 'container' }));
      const settingName = settingContainer.appendChild(tag('div', { className: 'text' }));
      const capitalizeText = () => {
        const first = item.text.charAt(0).toUpperCase();
        return first + item.text.slice(1);
      }
      settingName.textContent = capitalizeText();

      if (item.info) {
        const infoElement = tag('span', { className: 'icon info info-button' });
        infoElement.dataset.action = 'info';
        infoElement.onclick = () => {
          alert(strings['info'], item.info!);
        }
        settingName.appendChild(infoElement);
      }

      if (item.checkbox !== undefined || typeof item.value === 'boolean') {
        const checkbox = listItem.appendChild(tag('label', { className: 'input-checkbox' }));
        const input = checkbox.appendChild(tag('input'));
        input.type = 'checkbox';
        input.checked = item.checkbox || !!item.value;
        checkbox.append(tag('span', { style: { height: '1rem', width: '1rem' }, className: 'box' }));

        Object.defineProperties(checkbox, {
          checked: {
            get() {
              return !!input.checked;
            },
            set(value) {
              input.checked = value;
            }
          },
          value: {
            get() {
              return this.checked;
            },
            set(value) {
              this.checked = value;
            }
          },
          toggle: {
            value() {
              this.checked = !this.checked;
            },
          },
        });
        listItem.style.paddingRight = "10px";
      } else if (item.value !== undefined) {
        const valueElement = settingContainer.appendChild(tag('div', { className: 'value' }));
        setValueText(valueElement, item.value, item.valueText);
      }

      listItems.push(listItem);
      listItem.addEventListener('click', onclick);
    });

    listItems.forEach((item) => container.appendChild(item));

    async function onclick(e: MouseEvent): Promise<void> {
      const target = e.target as HTMLElement;
      const key = target.dataset.key;

      const item = items.find((item) => item.key === key);
      if (!item) {
        return;
      }

      const {
        select: options,
        prompt: promptText,
        checkbox,
        text,
        value,
        valueText,
        promptType,
        promptOptions
      } = item as any;

      const valueTextElement = target.get('.value') as HTMLElement;
      const checkboxElement = target.get('.input-checkbox') as CheckboxElement;

      let result;

      try {
        if (options) {
          result = await select(text, options, { default: value });
        } else if (checkbox !== undefined) {
          checkboxElement.toggle();
          result = checkboxElement.checked;
        } else if (promptText) {
          result = await prompt(promptText, value, promptType, promptOptions);
          if (result === null) {
            return;
          }
        }
      } catch (error) {
        console.log("error", error);
      }

      item.value = result;
      setValueText(valueTextElement, result, valueText?.bind(item));
      callback.call(target, key!, item.value);
    }
  }

  private _sortedItems(items: SettingsItems): void {
    items.sort((acc, cur) => {
      if (!acc?.text || !cur?.text) return 0;
      return acc.text.localeCompare(cur.text);
    });
  }
  hide(): void {
    this._page.hide();
  }

  show(): void {
    actionStack.push({ id: this._title, action: this._page.hide });
    app.append(this._page);
    this._listContainer.focus();
  }

  setTitle(title: string): void {
    this._page.setTitle(title);
  }

  search(key: string): HTMLElement[] {
    return this._children.filter((child) => {
      const text = child.textContent.toLowerCase();
      return text.match(new RegExp(key, 'i'));
    });
  }

  restoreList(): void {
    this._listContainer.content = this._children as any;
  }
}

function setValueText(element?: HTMLElement, value?: any, valueText?: (value: any) => string): void {
  if (!element) {
    return;
  }

  if (typeof valueText === 'function') {
    value = valueText(value);
  }

  if (typeof value === 'string') {
    if (value.match("\n")) [value] = value.split("\n");

    if (value.length > 47) {
      value = value.slice(0, 47) + "...";
    }
  }

  element.textContent = value;
}
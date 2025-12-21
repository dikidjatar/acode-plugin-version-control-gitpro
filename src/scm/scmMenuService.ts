import { Disposable, DisposableMap, IDisposable } from "../base/disposable";
import { ISCMMenuItemAction, ISCMMenuService } from "./types";

const contextmenu = acode.require('contextmenu');

export class SCMMenuService implements ISCMMenuService, IDisposable {

  private disposables = new DisposableMap<Acode.ContextMenu, IDisposable>();
  private menuStack: Acode.ContextMenu[] = [];

  constructor() { }

  showContextMenu(delegate: { toggler: HTMLElement; getActions(submenu?: string): ISCMMenuItemAction[]; onSelect(id: string): void; }): void {
    const actions = delegate.getActions();
    const toggler = delegate.toggler;

    if (actions.length === 0) {
      return;
    }

    const { top, right, height, bottom } = toggler.getBoundingClientRect();
    const maxMenuHeight = innerHeight;
    const estimatedItemHeight = 50;
    const menuHeight = Math.min(actions.length * estimatedItemHeight, maxMenuHeight);

    const menuTop = bottom + menuHeight > innerHeight
      ? Math.max(6, top - (menuHeight - 100))
      : top + height;

    const menu = contextmenu({
      items: [],
      top: `${menuTop}px` as any,
      left: `${Math.max(0, innerWidth - right)}px` as any,
      toggler,
      transformOrigin: menuTop + menuHeight > innerHeight ? 'bottom right' : 'top right',
      innerHTML: () => actions.map(action => action.content()).join(''),
      onshow: () => {
        this.disposables.set(menu, Disposable.toDisposable(() => menu.destroy()));
        this.menuStack.push(menu);
      },
      onhide: () => {
        this.disposables.deleteAndDispose(menu);
        while (true) {
          const parentMenu = this.menuStack.pop();
          if (!parentMenu) {
            break;
          }
          parentMenu.hide();
        }
      },
      onselect: (id) => {
        if (typeof id !== 'string' || id === '') {
          return;
        }
        delegate.onSelect(id);
      },
      onclick: (event) => {
        const target = event.target as HTMLElement | null;
        if (!(target instanceof HTMLElement)) {
          return;
        }

        const submenu = target.dataset.submenu;

        if (!submenu) {
          return;
        }

        this.showContextMenu({ ...delegate, getActions: () => delegate.getActions(submenu), toggler: target });
      }
    });

    menu.show();
  }

  dispose(): void {
    this.menuStack = [];
    this.disposables.dispose();
  }
}
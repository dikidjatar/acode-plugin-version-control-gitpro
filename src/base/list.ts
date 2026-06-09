import { memoize } from "./decorators";
import { DisposableStore, IDisposable } from "./disposable";
import { Emitter, Event, EventBufferer } from "./event";

export interface IListRenderer<T, TTemplateData> {
  readonly templateId: string;
  renderTemplate(container: HTMLElement): TTemplateData;
  renderElement(element: T, index: number, templateData: TTemplateData): void;
  disposeElement?(element: T, index: number, templateData: TTemplateData): void;
  disposeTemplate(templateData: TTemplateData): void;
}

export interface IListDelegate<T> {
  getHeight(element: T): number;
  getTemplateId(element: T): string;
  isSupportedSwipeRight?(element: T): boolean;
}

export interface IListBrowserMouseEvent extends MouseEvent {
  isHandledByList?: boolean;
}

export interface IListMouseEvent<T> {
  readonly element: T | undefined;
  readonly index: number | undefined;
  readonly browserEvent: IListBrowserMouseEvent;
}

export interface IListEvent<T> {
  readonly elements: readonly T[];
  readonly indexes: readonly number[];
  readonly browserEvent?: UIEvent;
}

export interface IListContextMenuEvent<T> {
  readonly browserEvent: UIEvent;
  readonly element: T | undefined;
  readonly index: number | undefined;
  readonly anchor: HTMLElement | MouseEvent;
}

interface IRow {
  domNode: HTMLElement;
  templateData: any;
}

interface IItem<T> {
  readonly element: T;
  readonly templateId: string;
  row: IRow | null;
  size: number;
  selected: boolean;
}

export interface IListStyles {
  listBackground: string | undefined;
  listInactiveSelectionBackground: string | undefined;
  listInactiveSelectionForeground: string | undefined;
}

export const unthemedListStyles: IListStyles = {
  listBackground: undefined,
  listInactiveSelectionBackground: '#3F3F46',
  listInactiveSelectionForeground: undefined
}

export interface IStyleController {
  style(styles: IListStyles): void;
}

export class DefaultStyleController implements IStyleController {
  constructor(private styleElement: HTMLStyleElement, private selectorSuffix: string) { }

  style(styles: IListStyles): void {
    const suffix = this.selectorSuffix && `.${this.selectorSuffix}`;
    const content: string[] = [];

    if (styles.listBackground) {
      content.push(`.list${suffix} .tile { background: ${styles.listBackground} !important; }`);
    }

    if (styles.listInactiveSelectionBackground) {
      content.push(`.list${suffix} .tile.selected { background-color: ${styles.listInactiveSelectionBackground} !important; }`);
      content.push(`.list${suffix} .tile.selected:hover { background-color: ${styles.listInactiveSelectionBackground} !important; }`);
    }

    if (styles.listInactiveSelectionForeground) {
      content.push(`.list${suffix} .tile.selected { color: ${styles.listInactiveSelectionForeground} !important; }`);
    }

    this.styleElement.textContent = content.join('\n');
  }
}

function isEditableElement(element: Element): boolean {
  return element.tagName.toLowerCase() === 'input' || element.tagName.toLowerCase() === 'textarea';
}

function createStyleSheet(container: HTMLElement = document.head): HTMLStyleElement {
  const style = tag('style');
  style.type = 'text/css';
  style.media = 'screen';
  container.appendChild(style);
  return style;
}

interface IListOptions<T> {
  readonly styleController?: (suffix: string) => IStyleController;
}

interface TouchState {
  /**
   * clientX of the initial touch point.
   */
  startX: number;
  /**
   * clientY of the initial touch point.
   */
  startY: number;
  /**
   * List index of the item that was touched, or undefined for empty space.
   */
  index: number | undefined;
  /**
   * True once the horizontal swipe crosses SWIPE_THRESHOLD_X.
   */
  isDragging: boolean;
  /**
   * The `li.tile` element
   */
  tileElement: HTMLElement | null;
  /**
   * All direct children of `tileEl`
   */
  feedbackElements: HTMLElement[];
}

class List<T> implements IDisposable {
  private static InstanceCount = 0;

  /**
   * Minimum horizontal pixels the finger must travel to confirm a swipe-select.
   */
  private static readonly SWIPE_THRESHOLD_X = 50;
  /**
   * Maximum vertical drift allowed before the swipe is cancelled.
   */
  private static readonly SWIPE_MAX_Y = 40;

  readonly domId = `list_id_${++List.InstanceCount}`;
  readonly domNode: HTMLElement;
  readonly scrollableElement: HTMLUListElement;

  private items: IItem<T>[] = [];
  private renderers = new Map<string, IListRenderer<T, any>>();
  private styleController: IStyleController;
  private eventBufferer = new EventBufferer();

  protected readonly disposables = new DisposableStore();

  private _scrollTop: number = 0;
  get scrollTop(): number { return this._scrollTop }
  set scrollTop(scrollTop: number) {
    this._scrollTop = scrollTop;
    this.scrollableElement.scrollTop = scrollTop;
  }

  get length(): number { return this.items.length; }

  get contentHeight(): number {
    return this.items.reduce((total, item) => total + item.size, 0);
  }

  private touchState: TouchState | undefined = undefined;

  private readonly _onDidChangeContentHeight = this.disposables.add(new Emitter<number>());
  readonly onDidChangeContentHeight: Event<number> = this._onDidChangeContentHeight.event;

  private readonly _onDidChangeSelection = this.disposables.add(new Emitter<IListEvent<T>>());
  @memoize get onDidChangeSelection(): Event<IListEvent<T>> {
    return this.eventBufferer.wrapEvent(this._onDidChangeSelection.event);
  }

  private readonly _onMouseClick = this.disposables.add(new Emitter<IListMouseEvent<T>>());
  @memoize get onMouseClick(): Event<IListMouseEvent<T>> {
    return this._onMouseClick.event;
  }

  private readonly _onContextMenu = this.disposables.add(new Emitter<IListMouseEvent<T>>());
  @memoize get onContextMenu(): Event<IListContextMenuEvent<T>> {
    return Event.map(this._onContextMenu.event, ({ element, index, browserEvent }) => ({
      element,
      index,
      anchor: browserEvent.target as HTMLElement,
      browserEvent
    }));
  }

  private readonly _onPointer = this.disposables.add(new Emitter<IListMouseEvent<T>>());
  get onPointer(): Event<IListMouseEvent<T>> { return this._onPointer.event; }

  private readonly _onDidSwipeRightSelect = this.disposables.add(new Emitter<IListEvent<T>>());
  /**
   * Fires when the user performs a right-swipe gesture on a list item.
   * The event carries the single item that was swiped so callers can
   * toggle its selection without replacing the full selection set.
   */
  readonly onDidSwipeRightSelect: Event<IListEvent<T>> = this._onDidSwipeRightSelect.event;

  constructor(
    container: HTMLElement,
    private delegate: IListDelegate<T>,
    renderers: IListRenderer<any, any>[],
    options: IListOptions<T> = {}
  ) {
    this.domNode = container;
    this.scrollableElement = container.appendChild(tag('ul', { className: 'scroll' }));

    this.disposables.add(Event.fromDOMEvent(this.scrollableElement, 'scroll')(() => {
      this.scrollTop = this.scrollableElement.scrollTop;
      this.scrollableElement.dataset.scrollTop = `${this.scrollTop}`;
    }));

    this.domNode.classList.add(this.domId);

    for (const renderer of renderers) {
      this.renderers.set(renderer.templateId, renderer);
    }

    if (options.styleController) {
      this.styleController = options.styleController(this.domId);
    } else {
      const styleElement = createStyleSheet(this.domNode);
      this.styleController = new DefaultStyleController(styleElement, this.domId);
    }

    this.disposables.add(Event.fromDOMEvent(this.domNode, 'click')((e) => {
      const mouseEvent = this.toMouseEvent(e);
      this._onMouseClick.fire(mouseEvent);
      this.onViewPointer(mouseEvent);
    }));

    this.domNode.oncontextmenu = (e) => {
      this._onContextMenu.fire(this.toMouseEvent(e));
    };

    // Touch swipe-right listeners
    // touchmove must be non-passive so we can call preventDefault() to
    // suppress vertical scrolling while the user is swiping horizontally.
    Event.fromDOMEvent(this.scrollableElement, 'touchstart', { passive: true })(this.onTouchStart, this, this.disposables);
    Event.fromDOMEvent(this.scrollableElement, 'touchmove', { passive: false })(this.onTouchMove, this, this.disposables);
    Event.fromDOMEvent(this.scrollableElement, 'touchend', { passive: true })(this.onTouchEnd, this, this.disposables);
    Event.fromDOMEvent(this.scrollableElement, 'touchcancel', { passive: true })(this.onTouchCancel, this, this.disposables);

    // Inject swipe-selection styles scoped to this list instance.
    //
    // the translateX transform is applied to the tile's *inner child*
    // not the tile itself.  overflow:hidden clips the shifted child
    // content inside the tile boundary, so the tile's
    // own layout box never changes and the ul.scroll's scrollable area is never expanded
    // which is what was causing the spurious scrollbars.
    const swipeStyle = createStyleSheet(this.domNode);
    swipeStyle.textContent = [
      `.${this.domId} .tile { overflow: hidden; }`,
      `.${this.domId} .tile > * { transition: transform .06s linear; }`,
    ].join('\n');
  }

  splice(start: number, deleteCount: number, toInsert: readonly T[]): void {
    if (start < 0 || start > this.length) {
      throw new Error(`Invalid start index: ${start}`);
    }

    if (deleteCount < 0) {
      throw new Error(`Invalid delete count: ${deleteCount}`);
    }

    if (deleteCount === 0 && toInsert.length === 0) {
      return;
    }

    this.eventBufferer.bufferEvents(() => {
      // Remove old items
      const deleted = this.items.splice(start, deleteCount);
      for (const item of deleted) {
        this.removeItemFromDOM(item);
      }

      // Create new items
      const newItems: IItem<T>[] = toInsert.map(element => {
        const templateId = this.delegate.getTemplateId(element);
        const size = this.delegate.getHeight(element);
        return {
          element,
          templateId,
          size,
          row: null,
          selected: false
        };
      });

      this.items.splice(start, 0, ...newItems);

      // Update selection indexes
      this.updateSelectionAfterSplice(start, deleteCount, newItems.length);

      this.render();

      const contentHeight = this.contentHeight;
      this.scrollableElement.style.height = `${contentHeight}px`;
      this._onDidChangeContentHeight.fire(contentHeight);
    });
  }

  updateElementHeight(element: T, size: number): void {
    const index = this.items.findIndex(i => i.element === element);

    if (index < 0) {
      return;
    }

    const originalSize = this.items[index].size;

    if (originalSize === size) {
      return;
    }

    this.items[index].size = size;
    this.insertItemInDOM(this.items[index], index);

    const contentHeight = this.contentHeight;
    this.scrollableElement.style.height = `${contentHeight}px`;
    this._onDidChangeContentHeight.fire(contentHeight);
  }

  private render(): void {
    for (let i = 0; i < this.items.length; i++) {
      this.removeItemFromDOM(this.items[i]);
    }

    for (let i = 0; i < this.items.length; i++) {
      this.insertItemInDOM(this.items[i], i);
    }
  }

  private insertItemInDOM(item: IItem<T>, index: number): void {
    const renderer = this.renderers.get(item.templateId);

    if (!renderer) {
      throw new Error(`No renderer found for template id ${item.templateId}`);
    }

    if (!item.row) {
      const domNode = tag('li', { className: 'tile' });
      const templateData = renderer.renderTemplate(domNode);
      item.row = { domNode, templateData };
    }

    if (!item.row.domNode.parentElement) {
      const referenceNode = this.items.at(index + 1)?.row?.domNode ?? null;
      if (item.row.domNode.parentElement !== this.scrollableElement || item.row.domNode.nextElementSibling !== referenceNode) {
        this.scrollableElement.insertBefore(item.row.domNode, referenceNode);
      }
    }

    item.row.domNode.style.height = `${item.size}px`;
    item.row.domNode.setAttribute('data-index', `${index}`);
    item.row.domNode.classList.toggle('selected', item.selected);

    renderer.renderElement(item.element, index, item.row.templateData);
  }

  private removeItemFromDOM(item: IItem<T>): void {
    if (item.row) {
      const renderer = this.renderers.get(item.templateId);

      if (renderer && renderer.disposeElement) {
        renderer.disposeElement(item.element, this.items.indexOf(item), item.row.templateData);
      }

      item.row.domNode.remove();
      item.row = null;
    }
  }

  element(index: number): T {
    return this.items[index].element;
  }

  indexOf(element: T): number {
    return this.items.findIndex(item => item.element === element);
  }

  layout(height?: number, width?: number): void {
    if (height !== undefined) {
      this.domNode.style.height = `${height}px`;
    }

    if (width !== undefined) {
      this.domNode.style.width = `${width}px`;
    }
  }

  setSelection(indexes: number[], browserEvent?: UIEvent): void {
    for (const index of indexes) {
      if (index < 0 || index >= this.length) {
        throw new Error(`Invalid index ${index}`);
      }
    }

    const oldSelection = this.getSelection();
    const oldSet = new Set(oldSelection);
    const newSet = new Set(indexes);

    // Update selected state
    for (let i = 0; i < this.items.length; i++) {
      const wasSelected = this.items[i].selected;
      const isSelected = newSet.has(i);

      if (wasSelected !== isSelected) {
        this.items[i].selected = isSelected;
        if (this.items[i].row) {
          this.items[i].row!.domNode.classList.toggle('selected', isSelected);
        }
      }
    }

    if (oldSelection.length !== indexes.length || !oldSelection.every(i => newSet.has(i))) {
      this._onDidChangeSelection.fire({
        indexes,
        elements: indexes.map(i => this.element(i)),
        browserEvent
      });
    }
  }

  getSelection(): number[] {
    return this.items
      .map((item, index) => item.selected ? index : -1)
      .filter(index => index >= 0);
  }

  getSelectedElements(): T[] {
    return this.getSelection().map(i => this.element(i));
  }

  private updateSelectionAfterSplice(start: number, deleteCount: number, insertCount: number): void {
    const selection: number[] = [];

    for (let i = 0; i < this.items.length; i++) {
      if (i < start) {
        if (this.items[i].selected) {
          selection.push(i);
        }
      } else if (i >= start && i < start + insertCount) {
        this.items[i].selected = false;
      } else {
        const oldIndex = i - insertCount + deleteCount;
        if (oldIndex < this.items.length + deleteCount && this.items[i].selected) {
          selection.push(i);
        }
      }
    }
  }

  private toMouseEvent(browserEvent: MouseEvent): IListMouseEvent<T> {
    const index = this.getItemIndexFromEventTarget(browserEvent.target || null);
    const item = typeof index === 'undefined' ? undefined : this.items[index];
    const element = item?.element;
    return { browserEvent: browserEvent as IListBrowserMouseEvent, index, element };
  }

  private getItemIndexFromEventTarget(e: EventTarget | null): number | undefined {
    let element: HTMLElement | SVGElement | null = e as (HTMLElement | SVGElement | null);

    while ((element instanceof HTMLElement || element instanceof SVGElement) && element !== this.scrollableElement) {
      const rawIndex = element.getAttribute('data-index');

      if (rawIndex) {
        const index = Number(rawIndex);
        if (!isNaN(index)) {
          return index;
        }
      }

      element = element.parentElement;
    }

    return undefined;
  }

  protected onViewPointer(e: IListMouseEvent<T>): void {
    if (isEditableElement(e.browserEvent.target as HTMLElement)) {
      return;
    }

    if (e.browserEvent.isHandledByList) {
      return;
    }

    e.browserEvent.isHandledByList = true;
    const focus = e.index;

    if (typeof focus === 'undefined') {
      this.setSelection([], e.browserEvent);
      return;
    }

    this.setSelection([focus], e.browserEvent);
    this._onPointer.fire(e);
  }

  // Touch swipe-right handlers

  /**
   * Records the finger's starting position and which item it landed on.
   * Only single-finger touches are tracked. Multi-touch resets state.
   */
  private onTouchStart(e: TouchEvent): void {
    if (e.touches.length !== 1) {
      this.onTouchCancel();
      return;
    }

    const touch = e.touches[0];
    const index = this.getItemIndexFromEventTarget(e.target);
    const swipeIndex = (typeof index !== 'undefined' && this.isSwipeRightSupported(index))
      ? index
      : undefined;

    const tileElement = index !== undefined ? (this.items[index]?.row?.domNode ?? null) : null;
    // Collect ALL direct children so the entire tile content moves as one unit.
    const feedbackEls = tileElement ? (Array.from(tileElement.children) as HTMLElement[]) : [];

    this.touchState = {
      startX: touch.clientX,
      startY: touch.clientY,
      index: swipeIndex,
      isDragging: false,
      tileElement: tileElement,
      feedbackElements: feedbackEls
    };
  }

  private onTouchMove(e: TouchEvent): void {
    if (!this.touchState || this.touchState.index === undefined) {
      return;
    }

    const touch = e.touches[0];
    const deltaX = touch.clientX - this.touchState.startX;
    const deltaY = Math.abs(touch.clientY - this.touchState.startY);
    const totalDelta = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Cancel when the gesture is primarily vertical (after enough movement
    // to reliably determine intent).
    if (deltaY > List.SWIPE_MAX_Y || (totalDelta > 15 && deltaY > deltaX * 1.2)) {
      for (const element of this.touchState.feedbackElements) {
        element.style.transform = '';
      }
      if (this.touchState.tileElement) {
        this.touchState.tileElement.classList.remove('swipe-selecting');
      }
      this.touchState.isDragging = false;
      return;
    }

    if (deltaX > 0) {
      // Suppress vertical scroll only when the swipe is clearly horizontal
      if (deltaX > deltaY * 1.5) {
        e.preventDefault();
      }

      // Translate the tile capped so it never slides too far off screen
      const cappedX = Math.min(deltaX * 0.4, 24);
      const overThreshold = deltaX >= List.SWIPE_THRESHOLD_X;

      for (const element of this.touchState.feedbackElements) {
        element.style.transform = `translateX(${cappedX}px)`;
      }
      if (this.touchState.tileElement) {
        this.touchState.tileElement.classList.toggle('swipe-selecting', overThreshold);
      }

      if (overThreshold) {
        this.touchState.isDragging = true;
      }
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    if (!this.touchState) {
      return;
    }

    const { feedbackElements, tileElement, isDragging, index } = this.touchState;

    for (const element of feedbackElements) {
      element.style.transform = '';
    }
    if (tileElement) {
      tileElement.classList.remove('swipe-selecting');
    }

    if (isDragging && index !== undefined) {
      // Block the synthetic click that mobile browsers fire after touchend,
      // which would invoke onViewPointer and undo the multi-select.
      e.preventDefault();

      // Brief flash to confirm the toggle
      if (tileElement) {
        tileElement.classList.add('swipe-select-flash');
        setTimeout(() => tileElement.classList.remove('swipe-select-flash'), 380);
      }

      const item = this.items[index];
      if (item) {
        this._onDidSwipeRightSelect.fire({
          indexes: [index],
          elements: [item.element],
          browserEvent: e
        });
      }
    }
  }

  private onTouchCancel(): void {
    if (this.touchState) {
      for (const el of this.touchState.feedbackElements) {
        el.style.transform = '';
      }
      if (this.touchState.tileElement) {
        this.touchState.tileElement.classList.remove('swipe-selecting');
      }
    }
    this.touchState = undefined;
  }

  private isSwipeRightSupported(index: number): boolean {
    const item = this.items[index];
    return typeof item !== undefined &&
      (this.delegate.isSupportedSwipeRight?.(item.element) ?? false);
  }

  style(styles: IListStyles): void {
    this.styleController.style(styles);
  }

  dispose(): void {
    for (const item of this.items) {
      if (item.row) {
        const renderer = this.renderers.get(item.templateId);
        if (renderer) {
          renderer.disposeElement?.(item.element, this.items.indexOf(item), item.row.templateData);
          renderer.disposeTemplate(item.row.templateData);
        }
      }
    }

    this.disposables.dispose();
    this.domNode.remove();
  }
}

export interface CollapsableListOptions<T> extends IListOptions<T> {
  readonly allCaps?: boolean;
  readonly expanded?: boolean;
  readonly icon?: string;
}

export class CollapsableList<T> extends List<T> {
  private _expanded: boolean = true;
  readonly title: HTMLElement;

  private readonly _onDidChangeExpansionState: Emitter<boolean> = this.disposables.add(new Emitter<boolean>());
  readonly onDidChangeExpansionState: Event<boolean> = this._onDidChangeExpansionState.event;

  constructor(
    title: string,
    container: HTMLElement,
    delegate: IListDelegate<T>,
    renderers: IListRenderer<T, any>[],
    options: CollapsableListOptions<T>
  ) {
    const domNode = container.appendChild(tag('div', { className: 'list collapsible' }));
    const expanded = typeof options.expanded === 'undefined' ? true : options.expanded;
    domNode.classList.toggle('hidden', !expanded);

    const titleContainer = domNode.appendChild(tag('div', { className: 'tile light' }));
    const icon = tag('span', { className: `icon ${options.icon || 'indicator'}` });
    const text = tag('span', {
      className: 'text',
      textContent: typeof options.allCaps === 'undefined' ? title.toUpperCase() : options.allCaps ? title.toUpperCase() : title
    });
    titleContainer.append(icon, text);

    super(domNode, delegate, renderers, options);

    this._expanded = expanded;
    this.title = titleContainer;

    this.disposables.add(Event.fromDOMEvent(this.title, 'click')((e) => {
      if (!e.defaultPrevented) {
        this.setExpanded(!this.isExpanded());
      }
    }));
  }

  public isExpanded(): boolean {
    return this._expanded;
  }

  public setExpanded(expanded: boolean): boolean {
    if (this._expanded === !!expanded) {
      return false;
    }

    this.domNode.classList.toggle('hidden', !expanded);
    this._expanded = !!expanded;

    this._onDidChangeExpansionState.fire(expanded);
    return true;
  }
}
import { Disposable, DisposableStore, IDisposable } from "../base/disposable";
import { IResourceNode, ResourceTree } from "./resourceTree";
import { ISCMActionButton, ISCMInput, ISCMRepository, ISCMResource, ISCMResourceGroup, ISCMViewService } from "./types";

export function isSCMViewService(element: unknown): element is ISCMViewService {
	return Array.isArray((element as ISCMViewService).repositories) && Array.isArray((element as ISCMViewService).visibleRepositories);
}

export function isSCMRepository(element: unknown): element is ISCMRepository {
	return !!(element as ISCMRepository).provider && !!(element as ISCMRepository).input;
}

export function isSCMResourceGroup(element: unknown): element is ISCMResourceGroup {
	return !!(element as ISCMResourceGroup).provider && !!(element as ISCMResourceGroup).resources;
}

export function isSCMResource(element: unknown): element is ISCMResource {
	return !!(element as ISCMResource).sourceUri && isSCMResourceGroup((element as ISCMResource).resourceGroup);
}

export function isSCMResourceNode(element: unknown): element is IResourceNode<ISCMResource, ISCMResourceGroup> {
	return ResourceTree.isResourceNode(element) && isSCMResourceGroup(element.context);
}

export function isSCMInput(element: unknown): element is ISCMInput {
	return typeof (element as ISCMInput).placeholder === 'string' && typeof (element as ISCMInput).value === 'string';
}

export function isSCMActionButton(element: unknown): element is ISCMActionButton {
	return (element as ISCMActionButton).type === 'actionButton';
}

export function comparePaths(one: string, other: string): number {
	const oneParts = one.split('/');
	const otherParts = other.split('/');

	const lastOne = oneParts.length - 1;
	const lastOther = otherParts.length - 1;
	let endOne: boolean, endOther: boolean;

	for (let i = 0; ; i++) {
		endOne = lastOne === i;
		endOther = lastOther === i;

		if (endOne && endOther) {
			return oneParts[i].localeCompare(otherParts[i]);
		} else if (endOne) {
			return -1;
		} else if (endOther) {
			return 1;
		}

		if (oneParts[i] === otherParts[i]) {

		} else if (oneParts[i] < otherParts[i]) {
			return -1;
		} else {
			return 1;
		}
	}
}

export function binarySearch<T>(array: ReadonlyArray<T>, key: T, comparator: (op1: T, op2: T) => number): number {
	return binarySearch2(array.length, i => comparator(array[i], key));
}

function binarySearch2(length: number, compareToKey: (index: number) => number): number {
	let low = 0, high = length - 1;

	while (low <= high) {
		const mid = ((low + high) / 2) | 0;
		const comp = compareToKey(mid);
		if (comp < 0) {
			low = mid + 1;
		} else if (comp > 0) {
			high = mid - 1;
		} else {
			return mid;
		}
	}
	return -(low + 1);
}

export function disposableTimeout(handler: () => void, timeout = 0, store?: DisposableStore): IDisposable {
	const timer = setTimeout(() => {
		handler();
	}, timeout);
	const disposable = Disposable.toDisposable(() => {
		clearTimeout(timer);
		store?.delete(disposable);
	});
	store?.add(disposable);
	return disposable;
}

export function renderLabelWithIcon(text: string): Array<string | HTMLElement> {
	const result: Array<string | HTMLElement> = [];
	const iconRegex = /\$\(([^)]+)\)/g;
	let lastIndex = 0;

	let match;
	while ((match = iconRegex.exec(text)) !== null) {
		if (match.index > lastIndex) {
			result.push(text.slice(lastIndex, match.index));
		}

		const [iconName, ...modifiers] = match[1].split('~');

		const span = document.createElement('span');
		span.className = ['icon', iconName, ...modifiers].join(' ');
		result.push(span);

		lastIndex = iconRegex.lastIndex;
	}

	if (lastIndex < text.length) {
		result.push(text.slice(lastIndex));
	}

	return result;
}

export function renderLabelWithIcon2(text: string): string {
	return renderLabelWithIcon(text)
		.map(content =>
			content instanceof HTMLElement
				? `<span class="icon ${content.className}"></span>`
				: `<span class="text">${content}</span>`).join('');
}
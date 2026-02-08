import { decorationService, FileDecoration } from "./decorationService";
import { Disposable, DisposableStore, IDisposable } from "./disposable";
import { Event } from "./event";
import { uriToPath } from "./uri";

const sidebarApps = acode.require('sidebarApps');
const filesContainer = sidebarApps.get('files')!;

export function registerFilesDecorations(): IDisposable {
	const disposables = new DisposableStore();

	refresh();
	disposables.add(decorationService.onDidChangeDecorations(refresh));

	Event.fromEditorManager('new-file')(file => {
		if (file.tab instanceof HTMLElement) {
			file.tab.setAttribute("data-url", file.uri);
			applyDecoration(file.tab);
		}
	}, null, disposables);

	disposables.add(Disposable.toDisposable(() => {
		const filesElemets = filesContainer.querySelectorAll('.tile[data-url]');
		const fileTabElements = editorManager.openFileList.querySelectorAll(".tile[data-url]");

		[...filesElemets, ...fileTabElements]
			.forEach(element => clearDecoration(element as HTMLElement));
	}));

	return disposables;
}

function refresh() {
	const filesElemets = filesContainer.querySelectorAll('.tile[data-url]');
	const fileTabElements = editorManager.openFileList.querySelectorAll(".tile[data-url]");

	updateFileTabUrl();

	[...filesElemets, ...fileTabElements]
		.forEach(element => applyDecoration(element as HTMLElement));
}

function updateFileTabUrl(): void {
	editorManager.files
		.filter((file) => !!file.uri)
		.forEach((file) => {
			const fileTab = file.tab as unknown;
			if (fileTab instanceof HTMLElement) {
				fileTab.setAttribute("data-url", file.uri);
			}
		});
}

function applyDecoration(element: HTMLElement): void {
	const url = element.dataset.url;

	if (!url) {
		return;
	}

	const path = uriToPath(url);
	const decoration = decorationService.getDecoration(path);

	if (!decoration) {
		return;
	}

	if (decoration.propagate !== false) {
		renderFileDecoration(element, decoration);
	}
}

function renderFileDecoration(element: HTMLElement, decoration: FileDecoration): void {
	clearDecoration(element);

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

function clearDecoration(element: HTMLElement): void {
	const text = element.querySelector('.text') as HTMLElement;
	const badge = element.querySelector('.badge');

	if (text) {
		text.style.color = 'var(--primary-text-color)';
	}

	if (badge) {
		badge.remove();
	}
}
import { App } from "./app";
import { decorationService, FileDecoration } from "./decorationService";
import { DisposableStore } from "./disposable";
import { Event } from "./event";
import { uriToPath } from "./uri";

const sidebarApps = acode.require('sidebarApps');

interface FileTreeOptions {
	onExpandedChange: ((folderUrl: string, isExpanded: boolean) => void) | undefined;
	expandedState: { [key: string]: boolean } | undefined;
}

interface FileTree {
	readonly options: FileTreeOptions;
	findElement(url: string): HTMLElement | null;
}

export class FileTreeDecoration {

	private readonly filesContainer: HTMLElement;
	private readonly disposables = new DisposableStore();

	constructor() {
		this.filesContainer = sidebarApps.get('files')!
		decorationService.onDidChangeDecorations(this.refresh, this, this.disposables);
		App.onDidChangeWorkspaceFolder(this.refresh, this, this.disposables);
		Event.fromEditorManager('new-file')(file => {
			if (file.tab instanceof HTMLElement) {
				file.tab.setAttribute("data-url", file.uri);
				applyDecoration(file.tab);
			}
		}, null, this.disposables);
		this.refresh();
	}

	private refresh(): void {
		const roots = Array.from(this.filesContainer.querySelectorAll('[data-type="root"]')) as Acode.Collapsible[];
		for (const root of roots) {
			this.updateRootOnToggle(root);
		}

		this.updateFileTabDecorations();
	}

	private updateRootOnToggle(root: Acode.Collapsible): void {
		const ontoggle = root.ontoggle as any;
		root.ontoggle = async () => {
			if (typeof ontoggle !== 'function') {
				return;
			}

			await ontoggle();
			this.updateRoot(root);
		}

		this.updateRoot(root);
	}

	private updateRoot(root: Acode.Collapsible): void {
		if (!root.unclasped) {
			return;
		}

		const fileTree = (root.$ul as unknown as { _fileTree: FileTree | undefined })._fileTree;

		if (!fileTree) {
			return;
		}

		this.updateFileTreeExpandedChange(fileTree);
		this.applyDecorations(root.parentElement!);
	}

	private updateFileTreeExpandedChange(fileTree: FileTree): void {
		const onExpandedChange = fileTree.options.onExpandedChange;
		fileTree.options.onExpandedChange = (folderUrl: string, isExpanded: boolean) => {
			onExpandedChange?.(folderUrl, isExpanded);
			const folderElement = fileTree.findElement(folderUrl);
			if (!folderElement || !folderElement.parentElement) {
				return;
			}

			this.applyDecorations(folderElement.parentElement);
		}
	}

	private updateFileTabDecorations(): void {
		updateFileTabUrl();
		this.applyDecorations(editorManager.openFileList);
	}

	private applyDecorations(node: HTMLElement): void {
		const elements = Array.from(node.querySelectorAll('.tile[data-url]'));
		for (const element of elements) {
			applyDecoration(element as HTMLElement);
		}
	}

	dispose(): void {
		this.disposables.dispose();
	}
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
		clearDecoration(element);
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
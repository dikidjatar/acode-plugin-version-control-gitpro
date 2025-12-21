export interface IResourceNode<T, C> {
	readonly name: string;
	readonly uri: string;
	readonly context: C;
	readonly parent?: IResourceNode<T, C>;
	readonly children: IterableIterator<IResourceNode<T, C>>;
	readonly childrenCount: number;
	readonly element?: T;
}

class ResourceNode<T, C> implements IResourceNode<T, C> {
	private _children = new Map<string, ResourceNode<T, C>>();
	public element?: T;

	constructor(
		public readonly name: string,
		public readonly uri: string,
		public readonly context: C,
		public readonly parent?: ResourceNode<T, C>
	) { }

	get children(): IterableIterator<ResourceNode<T, C>> {
		return this._children.values();
	}

	get childrenCount(): number {
		return this._children.size;
	}

	get(name: string): ResourceNode<T, C> | undefined {
		return this._children.get(name);
	}

	set(name: string, node: ResourceNode<T, C>): void {
		this._children.set(name, node);
	}
}

export class ResourceTree<T, C> {
	readonly root: ResourceNode<T, C>;

	constructor(context: C, rootUri: string) {
		this.root = new ResourceNode('', rootUri, context);
	}

	add(uri: string, element: T): void {
		const relativePath = this.getRelativePath(uri);
		const parts = relativePath.split('/').filter(p => p.length > 0);

		let currentNode = this.root;
		let currentUri = this.root.uri;

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			currentUri += (currentUri.endsWith('/') ? '' : '/') + part;

			let child = currentNode.get(part);
			if (!child) {
				child = new ResourceNode(part, currentUri, this.root.context, currentNode);
				currentNode.set(part, child);
			}

			currentNode = child;
		}

		currentNode.element = element;
	}

	getNode(uri: string): IResourceNode<T, C> | undefined {
		const relativePath = this.getRelativePath(uri);
		if (!relativePath) return this.root;

		const parts = relativePath.split('/').filter(p => p.length > 0);
		let currentNode: ResourceNode<T, C> | undefined = this.root;

		for (const part of parts) {
			currentNode = currentNode?.get(part);
			if (!currentNode) return undefined;
		}

		return currentNode;
	}

	private getRelativePath(uri: string): string {
		const rootUri = this.root.uri.endsWith('/') ? this.root.uri : this.root.uri + '/';
		if (uri.startsWith(rootUri)) {
			return uri.substring(rootUri.length);
		}
		return uri === this.root.uri ? '' : uri;
	}

	static isResourceNode<T, C>(obj: any): obj is IResourceNode<T, C> {
		return obj && typeof obj.childrenCount === 'number' && typeof obj.uri === 'string';
	}
}
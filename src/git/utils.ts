import { config } from '../base/config';
import { Emitter, Event } from '../base/event';
import { toFileUrl } from '../base/uri';

const ACODE_TERMINAL_FILES = `/data/user/0/${window.BuildInfo.packageName}/files`;

const Url = acode.require('Url');
const fs = acode.require('fs');

export type Mutable<T> = {
	-readonly [P in keyof T]: T[P]
};

export function assign<T>(destination: T, ...sources: any[]): T {
	for (const source of sources) {
		Object.keys(source).forEach(key =>
			(destination as Record<string, unknown>)[key] = source[key]);
	}

	return destination;
}

export namespace Versions {
	declare type VersionComparisonResult = -1 | 0 | 1;

	export interface Version {
		major: number;
		minor: number;
		patch: number;
		pre?: string;
	}

	export function compare(v1: string | Version, v2: string | Version): VersionComparisonResult {
		if (typeof v1 === 'string') {
			v1 = fromString(v1);
		}
		if (typeof v2 === 'string') {
			v2 = fromString(v2);
		}

		if (v1.major > v2.major) { return 1; }
		if (v1.major < v2.major) { return -1; }

		if (v1.minor > v2.minor) { return 1; }
		if (v1.minor < v2.minor) { return -1; }

		if (v1.patch > v2.patch) { return 1; }
		if (v1.patch < v2.patch) { return -1; }

		if (v1.pre === undefined && v2.pre !== undefined) { return 1; }
		if (v1.pre !== undefined && v2.pre === undefined) { return -1; }

		if (v1.pre !== undefined && v2.pre !== undefined) {
			return v1.pre.localeCompare(v2.pre) as VersionComparisonResult;
		}

		return 0;
	}

	export function from(major: string | number, minor: string | number, patch?: string | number, pre?: string): Version {
		return {
			major: typeof major === 'string' ? parseInt(major, 10) : major,
			minor: typeof minor === 'string' ? parseInt(minor, 10) : minor,
			patch: patch === undefined || patch === null ? 0 : typeof patch === 'string' ? parseInt(patch, 10) : patch,
			pre: pre,
		};
	}

	export function fromString(version: string): Version {
		const [ver, pre] = version.split('-');
		const [major, minor, patch] = ver.split('.');
		return from(major, minor, patch, pre);
	}
}

export function isAbsolute(path: string): boolean {
	return path.charCodeAt(0) === 47;
}

function normalizePath(path: string): string {
	if (/[/\\]$/.test(path)) {
		path = path.substring(0, path.length - 1);
	}

	return path;
}

export function pathEquals(a: string, b: string): boolean {
	return normalizePath(a) === normalizePath(b);
}


export function relativePath(from: string, to: string): string {
	if (from.charAt(from.length - 1) !== '/') {
		from += '/';
	}

	if (isDescendant(from, to) && from.length < to.length) {
		return to.substring(from.length);
	}

	return '';
}

export function isDescendant(parent: string, descendant: string): boolean {
	if (parent === descendant) {
		return true;
	}

	parent = normalizePath(parent);
	descendant = normalizePath(descendant);

	// Ensure parent ends with separator
	if (parent.charAt(parent.length - 1) !== '/') {
		parent += '/';
	}

	return descendant.startsWith(parent);
}

export function joinUrl(...pathnames: string[]) {
	let url = Url.join(...pathnames);

	if (url.startsWith(`content://${window.BuildInfo.packageName}.documents/tree/`)) {
		const parts = url.split('::');
		if (parts.length > 1) {
			// Remove ':' if followed by ':/'
			url = parts[0] + '::' + parts[1].replace(':/', '/');
		}
	}

	return url;
}

export function toFullPath(path: string): string {
	if (path.startsWith('/home')) {
		return ACODE_TERMINAL_FILES + '/alpine' + path;
	} else if (path.startsWith('/public')) {
		return ACODE_TERMINAL_FILES + path;
	}
	return path;
}

export function toShortPath(path: string): string {
	if (path.startsWith(ACODE_TERMINAL_FILES + '/alpine/home/')) {
		return path.slice((ACODE_TERMINAL_FILES + '/alpine').length);
	} else if (path.startsWith(ACODE_TERMINAL_FILES + '/public')) {
		return path.slice(ACODE_TERMINAL_FILES.length);
	}
	return path;
}

export function groupBy<T>(arr: T[], fn: (el: T) => string): { [key: string]: T[] } {
	return arr.reduce((result, el) => {
		const key = fn(el);
		result[key] = [...(result[key] || []), el];
		return result;
	}, Object.create(null));
}

export function find<T>(array: T[], fn: (t: T) => boolean): T | undefined {
	let result: T | undefined = undefined;

	array.some(e => {
		if (fn(e)) {
			result = e;
			return true;
		}

		return false;
	});

	return result;
}

export async function grep(filename: string, pattern: RegExp): Promise<boolean> {
	const text = await fs(toFileUrl(filename)).readFile('utf-8');
	return pattern.test(text);
}

type Completion<T> = { success: true; value: T } | { success: false; err: any };

export class PromiseSource<T> {

	private _onDidComplete = new Emitter<Completion<T>>();

	private _promise: Promise<T> | undefined;
	get promise(): Promise<T> {
		if (this._promise) {
			return this._promise;
		}

		return Event.toPromise(this._onDidComplete.event).then(completion => {
			if (completion.success) {
				return completion.value;
			} else {
				throw completion.err;
			}
		});
	}

	resolve(value: T): void {
		if (!this._promise) {
			this._promise = Promise.resolve(value);
			this._onDidComplete.fire({ success: true, value });
		}
	}

	reject(err: any): void {
		if (!this._promise) {
			this._promise = Promise.reject(err);
			this._onDidComplete.fire({ success: false, err });
		}
	}
}

export function* splitInChunks(array: string[], maxChunkLength: number): IterableIterator<string[]> {
	let current: string[] = [];
	let length = 0;

	for (const value of array) {
		let newLength = length + value.length;

		if (newLength > maxChunkLength && current.length > 0) {
			yield current;
			current = [];
			newLength = value.length;
		}

		current.push(value);
		length = newLength;
	}

	if (current.length > 0) {
		yield current;
	}
}

export function getCommitShortHash(hash: string): string {
	const gitConfig = config.get('vcgit')!;
	const shortHashLength = gitConfig.commitShortHashLength || 7;
	return hash.substring(0, shortHashLength);
}

export function getModeForFile(filename: string) {
	const { getModeForPath } = ace.require('ace/ext/modelist');
	const { name } = getModeForPath(filename);
	return `ace/mode/${name}`;
}

interface ILimitedTaskFactory<T> {
	factory: () => Promise<T>;
	c: (value: T | Promise<T>) => void;
	e: (error?: any) => void;
}

export class Limiter<T> {

	private runningPromises: number;
	private maxDegreeOfParalellism: number;
	private outstandingPromises: ILimitedTaskFactory<T>[];

	constructor(maxDegreeOfParalellism: number) {
		this.maxDegreeOfParalellism = maxDegreeOfParalellism;
		this.outstandingPromises = [];
		this.runningPromises = 0;
	}

	queue(factory: () => Promise<T>): Promise<T> {
		return new Promise<T>((c, e) => {
			this.outstandingPromises.push({ factory, c, e });
			this.consume();
		});
	}

	private consume(): void {
		while (this.outstandingPromises.length && this.runningPromises < this.maxDegreeOfParalellism) {
			const iLimitedTask = this.outstandingPromises.shift()!;
			this.runningPromises++;

			const promise = iLimitedTask.factory();
			promise.then(iLimitedTask.c, iLimitedTask.e);
			promise.then(() => this.consumed(), () => this.consumed());
		}
	}

	private consumed(): void {
		this.runningPromises--;

		if (this.outstandingPromises.length > 0) {
			this.consume();
		}
	}
}

const minute = 60;
const hour = minute * 60;
const day = hour * 24;
const week = day * 7;
const month = day * 30;
const year = day * 365;

export function fromNow(date: number | Date, appendAgoLabel?: boolean, useFullTimeWords?: boolean, disallowNow?: boolean): string {
	if (typeof date !== 'number') {
		date = date.getTime();
	}

	const seconds = Math.round((new Date().getTime() - date) / 1000);
	if (seconds < -30) {
		return `in ${fromNow(new Date().getTime() + seconds * 1000, false)}`;
	}

	if (!disallowNow && seconds < 30) {
		return 'now';
	}

	let value: number;
	if (seconds < minute) {
		value = seconds;

		if (appendAgoLabel) {
			if (value === 1) {
				return useFullTimeWords
					? `${value} second ago`
					: `${value} sec ago`;
			} else {
				return useFullTimeWords
					? `${value} seconds ago`
					: `${value} secs ago`;
			}
		} else {
			if (value === 1) {
				return useFullTimeWords
					? `${value} second`
					: `${value} sec`;
			} else {
				return useFullTimeWords
					? `${value} seconds`
					: `${value} secs`;
			}
		}
	}

	if (seconds < hour) {
		value = Math.floor(seconds / minute);
		if (appendAgoLabel) {
			if (value === 1) {
				return useFullTimeWords
					? `${value} minute ago`
					: `${value} min ago`;
			} else {
				return useFullTimeWords
					? `${value} minutes ago`
					: `${value} mins ago`;
			}
		} else {
			if (value === 1) {
				return useFullTimeWords
					? `${value} minute`
					: `${value} min`;
			} else {
				return useFullTimeWords
					? `${value} minutes`
					: `${value} mins`;
			}
		}
	}

	if (seconds < day) {
		value = Math.floor(seconds / hour);
		if (appendAgoLabel) {
			if (value === 1) {
				return useFullTimeWords
					? `${value} hour ago`
					: `${value} hr ago`;
			} else {
				return useFullTimeWords
					? `${value} hours ago`
					: `${value} hrs ago`;
			}
		} else {
			if (value === 1) {
				return useFullTimeWords
					? `${value} hour`
					: `${value} hr`;
			} else {
				return useFullTimeWords
					? `${value} hours`
					: `${value} hrs`;
			}
		}
	}

	if (seconds < week) {
		value = Math.floor(seconds / day);
		if (appendAgoLabel) {
			return value === 1
				? `${value} day ago`
				: `${value} days ago`;
		} else {
			return value === 1
				? `${value} day`
				: `${value} days`;
		}
	}

	if (seconds < month) {
		value = Math.floor(seconds / week);
		if (appendAgoLabel) {
			if (value === 1) {
				return useFullTimeWords
					? `${value} week ago`
					: `${value} wk ago`;
			} else {
				return useFullTimeWords
					? `${value} weeks ago`
					: `${value} wks ago`;
			}
		} else {
			if (value === 1) {
				return useFullTimeWords
					? `${value} week`
					: `${value} wk`;
			} else {
				return useFullTimeWords
					? `${value} weeks`
					: `${value} wks`;
			}
		}
	}

	if (seconds < year) {
		value = Math.floor(seconds / month);
		if (appendAgoLabel) {
			if (value === 1) {
				return useFullTimeWords
					? `${value} month ago`
					: `${value} mo ago`;
			} else {
				return useFullTimeWords
					? `${value} months ago`
					: `${value} mos ago`;
			}
		} else {
			if (value === 1) {
				return useFullTimeWords
					? `${value} month`
					: `${value} mo`;
			} else {
				return useFullTimeWords
					? `${value} months`
					: `${value} mos`;
			}
		}
	}

	value = Math.floor(seconds / year);
	if (appendAgoLabel) {
		if (value === 1) {
			return useFullTimeWords
				? `${value} year ago`
				: `${value} yr ago`;
		} else {
			return useFullTimeWords
				? `${value} years ago`
				: `${value} yrs ago`;
		}
	} else {
		if (value === 1) {
			return useFullTimeWords
				? `${value} year`
				: `${value} yr`;
		} else {
			return useFullTimeWords
				? `${value} years`
				: `${value} yrs`;
		}
	}
}
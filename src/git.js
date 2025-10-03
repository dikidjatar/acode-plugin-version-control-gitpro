// Copyright (c) [2025] [Diki Djatar]
// SPDX-License-Identifier: MIT

import { STATUS_MAP } from "./constants.js";
import BaseError, {
	GitError,
	InvalidResponse,
	NoRemotesConfigured,
	RemoteNotFound,
	ServerUnreachable,
	StagedDiffersFromHead,
	WebSocketError
} from "./errors.js";
import settings from "./settings.js";
import { runWorkers } from "./utils.js";

class GitService {
	#serverUrl;
	/** @type {string | null} */
	#repoDir = null;

	constructor(serverUrl) {
		this.#serverUrl = serverUrl;
	}

	updateServerUrl(url) {
		this.#serverUrl = url;
	}

	setRepoDir(dir) {
		this.#repoDir = dir;
	}

	getRepoDir() { return this.#repoDir; }

	async get(endpoint) {
		return this.#request(endpoint, { method: 'GET' });
	}

	async post(endpoint, data = {}) {
		return this.#request(endpoint, { body: data, method: 'POST' });
	}

	async #request(endpoint, options = {}) {
		try {
			const response = await this.#executeRequest(endpoint, options);
			return await this.#handleResponse(response);
		} catch (err) {
			if (err instanceof BaseError) throw err;
			const unreachable = new ServerUnreachable(this.#serverUrl);
			unreachable.setOriginalError(err);
			throw unreachable;
		}
	}

	async #executeRequest(endpoint, options) {
		const urlPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
		const url = `${this.#serverUrl}/git${urlPath}`;
		const method = (options.method || 'GET').toUpperCase();

		const fetchOpts = {
			method,
			headers: { ...(options.headers || {}) }
		};

		if (method === 'POST') {
			const body = options.body || {};
			if (!body.dir && this.#repoDir) {
				body.dir = this.#repoDir;
			} else if (!body.dir && !this.#repoDir) {
				throw new GitError(null, 'Repository directory is not set');
			}
			fetchOpts.headers['Content-Type'] = 'application/json';
			fetchOpts.body = JSON.stringify(body);
		}

		return await fetch(url, fetchOpts);
	}

	async #handleResponse(response) {
		if (!response.ok) {
			const error = await this.#parseErrorResponse(response);
			throw new GitError(error.code, error.message, error)
		}
		let payload;
		try {
			payload = await response.json();
			if (!payload) {
				throw new InvalidResponse('Empty response payload');
			}
		} catch (error) {
			throw new InvalidResponse('Invalid json response from server');
		}

		if (payload && payload.error) {
			let error = payload.error;
			if (typeof payload.error === 'string') {
				error = { message: error };
			}
			throw new GitError(error.code, error.message, error);
		}

		return payload.data;
	}

	async #parseErrorResponse(response) {
		try {
			return await response.json();
		} catch {
			try {
				return { message: await response.text() };
			} catch {
				return { message: `HTTP error ${response.status}` };
			}
		}
	}

	async #ws(op, opts = {}) {
		const ws = new WebSocketManager(this.#serverUrl, this.#repoDir);
		return ws.execute(op, opts);
	}

	async isRepo() {
		return await this.get(`/status?dir=${this.#repoDir}`);
	}

	async init(opts = {}) {
		await this.post('/init', opts)
	}

	async status({ split = false, ...opts } = {}) {
		const matrix = await this.statusMatrix({ ...opts });

		const files = [];
		const stagedFiles = [];
		const unstagedFiles = [];
		let stagedCount = 0;
		let unstagedCount = 0;
		let totalCount = 0;

		for (let i = 0; i < matrix.length; i++) {
			const row = matrix[i];
			const filepath = row[0];
			const head = Number(row[1]);
			const workdir = Number(row[2]);
			const stage = Number(row[3]);

			if (head === 1 && workdir === 1 && stage === 1) {
				continue;
			}

			const key = `${head}-${workdir}-${stage}`;
			let statusInfo = STATUS_MAP.get(key);

			if (!statusInfo) continue;

			const isStaged = statusInfo.isStaged;
			const isUnstaged = statusInfo.isUnstaged;

			const fileObj = {
				filepath,
				key,
				symbol: statusInfo.symbol,
				desc: statusInfo.desc,
				isStaged,
				isUnstaged,
				isIgnored: false,
				raw: { head, workdir, stage }
			};

			if (split) {
				if (fileObj.isStaged) {
					stagedFiles.push(fileObj);
				}
				if (fileObj.isUnstaged) {
					unstagedFiles.push(fileObj);
				}
			} else {
				files.push(fileObj);
			}

			if (fileObj.isStaged) stagedCount++;
			if (fileObj.isUnstaged) unstagedCount++;
			totalCount++;
		}

		let branchSymbol = '';
		if (stagedCount > 0 && unstagedCount > 0) {
			branchSymbol = '*+';
		} else if (stagedCount > 0) {
			branchSymbol = '+';
		} else if (unstagedCount > 0) {
			branchSymbol = '*';
		}

		return split ? {
			staged: stagedFiles,
			unstaged: unstagedFiles,
			branchSymbol,
			totalCount,
			stagedCount,
			unstagedCount
		} : {
			files,
			branchSymbol,
			totalCount,
			stagedCount,
			unstagedCount
		};
	}

	/**
	 * @returns {Promise<StatusRow[]>}
	 */
	async statusMatrix(opts = {}) {
		return await this.post('/statusMatrix', opts);
	}

	/**
	 * Get current branch
	 * @returns {Promise<string>}
	 */
	async branch() {
		return await this.post('/currentBranch');
	}

	/**
	 * @returns {Promise<Array<string>>}
	 */
	async listBranches(remote = undefined) {
		return await this.post('/listBranches', { remote });
	}

	async createBranch(branch) {
		await this.post('/createBranch', { ref: branch })
	}

	async deleteBranch(branch) {
		await this.post('/deleteBranch', { ref: branch })
	}

	async renameBranch(oldBranch, newBranch) {
		await this.post('/renameBranch', { oldref: oldBranch, ref: newBranch });
	}

	async branchUpstream(branch) {
		// Read config: branch.<branch>.remote and branch.<branch>.merge
		// e.g. branch.main.remote = origin
		//      branch.main.merge = refs/heads/main
		const remote = await this.getConfig(`branch.${branch}.remote`).catch(() => undefined);
		const merge = await this.getConfig(`branch.${branch}.merge`).catch(() => undefined);
		const remoteRef = merge ? merge.replace(/^refs\/heads\//, '') : undefined;
		return { remote, remoteRef };
	}

	async setBranchUpstream(branch, { remote, remoteRef } = {}) {
		await this.setConfig(`branch.${branch}.remote`, remote);
		await this.setConfig(`branch.${branch}.merge`, `refs/heads/${remoteRef}`);
	}

	async add(filepath) {
		await this.post('/add', { filepath })
	}

	async addAll({
		ref = 'HEAD',
		filepaths = ['.'],
		ignored = false,
		concurrency = 100,
		...opts
	} = {}) {
		const FILE = 0, HEAD = 1, WORKDIR = 2, STAGE = 3;
		const matrix = await this.statusMatrix({ ref, filepaths, ignored, ...opts });

		const rows = matrix.filter((r) => {
			const fp = String(r[FILE]);
			if (!fp || fp === '.' || fp === '') return false;
			if (fp === '.git' || fp.startsWith('.git/')) return false;
			return r[WORKDIR] !== r[STAGE];
		});

		const worker = async (index) => {
			const [filepath, , workdirVal] = rows[index];
			const isDeletedInWorkdir = Number(workdirVal) === 0;

			try {
				if (isDeletedInWorkdir) {
					await this.remove(filepath);
				} else {
					await this.add(filepath);
				}
			} catch (error) { }
		};

		await runWorkers(rows.length, worker, concurrency);
	}

	async remove(filepath) {
		await this.post('/remove', { filepath })
	}

	async resetIndex(filepath, ref = 'HEAD') {
		await this.post('/resetIndex', { filepath, ref });
	}

	async updateIndex(opts = {}) {
		return await this.post('/updateIndex', opts)
	}

	async checkout(opts = {}) {
		return this.#ws('checkout', opts)
	}

	/**
	 * @returns {Promise<string>}
	 */
	async commit(opts = {}) {
		return await this.post('/commit', opts);
	}

	async clone(opts) {
		await this.#ws('clone', opts);
	}

	async push(opts = {}) {
		return await this.#ws('push', opts);
	}

	async pull(opts = {}) {
		return await this.#ws('pull', opts);
	}

	async fetch(opts = {}) {
		return await this.#ws('fetch', opts);
	}

	/**
	 * @returns {Promise<Array<{remote: string, url: string}>>}
	 */
	async listRemotes() {
		return await this.post('/listRemotes');
	}

	async addRemote(remote, url) {
		await this.post('/addRemote', { remote, url });
	}

	async deleteRemote(remote) {
		await this.post('/deleteRemote', { remote })
	}

	async hasRemote() {
		const remotes = await this.listRemotes();
		return remotes.length > 0;
	}

	async getRemoteInfo(remoteName) {
		const remotes = await this.listRemotes();
		const remote = remotes.find(r => r.remote === remoteName);

		if (!remote) {
			const availableRemotes = remotes.map(r => r.remote);
			if (availableRemotes.length > 0) {
				throw new RemoteNotFound(remoteName, availableRemotes);
			} else {
				throw new NoRemotesConfigured();
			}
		}

		return remote;
	}

	/**
	 * Get config from .git/config
	 * @param {string} path 
	 * @returns {Promise<string | undefined>}
	 */
	async getConfig(path) {
		return await this.post('/getConfig', { path });
	}

	async setConfig(path, value) {
		await this.post('/setConfig', { path, value });
	}

	async hasHEAD() {
		try {
			await this.post('/resolveRef', { ref: 'HEAD' });
			return true;
		} catch (e) {
			return false;
		}
	}

	/**
	 * @returns {Promise<string>}
	 */
	async resolveRef(opts = {}) {
		return this.post('/resolveRef', opts);
	}

	/**
	 * @returns {Promise<string}>}
	 */
	async readFile(opts = {}) {
		return await this.post('/readFile', opts);
	}

	/**
	 * @returns {Promise<CollectOidsResult>}
	 */
	async collectOids(filepaths, ref = 'HEAD') {
		return this.post('/collectOids', { ref, prefixes: filepaths });
	}

	async discardFiles(filepaths) {
		await this.post('/discardFiles', { filepaths });
	}

	async rmCached(filepaths) {
		const hasHead = await this.hasHEAD();
		const oids = await this.collectOids(filepaths);

		const oidEntries = Object.entries(oids);
		const diffFiles = oidEntries.filter(([, o]) => this.hasStagedDiffersFromHead(o));
		if (diffFiles.length > 0) {
			throw new StagedDiffersFromHead(diffFiles.map(([fp]) => fp));
		}

		if (hasHead) {
			const stagedFiles = oidEntries
				.filter(([, v]) => v.stageOid || v.headOid)
				.map(([k]) => k);
			await Promise.all(stagedFiles.map(fp => this.resetIndex(fp, 'HEAD')));
		} else {
			await Promise.all(
				Object.keys(oids).map(fp => this.remove(fp))
			);
		}
	}

	hasStagedDiffersFromHead(oids) {
		const { headOid, workdirOid, stageOid } = oids;
		if (!stageOid) return false;
		if (stageOid === headOid || stageOid === workdirOid) {
			return false;
		}
		return true;
	}


	/**
	 * @param {StatusRow} row
	 */
	getStatusRow(row) {
		const [, head, workdir, stage] = row;
		const status = STATUS_MAP.get(`${head}-${workdir}-${stage}`);
		return status;
	}

	isUntracked(row) {
		const [, head, work, stage] = row;
		return head === 0 && work === 2 && stage === 0;
	}

	isHEAD(row) { return row[1] !== row[3] }

	isModifiedUnstaged(row) {
		const status = this.getStatusRow(row);
		return status.symbol === 'M' && status.isUnstaged;
	}

	isDeletedUnstaged(row) {
		const status = this.getStatusRow(row);
		return status.symbol === 'D' && status.isUnstaged;
	}
}

/**
 * WebSocketManager - Handles WebSocket for git operations
 */
class WebSocketManager {
	constructor(serverUrl, repoDir) {
		this.serverUrl = serverUrl;
		this.repoDir = repoDir;
		this.ws = null;
		this.isCompleted = false;
	}

	async execute(operation, opts = {}) {
		return new Promise((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
			this.operation = operation;
			this.opts = opts;
			this.connect(operation);
		});
	}

	connect(operation) {
		const wsUrl = this.getWsUrl(operation);

		try {
			this.ws = new WebSocket(wsUrl);
			this.ws.onerror = (error) => this.handleError(error);
			this.ws.onclose = (event) => this.handleClose(event);
			this.ws.onopen = () => this.handleOpen();
			this.ws.onmessage = (event) => this.handleMessage(event);
		} catch (err) {
			this.complete(new WebSocketError(
				'Failed to initialize WebSocket connection',
				{ url: wsUrl, originalError: err.message }
			));
		}
	}

	getWsUrl(operation = this.operation) {
		const wsProtocol = this.serverUrl.startsWith('https') ? 'wss' : 'ws';
		const baseUrl = this.serverUrl.replace(/^https?/, wsProtocol);
		return `${baseUrl}/git/${operation}`;
	}

	handleError(error) {
		if (!this.isCompleted) {
			this.complete(new WebSocketError(
				`WebSocket error during ${this.operation}`,
				{ url: this.getWsUrl(), originalError: error }
			));
		}
	}

	handleClose(event) {
		if (!this.isCompleted && !event.wasClean) {
			this.complete(new WebSocketError(
				`WebSocket closed unexpectedly during ${this.operation}`,
				{ url: this.getWsUrl(), code: event.code, reason: event.reason }
			));
		}
	}

	handleOpen() {
		const payload = { ...this.opts };
		if (!payload.dir && this.repoDir) {
			payload.dir = this.repoDir;
		}

		this.ws.send(JSON.stringify({
			event: `${this.operation}:start`,
			payload
		}));
	}

	async handleMessage(messageEvent) {
		try {
			const message = JSON.parse(messageEvent.data);
			const { event, data, error } = message;

			const handler = this.getEventHandler(event);
			if (handler) {
				await handler.call(this, data, error);
			}
		} catch (err) {
			if (!this.isCompleted) {
				this.complete(new WebSocketError(
					'Failed to parse WebSocket message',
					{ url: this.getWsUrl(), originalError: err.message }
				));
			}
		}
	}

	getEventHandler(event) {
		const handlers = {
			[`${this.operation}:progress`]: this.handleProgress,
			[`${this.operation}:message`]: this.handleStatusMessage,
			[`${this.operation}:auth`]: this.handleAuth,
			[`${this.operation}:done`]: this.handleDone
		};
		return handlers[event];
	}

	handleProgress(data) {
		if (this.opts.onProgress) {
			this.opts.onProgress(data);
		}
	}

	handleStatusMessage(data) {
		if (this.opts.onMessage) {
			this.opts.onMessage(data.message);
		}
	}

	async handleAuth(data) {
		let credentials = {};

		if (this.opts.onAuth) {
			try {
				credentials = await this.opts.onAuth(data.url, data.auth);
			} catch (authError) {
				console.log('AuthError', authError);
			}
		}

		this.ws.send(JSON.stringify(credentials));
	}

	handleDone(data, error) {
		if (error) {
			if (typeof error === 'string') error = { message: error };
			this.complete(new GitError(
				error.code || 'GIT_OPERATION_FAILED',
				error.message || `Git ${this.operation} failed`,
				{ ...error, operation: this.operation }
			));
		} else {
			this.complete(null, data);
		}
	}

	complete(error, data) {
		if (this.isCompleted) return;

		this.isCompleted = true;
		this.cleanup();

		if (error) {
			this.reject(error);
		} else {
			this.resolve(data);
		}
	}

	cleanup() {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.close();
		}

		this.ws = null;
	}
}

const git = new GitService(`http://localhost:${settings.serverPort}`);
export default git;
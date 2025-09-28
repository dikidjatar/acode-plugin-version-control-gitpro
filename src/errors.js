export default class BaseError extends Error {
  constructor(message) {
    super(message);
  }

  setOriginalError(error) {
    this.originalError = error;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      data: this.data,
      originalError: this.originalError,
      stack: this.stack
    }
  }

  get isGitError() { return true; }
}

export class InvalidUri extends BaseError {
  constructor(uri) {
    super(`Invalid URI: ${uri}`);
    this.code = this.name = InvalidUri.code;
    this.data = { uri };
  }
}
InvalidUri.code = 'InvalidUri';

export class UriNotAllowed extends BaseError {
  constructor(uri) {
    super(`Cannot perform git operations in ${uri}`);
    this.code = this.name = UriNotAllowed.code;
    this.data = { uri };
  }
}
UriNotAllowed.code = 'UriNotAllowed';

export class UnsupportedUri extends BaseError {
  constructor(uri) {
    super(`Unsupported URI: ${uri}`);
    this.code = this.name = UnsupportedUri.code;
    this.data = { uri };
  }
}
UnsupportedUri.code = 'UnsupportedUri';

export class GitError extends BaseError {
  constructor(code, message, data) {
    super(message);
    this.code = code || (this.name = GitError.name);
    this.data = data;
  }
}
GitError.code = 'IsoGitError';

export class InternalError extends BaseError {
  constructor(message) {
    super(`An internal error. Please file a bug report at https://github.com/dikidjatar/acode-plugin-version-control-pro/issues with this error message: ${message}`);
    this.code = this.name = InternalError.code;
    this.data = { message };
  }
}
InternalError.code = 'InternalError';

export class ServerUnreachable extends BaseError {
  constructor(serverUrl) {
    super(`Failed connect to server at ${serverUrl}. Please ensure the server is running on Termux or Acode Terminal and that host/port are correct. Example: verify the Termux or Acode Terminal git server process and the network accessibility (host/port).`);
    this.code = this.name = ServerUnreachable.code;
    this.data = { serverUrl };
  }
}
ServerUnreachable.code = 'ServerUnreachable';

export class TimeoutError extends BaseError {
  constructor(serverUrl, duration) {
    super(`Request '${serverUrl}' timeout after ${duration}ms`);
    this.code = this.name = TimeoutError.code;
    this.data = { duration, serverUrl };
  }
}
TimeoutError.code = 'TimeoutError';

export class WebSocketError extends BaseError {
  constructor(message, data) {
    super(message);
    this.code = this.name = WebSocketError.code;
    if (data.originalError) {
      this.setOriginalError(data.originalError);
    }
    this.data = data;
  }
}
WebSocketError.code = 'WebSocketError';

export class StagedDiffersFromHead extends BaseError {
  /**
   * @param {Array<string>} filepaths 
   */
  constructor(filepaths) {
    super(`The following file has staged content different from both the file and the HEAD: ${filepaths.join(', ')}`);
    this.code = this.name = StagedDiffersFromHead.code;
    this.data = { filepaths };
  }
}
StagedDiffersFromHead.code = 'StagedDiffersFromHead';

export class NoRemotesConfigured extends BaseError {
  constructor(from) {
    let message = 'Your repository has no remotes';
    if (from) {
      message += ` configured to ${from}`;
    }
    super(message + '.');
    this.code = this.name = NoRemotesConfigured.code;
    this.data = { from };
  }
}
NoRemotesConfigured.code = 'NoRemotesConfigured';

export class RemoteNotFound extends BaseError {
  /**
   * 
   * @param {string} remote 
   * @param {Array<string>} availableRemotes 
   */
  constructor(remote, availableRemotes = []) {
    super(`Remote '${remote}' not found. Available remotes: ${availableRemotes.join(', ')}`);
    this.code = this.name = RemoteNotFound.code;
    this.data = { remote, availableRemotes };
  }
}
RemoteNotFound.code = 'RemoteNotFound';

export class MissingRemoteUrl extends BaseError {
  constructor(remote) {
    super(`Remote "${remote}" has no known URL`);
    this.code = this.name = MissingRemoteUrl.code;
    this.data = { remote };
  }
}
MissingRemoteUrl.code = 'MissingRemoteUrl';

export class RepositoryNotFound extends BaseError {
  constructor(dir) {
    super(`The folder currently open doesn't have a Git repository. You can initialize a repository which will enable source control features.`);
    this.code = this.name = RepositoryNotFound.code;
    this.data = { dir };
  }
}
RepositoryNotFound.code = 'RepositoryNotFound';

export class NoFolderSelected extends BaseError {
  constructor() {
    super('No folder is currently selected.');
    this.code = this.name = NoFolderSelected.code;
  }
}
NoFolderSelected.code = 'NoFolderSelected';

export class MultipleFolderSelected extends BaseError {
  /**
   * 
   * @param {Array<string>} folders
   */
  constructor(folders = []) {
    super(`Multiple folders selected: ${folders.join(', ')}`);
    this.code = this.name = MultipleFolderSelected.code;
    this.data = { folders };
  }
}
MultipleFolderSelected.code = 'MultipleFolderSelected';

export class InvalidResponse extends BaseError {
  constructor(message) {
    super(`Invalid response from server: ${message}`);
    this.code = this.name = InvalidResponse.code;
    this.data = { message };
  }
}
InvalidResponse.code = 'InvalidResponse';
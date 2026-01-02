import { uriToPath } from "../base/uri";

const Url = acode.require('Url');

export interface GitUriParams {
  path: string;
  ref: string;
  submoduleOf?: string;
}

export function isGitUri(uri: string): boolean {
  return /^git:$/.test(Url.getProtocol(uri));
}

export function fromGitUri(uri: string): GitUriParams {
  return Url.decodeUrl(uri).query as GitUriParams;
}

export interface GitUriOptions {
  scheme?: string;
  replaceFileExtension?: boolean;
  submoduleOf?: string;
}

export function toGitUri(uri: string, ref: string, options: GitUriOptions = {}): string {
  const params: GitUriParams = {
    path: uriToPath(uri),
    ref
  };

  if (options.submoduleOf) {
    params.submoduleOf = options.submoduleOf;
  }

  let path = uriToPath(uri);

  if (options.replaceFileExtension) {
    path = `${path}.git`;
  } else if (options.submoduleOf) {
    path = `${path}.diff`;
  }

  return `git://${path}?path=${params.path}&ref=${params.ref}&submoduleOf=${params.submoduleOf}`;
}
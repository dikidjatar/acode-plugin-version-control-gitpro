const ANDROID_EXTERNAL_STORAGE_DOCUMENT_URI = 'content://com.android.externalstorage.documents/tree/';
const ACODE_DOCUMENT_URI = `content://${window.BuildInfo.packageName}.documents/tree/`;
const TERMUX_DOCUMENT_URI = 'content://com.termux.documents/tree/';
const FILE_PREFIX = 'file://';

export function isUri(thing: unknown): thing is string {
  if (!thing || typeof thing !== 'string') {
    return false
  }
  return thing.startsWith('content:') || thing.startsWith('file:');
}

export function uriToPath(uri: unknown): string {
  if (!uri || typeof uri !== 'string') {
    throw new Error(`Invalid uri: ${uri}`);
  }

  if (uri.startsWith(ANDROID_EXTERNAL_STORAGE_DOCUMENT_URI)) {
    const after = decodeURIComponent(uri.slice(ANDROID_EXTERNAL_STORAGE_DOCUMENT_URI.length));
    const parts = after.split('::');

    const rootName = parsePrimarySpec(parts[0]);
    if (!rootName) {
      throw new Error('Invalid Android external root folder');
    }

    if (parts.length === 1) {
      return removeTrailingSlash(`/sdcard/${rootName}`);
    }

    const rightName = parsePrimarySpec(parts[1]);
    if (!rightName) {
      throw new Error('Invalid Android external root folder');
    }

    return removeTrailingSlash(`/sdcard/${rightName}`);
  }

  if (uri.startsWith(ACODE_DOCUMENT_URI)) {
    return parseUri(uri.slice(ACODE_DOCUMENT_URI.length));
  }

  if (uri.startsWith(TERMUX_DOCUMENT_URI)) {
    return parseUri(uri.slice(TERMUX_DOCUMENT_URI.length));
  }

  if (uri.startsWith(FILE_PREFIX)) {
    const path = uri.slice(FILE_PREFIX.length);
    if (path.startsWith('/storage/emulated/0')) {
      return removeTrailingSlash('/sdcard' + path.slice('/storage/emulated/0'.length));
    }
    return removeTrailingSlash(path);
  }

  if (uri.startsWith('/')) {
    return uri;
  }

  throw new Error(`Unsupported uri: ${uri}`);
}

function parseUri(uri: string): string {
  if (!uri.includes('::')) {
    return removeTrailingSlash(uri);
  }

  const parts = uri.split('::');
  const path = parts.length === 1 ? parts[0] : parts[1];
  return removeTrailingSlash(path);
}

function parsePrimarySpec(spec: string): string | null {
  const idx = spec.indexOf(':');
  if (idx === -1) return null;
  return spec.slice(idx + 1);
}

function removeTrailingSlash(p: string): string {
  if (p === '/') return p;
  return p.replace(/\/+$/, '');
}
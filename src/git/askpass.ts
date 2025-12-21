import { Disposable, IDisposable } from "../base/disposable";
import { config } from "../base/config";
import { Credentials, CredentialsProvider } from "./api/git";
import { IIPCHandler, IIPCServer } from "./ipc/ipcServer";
import { LogOutputChannel } from "./logger";

const Url = acode.require('Url');
const fs = acode.require('fs');
const prompt = acode.require('prompt');

interface AskPassRequest {
  askpassType: 'https' | 'ssh';
  argv: string[];
}

const ASKPASS_SCRIPT = `#!/bin/sh

if [ -z "$ACODE_GIT_IPC_DIR" ]; then
  echo "Missing ACODE_GIT_IPC_DIR" >&2
  exit 1
fi

if [ -z "$ACODE_GIT_IPC_PIPE" ]; then
  echo "Missing ACODE_GIT_IPC_PIPE" >&2
  exit 1
fi

REQUEST_ID="req_$(date +%s%N)_$$"
RESPONSE_PIPE="$ACODE_GIT_IPC_DIR/resp_\${REQUEST_ID}.sock"

cleanup() {
  rm -f "$RESPONSE_PIPE" 2>/dev/null
  kill $WRITE_PID 2>/dev/null
}

trap cleanup EXIT INT TERM

if ! mkfifo "$RESPONSE_PIPE" 2>/dev/null; then
  echo "Failed to create response pipe" >&2
  exit 1
fi

JSON_REQUEST=$(cat <<EOF
{
  "id": "$REQUEST_ID",
  "handler": "askpass",
  "responsePipe": "$RESPONSE_PIPE",
  "body": {
    "askpassType": "https",
    "argv": ["$0", "$1", "$2", "$3", "$4", "$5", "$6", "$7", "$8", "$9"]
  }
}
EOF
)

# Send request
echo "$JSON_REQUEST" > "$ACODE_GIT_IPC_PIPE" &
WRITE_PID=$!

if RESPONSE=$(timeout 300 cat "$RESPONSE_PIPE" 2>/dev/null); then
  if echo "$RESPONSE" | grep -q '"error"'; then
    echo "Authentication failed" >&2
    exit 1
  fi
  echo "$RESPONSE"
  exit 0
else
  echo "Timeout waiting for credentials" >&2
  exit 1
fi
`.trim();

const SSH_ASKPASS_SCRIPT = `#!/bin/sh

if [ -z "$ACODE_GIT_IPC_DIR" ]; then
  echo "Missing ACODE_GIT_IPC_DIR" >&2
  exit 1
fi

if [ -z "$ACODE_GIT_IPC_PIPE" ]; then
  echo "Missing ACODE_GIT_IPC_PIPE" >&2
  exit 1
fi

REQUEST_ID="req_$(date +%s%N)_$$"
RESPONSE_PIPE="$ACODE_GIT_IPC_DIR/resp_\${REQUEST_ID}.sock"

cleanup() {
  rm -f "$RESPONSE_PIPE" 2>/dev/null
  kill $WRITE_PID 2>/dev/null
}

trap cleanup EXIT INT TERM

if ! mkfifo "$RESPONSE_PIPE" 2>/dev/null; then
  echo "Failed to create response pipe" >&2
  exit 1
fi

JSON_REQUEST=$(cat <<EOF
{
  "id": "$REQUEST_ID",
  "handler": "askpass",
  "responsePipe": "$RESPONSE_PIPE",
  "body": {
    "askpassType": "ssh",
    "argv": ["$0", "$1", "$2", "$3", "$4", "$5", "$6", "$7", "$8", "$9"]
  }
}
EOF
)

# Send request
echo "$JSON_REQUEST" > "$ACODE_GIT_IPC_PIPE" &
WRITE_PID=$!

if RESPONSE=$(timeout 300 cat "$RESPONSE_PIPE" 2>/dev/null); then
  if echo "$RESPONSE" | grep -q '"error"'; then
    echo "Authentication failed" >&2
    exit 1
  fi
  echo "$RESPONSE"
  exit 0
else
  echo "Timeout waiting for credentials" >&2
  exit 1
fi
`.trim();

export class AskPass implements IIPCHandler {

  private env: { [key: string]: string };
  private sshEnv: { [key: string]: string };
  private cache = new Map<string, Credentials>();
  private credentialsProviders = new Set<CredentialsProvider>();

  private disposable = Disposable.None;

  constructor(
    private rootPath: string,
    ipc: IIPCServer | undefined,
    private logger: LogOutputChannel
  ) {
    if (ipc) {
      this.disposable = ipc.registerHandler('askpass', this);
    }

    this.env = {
      GIT_ASKPASS: Url.join(this.rootPath, 'askpass.sh'),
    }

    this.sshEnv = {
      SSH_ASKPASS: Url.join(this.rootPath, 'ssh-askpass.sh'),
      SSH_ASKPASS_REQUIRE: 'force',
      DISPLAY: ':0'
    }
  }

  async setupScripts(): Promise<void> {
    try {
      await this.clean();
      const rootFs = fs(`file://${this.rootPath}`);

      // Create script file
      await rootFs.createFile('askpass.sh', ASKPASS_SCRIPT);
      await rootFs.createFile('ssh-askpass.sh', SSH_ASKPASS_SCRIPT);
  
      // Make scripts executable
      const askpassPath = Url.join(this.rootPath, 'askpass.sh');
      const sshAskpassPath = Url.join(this.rootPath, 'ssh-askpass.sh');
      await Executor.execute(`chmod +x ${askpassPath}`, true);
      await Executor.execute(`chmod +x ${sshAskpassPath}`, true);
    } catch (err) {
      this.logger.error(`[Askpass][setupScript] error: ${err}`);
    }
  }

  private async clean(): Promise<void> {
    const askpassFile = fs(`file://${Url.join(this.rootPath, 'askpass.sh')}`);
    const sshAskpassFile = fs(`file://${Url.join(this.rootPath, 'ssh-askpass.sh')}`);
    if (await askpassFile.exists()) {
      await askpassFile.delete();
    }
    if (await sshAskpassFile.exists()) {
      await sshAskpassFile.delete();
    }
  }

  async handle({ askpassType, argv }: AskPassRequest): Promise<any> {
    this.logger.debug(`[AskPass][handle] askpassType=${askpassType}, argv=[${argv.join(', ')}]`);

    const gitConfig = config.get('vcgit')!;
    if (!gitConfig.enabled) {
      this.logger.warn('[Askpass][handle] Git is disabled');
      return '';
    }

    return askpassType === 'https'
      ? await this.handleAskpass(argv)
      : await this.handleSSHAskpass(argv)
  }

  async handleAskpass(argv: string[]): Promise<string> {
    // HTTPS (username | password)
    // Username for 'https://github.com':
    // Password for 'https://github.com':
    const request = argv[1];
    const host = request.match(/'([^']+)'/)?.[1] ?? 'https://github.com';

    this.logger.debug(`[Askpass][handleAskpass] request: ${request}, host: ${host}`);

    const uri = new URL(host);
    const authority = uri.host;
    const password = /password/i.test(request);
    const cached = this.cache.get(authority);

    if (cached && password) {
      this.cache.delete(authority);
      return cached.password;
    }

    if (!password) {
      for (const credentialsProvider of this.credentialsProviders) {
        try {
          const credentials = await credentialsProvider.getCredentials(host);
          if (credentials) {
            this.cache.set(authority, credentials);
            setTimeout(() => this.cache.delete(authority), 60_000);
            return credentials.username;
          }
        } catch { }
      }
    }

    const options = { placeholder: request, required: true };
    const result = await prompt(`Git: ${host}`, '', 'text', options);

    if (result) {
      return result;
    }

    return '';
  }

  async handleSSHAskpass(argv: string[]): Promise<string> {
    return '';
  }

  getEnv(): { [key: string]: string } {
    const gitConfig = config.get('vcgit')!;
    return gitConfig.useIntegratedAskPass ? { ...this.env, ...this.sshEnv } : {};
  }

  registerCredentialsProvider(provider: CredentialsProvider): IDisposable {
    this.credentialsProviders.add(provider);
    return Disposable.toDisposable(() => this.credentialsProviders.delete(provider));
  }

  dispose(): void {
    this.disposable.dispose();
  }
}
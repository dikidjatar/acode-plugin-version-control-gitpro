import { config } from "../base/config";
import { Disposable } from "../base/disposable";
import { getExecutor } from "../base/executor";
import { IIPCHandler, IIPCServer } from "./ipc/ipcServer";
import { LogOutputChannel } from "./logger";
import { toFullPath } from "./utils";

const EditorFile = acode.require('editorFile');
const Url = acode.require('Url');
const fs = acode.require('fs');

interface GitEditorRequest {
  commitMessagePath?: string;
}

const SCRIPT = `#!/bin/sh

if [ -z "$1" ]; then
  echo "Missing file" >&2
  exit 1
fi

if [ -z "$ACODE_GIT_IPC_DIR" ]; then
  echo "Missing ACODE_GIT_IPC_DIR" >&2
  exit 1
fi

if [ -z "$ACODE_GIT_IPC_PIPE" ]; then
  echo "Missing ACODE_GIT_IPC_PIPE" >&2
  exit 1
fi

COMMIT_MSG_FILE="$1"
REQUEST_ID="editor_$(date +%s%N)_$$"
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
  "handler": "git-editor",
  "responsePipe": "$RESPONSE_PIPE",
  "body": {
    "commitMessagePath": "$COMMIT_MSG_FILE"
  }
}
EOF
)

# Send request
echo "$JSON_REQUEST" > "$ACODE_GIT_IPC_PIPE" &
WRITE_PID=$!

# Wait for response with timeout 10 minutes for user to write commit message
if RESPONSE=$(timeout 600 cat "$RESPONSE_PIPE" 2>/dev/null); then
  if echo "$RESPONSE" | grep -q '"error"'; then
    echo "Editor failed" >&2
    exit 1
  fi
  exit 0
else
  echo "Timeout waiting for editor" >&2
  exit 1
fi
`.trim();

export class GitEditor implements IIPCHandler {

  private env: { [key: string]: string };
  private disposable = Disposable.None;

  constructor(
    private rootPath: string,
    ipcServer: IIPCServer | undefined,
    private logger: LogOutputChannel
  ) {

    if (ipcServer) {
      this.disposable = ipcServer.registerHandler('git-editor', this);
    }

    this.env = {
      GIT_EDITOR: Url.join(this.rootPath, 'git-editor.sh'),
    }
  }

  async setupScript(): Promise<void> {
    try {
      await this.clean();
      await fs(`file://${this.rootPath}`).createFile('git-editor.sh', SCRIPT);
      await getExecutor().execute(`chmod +x ${Url.join(this.rootPath, 'git-editor.sh')}`, true);
    } catch (err) {
      this.logger.error(`[GitEditor][setupScript] error: ${err}`);
    }
  }

  private async clean(): Promise<void> {
    const gitEditorFile = fs(`file://${Url.join(this.rootPath, 'git-editor.sh')}`);
    if (await gitEditorFile.exists()) {
      await gitEditorFile.delete();
    }
  }

  async handle({ commitMessagePath }: GitEditorRequest): Promise<any> {
    if (!commitMessagePath) {
      throw new Error('No commit message path provided');
    }

    commitMessagePath = toFullPath(commitMessagePath);
    const filename = Url.basename(commitMessagePath)!;

    const file = new EditorFile(filename, { uri: `file://${commitMessagePath}` });
    file.makeActive();

    if (localStorage.sidebarShown === '1') {
      acode.exec('toggle-sidebar');
    }

    return new Promise((c) => {
      const cleanup = () => {
        file.off('close', onclose);
      }
      const onclose = (e: Acode.FileEvent) => {
        cleanup();
        c(true);
      }
      file.on('close', onclose);
    });
  }

  getEnv(): { [key: string]: string; } {
    const gitConfig = config.get('vcgit')!;
    return gitConfig.useEditorAsCommitInput ? this.env : {};
  }

  async dispose(): Promise<void> {
    this.disposable.dispose();
  }
}
import { App } from "../../base/app";
import { Disposable, IDisposable } from "../../base/disposable";
import { LogOutputChannel } from "../logger";

const fs = acode.require('fs');
const Url = acode.require('Url');

export interface IIPCHandler {
  handle(request: any): Promise<any>;
}

export interface IIPCServer extends IDisposable {
  getEnv(): { [key: string]: string };
  registerHandler(name: string, handler: IIPCHandler): IDisposable;
}

class IPCServer implements IIPCServer {

  private handlers = new Map<string, IIPCHandler>();
  private ipcDir: string;
  private requestPipe: string;
  private readonly disposables: IDisposable[] = [];

  constructor(rootPath: string, private logger: LogOutputChannel) {
    this.ipcDir = Url.join(rootPath, 'ipc');
    this.requestPipe = Url.join(this.ipcDir, 'request.sock');

    App.onCloseApp(async () => await this.dispose(), null, this.disposables);
  }

  async start(): Promise<void> {
    await this.ensureDirectory(this.ipcDir);

    const pipe = fs(`file://${this.requestPipe}`);
    if (await pipe.exists()) {
      await pipe.delete();
    }

    await Executor.execute(`mkfifo "${this.requestPipe}"`, true);
    this.startListener();
  }

  private async startListener(): Promise<void> {
    while (true) {
      try {
        // const result = await Executor.execute(`cat "${this._requestPipe}"`, true);
        const result = await fs(`file://${this.requestPipe}`).readFile('json');
        await this.processRequest(result);
      } catch { }
    }
  }

  private async processRequest(request: any): Promise<void> {
    const { id, handler: handlerName, body, responsePipe } = request;

    this.logger.debug(`[IPC] Received request ${id} for ${handlerName}`);

    const handler = this.handlers.get(`/${handlerName}`);
    let data: any;

    if (!handler) {
      data = JSON.stringify({ error: `Handler ${handlerName} not found` });
    } else {
      try {
        data = await handler.handle(body);
      } catch (err) {
        data = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    await this.sendResponse(responsePipe, data);
  }

  private async sendResponse(pipePath: string, data: string): Promise<void> {
    try {
      this.logger.debug(`[IPC][sendResponse] response=${data}`);
      await Executor.execute(`echo '${data}' > "${pipePath}"`, true);
    } catch (err) {
      this.logger.error(`[IPC] Failed to write response: ${err}`);
    }
  }

  private async ensureDirectory(path: string): Promise<void> {
    const uri = `file://${path}`;
    const basename = Url.basename(uri);
    const dirname = Url.dirname(uri);

    const exists = await fs(uri).exists();
    if (!exists) {
      await fs(dirname).createDirectory(basename!);
    }
  }

  getEnv(): { [key: string]: string } {
    return {
      ACODE_GIT_IPC_DIR: this.ipcDir,
      ACODE_GIT_IPC_PIPE: this.requestPipe
    };
  }

  registerHandler(name: string, handler: IIPCHandler): IDisposable {
    const path = `/${name}`;
    this.handlers.set(path, handler);
    return Disposable.toDisposable(() => this.handlers.delete(path));
  }

  async dispose(): Promise<void> {
    this.disposables.forEach(d => d.dispose());
  }
}

export async function createIPCServer(root: string, logger: LogOutputChannel): Promise<IIPCServer> {
  const server = new IPCServer(root, logger);
  await server.start();
  return server;
}
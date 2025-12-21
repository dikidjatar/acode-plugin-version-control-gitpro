export interface Process {
  readonly pid: string | null;
  readonly stdin: WriteableStream | null;
  readonly stdout: ReadableStream | null;
  readonly stderr: ReadableStream | null;
  readonly exitCode: number | null;

  on(event: 'data', listener: (data: string) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'close', listener: (code: number) => void): void;
  on(event: 'stdout', listener: (data: string) => void): void;
  on(event: 'stderr', listener: (data: string) => void): void;
  on(event: string, listener: any): void;

  off(event: 'data', listener: (data: string) => void): void;
  off(event: 'error', listener: (error: Error) => void): void;
  off(event: 'close', listener: (code: number) => void): void;
  off(event: 'stdout', listener: (data: string) => void): void;
  off(event: 'stderr', listener: (data: string) => void): void;
  off(event: string, listener: any): void;

  write(data: string): Promise<void>;
  kill(): Promise<void>;
  isRunning(): Promise<boolean>;
}

class WriteableStream {
  constructor(private process: Process) { }

  async write(data: string): Promise<void> {
    await this.process.write(data);
  }
}

class ReadableStream {
  constructor(private process: Process, private type: 'stdout' | 'stderr') { }

  on(event: 'data', listener: (data: string) => void): void;
  on(event: 'close', listener: (code: number) => void): void;
  on(event: any, listener: any) {
    if (event === 'data') {
      this.process.on(this.type, listener);
    } else if (event === 'close') {
      this.process.on('close', listener);
    }
  }

  off(event: 'data', listener: (data: string) => void): void;
  off(event: 'close', listener: (code: number) => void): void;
  off(event: any, listener: any) {
    if (event === 'data') {
      this.process.off(this.type, listener);
    } else if (event === 'close') {
      this.process.off('close', listener);
    }
  }
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  alpine?: boolean;
  shell?: string;
  /**
   * Raw shell string to append at the end (for redirections, pipes, etc)
   * Example: '2>/dev/null', '| grep something'
   */
  shellAppend?: string;
}

function escapeShellArg(arg: string): string {
  if (!arg) return "''";

  if (/^[a-zA-Z0-9_\-\.\/]+$/.test(arg)) {
    return arg;
  }

  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

function escapeEnvValue(value: string): string {
  return '"' + value.replace(/([\\$"`])/g, '\\$1') + '"';
}

function buildCommand(
  command: string,
  args: string[],
  options: SpawnOptions = {}
): string {
  const parts: string[] = [];

  if (options.env) {
    const envParts: string[] = [];
    for (const [key, value] of Object.entries(options.env)) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        console.warn(`Invalid environment variable name: ${key}`);
        continue;
      }
      envParts.push(`export ${key}=${escapeEnvValue(value)}`);
    }
    if (envParts.length > 0) {
      parts.push(envParts.join(' && '));
    }
  }

  if (options.cwd) {
    parts.push(`cd ${escapeShellArg(options.cwd)}`);
  }

  const escapedCommand = escapeShellArg(command);
  const escapedArgs = args.map(arg => escapeShellArg(arg));

  const fullCommand = [escapedCommand, ...escapedArgs];

  if (options.shellAppend) {
    fullCommand.push(options.shellAppend);
  }

  parts.push(fullCommand.join(' '));

  let finalCommand = parts.join(' && ');

  if (options.shell) {
    finalCommand = `${options.shell} -c ${escapeShellArg(finalCommand)}`;
  }

  return finalCommand;
}

class AcodeProcess implements Process {

  private _pid: string | null = null;
  get pid(): string | null {
    return this._pid;
  }

  private _stdin: WriteableStream | null;
  get stdin(): WriteableStream | null {
    return this._stdin;
  }

  private _stdout: ReadableStream | null;
  get stdout(): ReadableStream | null {
    return this._stdout;
  }

  private _stderr: ReadableStream | null;
  get stderr(): ReadableStream | null {
    return this._stderr;
  }

  private _exitCode: number | null = null;
  get exitCode(): number | null {
    return this._exitCode;
  };

  private _listeners: Map<string, Set<Function>> = new Map();

  constructor(
    private command: string,
    private args: string[],
    private options: SpawnOptions = {}
  ) {
    this._listeners.set('data', new Set());
    this._listeners.set('error', new Set());
    this._listeners.set('close', new Set());
    this._listeners.set('stdout', new Set());
    this._listeners.set('stderr', new Set());

    this._stdin = new WriteableStream(this);
    this._stdout = new ReadableStream(this, 'stdout');
    this._stderr = new ReadableStream(this, 'stderr');
  }

  async isRunning(): Promise<boolean> {
    try {
      if (!this._pid) return false;
      return await Executor.isRunning(this._pid);
    } catch (err) {
      return false;
    }
  }

  async start(): Promise<void> {
    try {
      if (await this.isRunning()) return;

      const command = buildCommand(this.command, this.args, this.options);

      this._pid = await Executor.start(
        command,
        (type: string, data: string) => {
          // Filter out proot warnings
          if (type === 'stderr' && data.includes("proot warning: can't sanitize binding")) {
            return;
          }

          if (type === 'stdout') {
            this._emit('stdout', data);
            this._emit('data', data);
          } else if (type === 'stderr') {
            this._emit('stderr', data);
            this._emit('data', data);
          } else if (type === 'exit') {
            const exitCode = Number(data.trim());
            this._exitCode = exitCode;
            this._emit('close', exitCode);
          }
        },
        this.options.alpine ?? false
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this._emit('error', error);
      throw err;
    }
  }


  on(event: "data", listener: (data: string) => void): void;
  on(event: "stdout", listener: (stdout: string) => void): void;
  on(event: "stderr", listener: (stderr: string) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: (code: number) => void): void;
  on(event: any, listener: any): void {
    const listeners = this._listeners.get(event);
    if (listeners) {
      listeners.add(listener);
    }
  }

  off(event: "data", listener: (data: string) => void): void;
  off(event: "stdout", listener: (stderr: string) => void): void;
  off(event: "stderr", listener: (data: string) => void): void;
  off(event: "error", listener: (error: Error) => void): void;
  off(event: "close", listener: (code: number) => void): void;
  off(event: any, listener: any): void {
    const listeners = this._listeners.get(event);
    if (listeners && listeners.has(listener)) {
      listeners.delete(listener);
    }
  }

  private _emit(event: string, data: any): void {
    const listeners = this._listeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(data);
        } catch (err) {
          console.warn(`Error in ${event} listener:`, err);
        }
      });
    }
  }

  async write(data: string): Promise<void> {
    try {
      if (!this._pid || !(await this.isRunning())) {
        throw new Error('Process not started');
      }
      await Executor.write(this._pid, data);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this._emit('error', error);
      throw error;
    }
  }

  async kill(): Promise<void> {
    if (this._pid) {
      try {
        if (await this.isRunning()) {
          await Executor.stop(this._pid);
        }
      } catch (err) {
        console.warn(`Failed to kill process '${this._pid}':`, err);
      }
    }
  }
}

export interface ExecOptions extends SpawnOptions {
  encoding?: string;
  maxBuffer?: number;
  timeout?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function spawn(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {}
): Process {
  const process = new AcodeProcess(command, args, options);
  process.start().catch(err => {
    console.error('Failed to start process', err);
  });
  return process;
}
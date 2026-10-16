export interface ProcessEventMap {
  /**
   * Output from either stdout or stderr.
   */
  data: string;
  stdout: string;
  stderr: string;
  error: Error;
  /**
   * Emitted once with the exit code when the process terminates.
   */
  close: number;
}

export type ProcessEvent = keyof ProcessEventMap;
export type ProcessListener<E extends ProcessEvent> = (payload: ProcessEventMap[E]) => void;

export interface Process {
  readonly pid: string | null;
  readonly stdin: WritableProcessStream;
  readonly stdout: ReadableProcessStream;
  readonly stderr: ReadableProcessStream;
  readonly exitCode: number | null;

  on<E extends ProcessEvent>(event: E, listener: ProcessListener<E>): void;
  off<E extends ProcessEvent>(event: E, listener: ProcessListener<E>): void;

  write(data: string): Promise<void>;
  kill(): Promise<void>;
  isRunning(): Promise<boolean>;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  alpine?: boolean;
  /**
   * Shell used to wrap the final command (`<shell> -c '<command>'`).
   * The value is inserted verbatim, so it may contain flags (e.g. `bash -l`).
   */
  shell?: string;
  /**
   * Raw shell string to append at the end (for redirections, pipes, etc).
   * This value is NOT escaped.
   * Example: '2>/dev/null', '| grep something'
   */
  shellAppend?: string;
}

export interface ExecOptions extends SpawnOptions {
  /**
   * Maximum time (ms) to wait for the command. When exceeded the returned
   * result has `exitCode` 124 (same convention as coreutils `timeout`).
   * Note: the underlying command cannot be cancelled and keeps running.
   */
  timeout?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

type ProcessState = 'idle' | 'starting' | 'running' | 'exited' | 'failed';

interface PendingWrite {
  data: string;
  resolve: () => void;
  reject: (err: Error) => void;
}

const UNKNOWN_EXIT_CODE = -1;
const TIMEOUT_EXIT_CODE = 124;

const SAFE_SHELL_ARG = /^[\w@%+:,./-]+$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Known noisy stderr lines produced by proot / the Acode terminal.
 */
const IGNORED_STDERR_PATTERNS: readonly RegExp[] = [
  /proot warning: can't sanitize binding/,
  /find: \.: Permission denied/,
];

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function escapeShellArg(arg: string): string {
  if (!arg) return "''";
  if (SAFE_SHELL_ARG.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function isIgnoredStderr(data: string): boolean {
  return IGNORED_STDERR_PATTERNS.some(pattern => pattern.test(data));
}

function stripIgnoredStderr(stderr: string): string {
  return stderr
    .split('\n')
    .filter(line => !isIgnoredStderr(line))
    .join('\n');
}

function parseExitCode(data: string): number {
  const code = Number.parseInt(data.trim(), 10);
  return Number.isNaN(code) ? UNKNOWN_EXIT_CODE : code;
}

function buildCommand(command: string, args: readonly string[], options: SpawnOptions = {}): string {
  const steps: string[] = [];

  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (!ENV_NAME.test(key)) {
      console.warn(`Invalid environment variable name: ${key}`);
      continue;
    }
    steps.push(`export ${key}=${escapeShellArg(value ?? '')}`);
  }

  if (options.cwd) {
    steps.push(`cd ${escapeShellArg(options.cwd)}`);
  }

  const invocation = [command, ...args].map(escapeShellArg);
  if (options.shellAppend) {
    invocation.push(options.shellAppend);
  }
  steps.push(invocation.join(' '));

  const script = steps.join(' && ');
  return options.shell ? `${options.shell} -c ${escapeShellArg(script)}` : script;
}

export function getExecutor(): Executor {
  if (typeof Executor.BackgroundExecutor === 'object') {
    return Executor.BackgroundExecutor;
  }
  return Executor;
}

class ProcessEmitter {
  private readonly listeners = new Map<ProcessEvent, Set<ProcessListener<any>>>();

  on<E extends ProcessEvent>(event: E, listener: ProcessListener<E>): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  off<E extends ProcessEvent>(event: E, listener: ProcessListener<E>): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit<E extends ProcessEvent>(event: E, payload: ProcessEventMap[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;

    // Copy so listeners may safely unsubscribe while being notified.
    for (const listener of [...set]) {
      try {
        listener(payload);
      } catch (err) {
        console.warn(`Error in '${event}' listener:`, err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export class WritableProcessStream {
  constructor(private readonly process: Process) { }

  write(data: string): Promise<void> {
    return this.process.write(data);
  }
}

export class ReadableProcessStream {
  constructor(
    private readonly process: Process,
    private readonly type: 'stdout' | 'stderr'
  ) { }

  on(event: 'data', listener: (data: string) => void): void;
  on(event: 'close', listener: (code: number) => void): void;
  on(event: 'data' | 'close', listener: (payload: any) => void): void {
    this.process.on(event === 'data' ? this.type : 'close', listener);
  }

  off(event: 'data', listener: (data: string) => void): void;
  off(event: 'close', listener: (code: number) => void): void;
  off(event: 'data' | 'close', listener: (payload: any) => void): void {
    this.process.off(event === 'data' ? this.type : 'close', listener);
  }
}

class AcodeProcess implements Process {
  readonly stdin: WritableProcessStream = new WritableProcessStream(this);
  readonly stdout: ReadableProcessStream = new ReadableProcessStream(this, 'stdout');
  readonly stderr: ReadableProcessStream = new ReadableProcessStream(this, 'stderr');

  private readonly executor = getExecutor();
  private readonly emitter = new ProcessEmitter();

  private state: ProcessState = 'idle';
  private killRequested = false;
  private pendingWrites: PendingWrite[] = [];
  /**
   * Serializes writes so they reach the process in call order.
   */
  private writeChain: Promise<void> = Promise.resolve();

  private _pid: string | null = null;
  private _exitCode: number | null = null;

  constructor(
    private readonly command: string,
    private readonly args: readonly string[],
    private readonly options: SpawnOptions = {}
  ) { }

  get pid(): string | null {
    return this._pid;
  }

  get exitCode(): number | null {
    return this._exitCode;
  }

  on<E extends ProcessEvent>(event: E, listener: ProcessListener<E>): void {
    this.emitter.on(event, listener);
  }

  off<E extends ProcessEvent>(event: E, listener: ProcessListener<E>): void {
    this.emitter.off(event, listener);
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    this.state = 'starting';

    try {
      const command = buildCommand(this.command, this.args, this.options);
      this._pid = await this.executor.start(command, this.handleOutput, this.options.alpine ?? false);
    } catch (err) {
      const error = toError(err);
      this.state = 'failed';
      this.rejectPendingWrites(error);
      this.emitter.emit('error', error);
      throw error;
    }

    // The process may have already exited before `start` resolved.
    if (this.state !== 'starting') return;
    this.state = 'running';

    if (this.killRequested) {
      await this.kill();
      return;
    }

    this.flushPendingWrites();
  }

  async write(data: string): Promise<void> {
    switch (this.state) {
      case 'idle':
      case 'starting':
        return new Promise<void>((resolve, reject) => {
          this.pendingWrites.push({ data, resolve, reject });
        });
      case 'running':
        return this.enqueueWrite(data);
      default:
        throw new Error('Process is not running');
    }
  }

  async kill(): Promise<void> {
    if (this.state === 'idle' || this.state === 'starting') {
      // Defer until the pid is known; `start` will stop the process.
      this.killRequested = true;
      return;
    }

    if (this.state !== 'running' || !this._pid) return;

    try {
      await this.executor.stop(this._pid);
    } catch (err) {
      console.warn(`Failed to kill process '${this._pid}':`, err);
    }
  }

  async isRunning(): Promise<boolean> {
    if (this.state !== 'running' || !this._pid) return false;

    try {
      return await this.executor.isRunning(this._pid);
    } catch {
      return false;
    }
  }

  private readonly handleOutput = (type: ExecutorOutputType, data: string): void => {
    switch (type) {
      case 'stdout':
        this.emitter.emit('stdout', data);
        this.emitter.emit('data', data);
        break;
      case 'stderr':
        if (isIgnoredStderr(data)) return;
        this.emitter.emit('stderr', data);
        this.emitter.emit('data', data);
        break;
      case 'exit':
        this.handleExit(parseExitCode(data));
        break;
    }
  };

  private handleExit(code: number): void {
    if (this.state === 'exited') return;

    this.state = 'exited';
    this._exitCode = code;
    this.rejectPendingWrites(new Error('Process exited before input could be written'));
    this.emitter.emit('close', code);
    // No more events can be emitted; release listener references.
    this.emitter.clear();
  }

  private enqueueWrite(data: string): Promise<void> {
    const task = this.writeChain.then(async () => {
      if (!this._pid) throw new Error('Process is not running');
      try {
        await this.executor.write(this._pid, data);
      } catch (err) {
        const error = toError(err);
        this.emitter.emit('error', error);
        throw error;
      }
    });

    // Keep the chain alive even if this write fails.
    this.writeChain = task.catch(() => undefined);
    return task;
  }

  private flushPendingWrites(): void {
    const queue = this.pendingWrites;
    this.pendingWrites = [];

    for (const { data, resolve, reject } of queue) {
      this.enqueueWrite(data).then(resolve, reject);
    }
  }

  private rejectPendingWrites(error: Error): void {
    const queue = this.pendingWrites;
    this.pendingWrites = [];

    for (const { reject } of queue) {
      reject(error);
    }
  }
}

export function spawn(command: string, args: string[] = [], options: SpawnOptions = {}): Process {
  const process = new AcodeProcess(command, args, options);
  process.start().catch(err => {
    console.error('Failed to start process', err);
  });
  return process;
}

export async function exec(command: string, args: string[] = [], options: ExecOptions = {}): Promise<ExecResult> {
  const cmd = buildCommand(command, args, options);
  const execution = getExecutor()
    .execute(cmd, options.alpine ?? true)
    .then(
      (stdout): ExecResult => ({ exitCode: 0, stdout, stderr: '' }),
      (err): ExecResult => ({
        exitCode: 1,
        stdout: '',
        stderr: stripIgnoredStderr(err?.message ?? String(err)),
      })
    );

  if (!options.timeout || options.timeout <= 0) {
    return execution;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ExecResult>(resolve => {
    timer = setTimeout(() => resolve({
      exitCode: TIMEOUT_EXIT_CODE,
      stdout: '',
      stderr: `Command timed out after ${options.timeout}ms`,
    }), options.timeout);
  });

  try {
    return await Promise.race([execution, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
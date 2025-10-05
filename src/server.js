import settings from "./settings";

const terminal = acode.require('terminal');

export async function startServer(background = false) {
  const output = await terminal.createLocal({ name: 'Git server' });
  const host = 'localhost';
  const port = settings.serverPort;

  const log = msg => terminal.write(output.id, msg + '\n');

  log('\nInitializing git server setup...');

  try {
    log('Verifying Node.js installation...');
    try {
      const nodeVersion = await Executor.execute('node -v', true);
      log(`Nodejs ${nodeVersion.trim()} is installed`);
    } catch (e) {
      log('Installing Node.js...');
      await Executor.execute('apk add nodejs', true);
      const nodeVersion = await Executor.execute('node -v', true);
      log(`Node.js ${nodeVersion.trim()} installed successfully`);
    }

    log('Verifying npm installation...');
    try {
      const npmVersion = await Executor.execute('npm -v', true);
      log(`npm ${npmVersion.trim()} is installed`);
    } catch (e) {
      log('Installing npm...');
      await Executor.execute('apk add npm', true);
      const npmVersion = await Executor.execute('npm -v', true);
      log(`npm ${npmVersion.trim()} installed successfully`);
    }

    log('Verifying git-server installation...');
    const result = await Executor.execute('npm list -g', true);
    if (result.includes('@dikidjatar/git-server')) {
      log('Git server is already installed');
    } else {
      log('Installing git-server...');
      await Executor.execute('npm install -g @dikidjatar/git-server', true);
      log('Git server installed successfully');
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    log('Starting git server...');
    if (background) {
      await startInBackground(port, host, (type, data) => log(`[${type}] ${data}`));
    } else {
      await start(port, host, msg => log(output.id, msg));
    }
  } catch (error) {
    const errorMsg = (error instanceof Error) ? error.message : String(error);
    log('Error: Failed to start git server');
    log(errorMsg);
    window.toast('Failed to start git server', 3000);
  }
}

export async function stopServer() {
  try {
    const serverId = localStorage.getItem('vc_server_id');
    const uuid = localStorage.getItem('vc_server_uuid');
  
    if (!await isServerRunning()) return;
    if (uuid) await Executor.stop(uuid);
    if (serverId) terminal.close(serverId);
  
    localStorage.removeItem('vc_server_id');
    localStorage.removeItem('vc_server_uuid');
  } catch (e) {
    window.toast('Failed to stop server', 3000);
  }
}

export async function isServerRunning() {
  const isBgRunning = await new Promise((resolve) => {
    Executor.isRunning(localStorage.getItem('vc_server_uuid'))
      .then(resolve)
      .catch(() => resolve(false));
  });
  return isBgRunning || localStorage.getItem('vc_server_id') !== null;
}

async function start(port, host) {
  const server = await terminal.createServer({ name: 'Git server' });
  localStorage.setItem('vc_server_id', server.id);
  setTimeout(() => {
    terminal.write(server.id, `git-server -p ${port} -h ${host} \r\n`);
  }, 1000);
}

async function startInBackground(port, host, log = console.log) {
  if (await isServerRunning()) {
    await stopServer();
  }
  const uuid = await Executor.start(`git-server -p ${port} -h ${host}`, log, true);
  localStorage.setItem('vc_server_uuid', uuid);
}
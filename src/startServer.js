import settings from "./settings";

const terminal = acode.require('terminal');

let isStarting = false;

export default async function startServer() {
  if (isStarting) return;
  isStarting = true;

  const output = await terminal.createLocal({ name: 'Git server' });
  await wait(1000);

  log(output.id, '\nInitializing git server setup...');

  try {
    log(output.id, 'Verifying Node.js installation...');
    try {
      const nodeVersion = await Executor.execute('node -v', true);
      log(output.id, `Nodejs ${nodeVersion.trim()} is installed`);
    } catch (e) {
      log(output.id, 'Installing Node.js...');
      await Executor.execute('apk add nodejs', true);
      const nodeVersion = await Executor.execute('node -v', true);
      log(output.id, `Node.js ${nodeVersion.trim()} installed successfully`);
    }

    log(output.id, 'Verifying npm installation...');
    try {
      const npmVersion = await Executor.execute('npm -v', true);
      log(output.id, `npm ${npmVersion.trim()} is installed`);
    } catch (e) {
      log(output.id, 'Installing npm...');
      await Executor.execute('apk add npm', true);
      const npmVersion = await Executor.execute('npm -v', true);
      log(output.id, `npm ${npmVersion.trim()} installed successfully`);
    }

    log(output.id, 'Verifying git-server installation...');
    const result = await Executor.execute('npm list -g', true);
    if (result.includes('@dikidjatar/git-server')) {
      log(output.id, 'Git server is already installed');
    } else {
      log(output.id, 'Installing git-server...');
      await Executor.execute('npm install -g @dikidjatar/git-server', true);
      log(output.id, 'Git server installed successfully');
    }

    log(output.id, 'Starting git server...');
    const server = await terminal.createServer({ name: 'Git server' });
    await wait(1000);

    const serverHost = 'localhost';
    const serverPort = settings.serverPort;
    terminal.write(server.id, `git-server -p ${serverPort} -h ${serverHost} \r\n`);
  } catch (error) {
    const errorMsg = (error instanceof Error) ? error.message : String(error);
    log(output.id, 'Error: Failed to start git server');
    log(output.id, errorMsg);
    window.toast('Failed to start git server', 3000);
  } finally {
    isStarting = false;
  }
}

function wait(time) {
  return new Promise((resolve) => setTimeout(resolve, time || 1000));
}

function log(id, message) {
  terminal.write(id, message + '\n');
}
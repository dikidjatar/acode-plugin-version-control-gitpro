import plugin from '../plugin.json';
import VersionControl from './versionControl.js';

if (window.acode) {
  const acodePlugin = new VersionControl(plugin);
  acode.setPluginInit(
    plugin.id,
    async (baseUrl, $page, { cacheFileUrl, cacheFile }) => {
      if (!baseUrl.endsWith('/')) baseUrl += '/';
      acodePlugin.baseUrl = baseUrl;
      await acodePlugin.init($page, cacheFile, cacheFileUrl);
    }, acodePlugin.getSettings());
  acode.setPluginUnmount(plugin.id, () => acodePlugin.destroy());
}

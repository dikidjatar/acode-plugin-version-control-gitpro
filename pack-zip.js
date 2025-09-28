const path = require('path');
const fs = require('fs');
const jszip = require('jszip');

const iconFile = path.join(__dirname, 'icon.png');
const pluginJSON = path.join(__dirname, 'plugin.json');
const distFolder = path.join(__dirname, 'dist');
const json = JSON.parse(fs.readFileSync(pluginJSON, 'utf8'));
let readmeDotMd;
let changelogDotMd;

if (!json.readme) {
  readmeDotMd = path.join(__dirname, 'readme.md');
  if (!fs.existsSync(readmeDotMd)) {
    readmeDotMd = path.join(__dirname, 'README.md');
  }
}


if (!json.changelogs) {
  if (!fs.existsSync(changelogDotMd)) {
    changelogDotMd = path.join(__dirname, 'CHANGELOG.md');
  }

  if (!fs.existsSync(changelogDotMd)) {
    changelogDotMd = path.join(__dirname, 'changelog.md');
  }
}

// create zip file of dist folder

const zip = new jszip();

zip.file('icon.png', fs.readFileSync(iconFile));
zip.file('plugin.json', fs.readFileSync(pluginJSON));

if (readmeDotMd) {
  zip.file("readme.md", fs.readFileSync(readmeDotMd));
}
if (changelogDotMd) {
  zip.file("changelog.md", fs.readFileSync(changelogDotMd));
}

loadFile('', distFolder);

zip
  .generateNodeStream({ type: 'nodebuffer', streamFiles: true })
  .pipe(fs.createWriteStream(path.join(__dirname, 'plugin.zip')))
  .on('finish', () => {
    console.log('Plugin plugin.zip written.');
  });

function loadFile(root, folder) {
  const distFiles = fs.readdirSync(folder);
  distFiles.forEach((file) => {

    const stat = fs.statSync(path.join(folder, file));

    if (stat.isDirectory()) {
      zip.folder(file);
      loadFile(path.join(root, file), path.join(folder, file));
      return;
    }

    if (!/LICENSE.txt/.test(file)) {
      zip.file(path.join(root, file), fs.readFileSync(path.join(folder, file)));
    }
  });
}
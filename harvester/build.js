'use strict';

/**
 * Construiește executabilele harvester-ului prin Node SEA (Single Executable
 * Application): bundle cu esbuild → blob SEA → injectare în binarul oficial
 * Node pentru Windows (descărcat de pe nodejs.org).
 *
 *   node build.js           → dist/CosulIeftin-Harvester.exe (Windows x64)
 *   node build.js --linux   → și binar Linux (din node-ul local)
 *
 * Notă: versiunea Node locală trebuie să existe și ca release Windows pe
 * nodejs.org (folosim exact aceeași versiune pentru compatibilitatea blobului).
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const BUILD = path.join(ROOT, 'build');
const DIST = path.join(ROOT, 'dist');
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

async function main() {
  fs.mkdirSync(BUILD, { recursive: true });
  fs.mkdirSync(DIST, { recursive: true });

  run('npx esbuild src/index.js --bundle --platform=node --target=node20 --outfile=build/harvester.cjs');

  fs.writeFileSync(
    path.join(ROOT, 'sea-config.json'),
    JSON.stringify(
      { main: 'build/harvester.cjs', output: 'build/sea-prep.blob', disableExperimentalSEAWarning: true },
      null,
      2
    )
  );
  run('node --experimental-sea-config sea-config.json');

  const version = process.version; // ex. v22.22.2
  const zipName = `node-${version}-win-x64.zip`;
  const zipPath = path.join(BUILD, zipName);
  if (!fs.existsSync(zipPath)) {
    const url = `https://nodejs.org/dist/${version}/${zipName}`;
    console.log(`Descarc ${url} ...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Nu pot descărca ${url}: HTTP ${res.status}`);
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  }

  run(`cd build && unzip -o -q ${zipName} node-${version}-win-x64/node.exe`);
  const exe = path.join(DIST, 'CosulIeftin-Harvester.exe');
  fs.copyFileSync(path.join(BUILD, `node-${version}-win-x64`, 'node.exe'), exe);
  run(`npx -y postject "${exe}" NODE_SEA_BLOB build/sea-prep.blob --sentinel-fuse ${SENTINEL}`);
  console.log(`\n✔ ${exe} (${(fs.statSync(exe).size / 1024 / 1024).toFixed(1)} MB)`);

  if (process.argv.includes('--linux')) {
    const lin = path.join(DIST, 'cosul-ieftin-harvester-linux');
    fs.copyFileSync(process.execPath, lin);
    fs.chmodSync(lin, 0o755);
    run(`npx -y postject "${lin}" NODE_SEA_BLOB build/sea-prep.blob --sentinel-fuse ${SENTINEL}`);
    console.log(`✔ ${lin}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

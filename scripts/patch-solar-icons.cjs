const fs = require('fs');

const PKG_NAME = '@solar-icons/vue';
const EXPECTED_VERSION = '1.2.0';
const DIST_DIR = `node_modules/${PKG_NAME}/dist`;

const pkg = require(`${PKG_NAME}/package.json`);

if (pkg.version !== EXPECTED_VERSION) {
  console.warn(
    `[patch-solar-icons] VERSION CHANGED: expected ${EXPECTED_VERSION}, got ${pkg.version}. ` +
    `Patch may be outdated — review before proceeding.`
  );
}

const files = fs.readdirSync(DIST_DIR).filter(f => f.startsWith('weather-') && (f.endsWith('.mjs') || f.endsWith('.cjs')));

if (files.length === 0) {
  console.error(`[patch-solar-icons] FAILED: no weather- dist files found in ${DIST_DIR}`);
  process.exit(1);
}

const PATTERN = /(transform:)(\s*\w+\.value\?\`scale\(-1,\s*1\)\`\s*:\s*)\`none\`/g;

for (const file of files) {
  const filePath = `${DIST_DIR}/${file}`;
  let content = fs.readFileSync(filePath, 'utf8');
  const beforeContent = content;
  content = content.replace(PATTERN, '$1$2void 0');

  if (content === undefined) {
    console.error(`[patch-solar-icons] FAILED: could not read ${file}`);
    process.exit(1);
  }

  const remainingBogus = content.replaceAll('fill:`none`', '');
  if (remainingBogus.includes(':`none`')) {
    console.error(
      `[patch-solar-icons] FAILED: bogus \`none\` transform value still present in ${file}. ` +
      `Patch pattern may no longer match the bundled output.`
    );
    process.exit(1);
  }

  fs.writeFileSync(filePath, content, 'utf8');

  const changed = content !== beforeContent ? 'PATCHED' : 'already-ok';
  console.log(`[patch-solar-icons] ${file}: ${changed}`);
}

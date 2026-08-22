const fs = require('fs');
const path = require('path');

const packagePath = path.join(process.cwd(), 'package.json');
if (!fs.existsSync(packagePath)) process.exit(0);

let packageJson;
try { packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')); }
catch (error) {
  console.error('[catalog-guard] Invalid package.json: ' + error.message);
  process.exit(1);
}

const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const locations = [];
function collectObject(values, prefix) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return;
  for (const [name, version] of Object.entries(values)) {
    if (typeof version === 'string' && version.startsWith('catalog:')) {
      locations.push({ location: prefix + '.' + name, value: version, supported: true });
    }
  }
}

function collectNested(values, prefix) {
  if (!values || typeof values !== 'object') return;
  if (Array.isArray(values)) {
    values.forEach((value, index) => collectNested(value, `${prefix}.${index}`));
    return;
  }
  for (const [name, value] of Object.entries(values)) {
    const location = `${prefix}.${name}`;
    if (typeof value === 'string' && value.startsWith('catalog:')) {
      locations.push({ location, value, supported: false });
    } else {
      collectNested(value, location);
    }
  }
}

for (const section of sections) collectObject(packageJson[section], section);
collectNested(packageJson.overrides, 'overrides');
collectNested(packageJson.resolutions, 'resolutions');
if (packageJson.pnpm && typeof packageJson.pnpm === 'object') {
  collectNested(packageJson.pnpm.overrides, 'pnpm.overrides');
  collectNested(packageJson.pnpm.resolutions, 'pnpm.resolutions');
}

if (!locations.length) process.exit(0);

const unsupported = locations.filter(item => !item.supported);
if (unsupported.length) {
  console.error('\n[catalog-guard] DEPLOY BLOCKED: catalog references appear in unsupported override/resolution fields.');
  console.error('  ' + unsupported.map(item => item.location).join(', '));
  console.error('  Use a supported dependency section with the exact "catalog:" reference.\n');
  process.exit(1);
}

const named = locations.filter(item => item.value !== 'catalog:');
if (named.length) {
  console.error('\n[catalog-guard] DEPLOY BLOCKED: named catalog references are not supported by this workspace setup.');
  console.error('  ' + named.map(item => `${item.location} (${item.value})`).join(', '));
  console.error('  Use the default "catalog:" reference or an explicit SemVer range.\n');
  process.exit(1);
}

function findWorkspaceRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readCatalogNames(workspaceRoot) {
  const yamlPath = path.join(workspaceRoot, 'pnpm-workspace.yaml');
  let lines;
  try { lines = fs.readFileSync(yamlPath, 'utf8').split(/\r?\n/); }
  catch (error) { throw new Error('cannot read ' + yamlPath + ': ' + error.message); }

  const names = new Set();
  let inCatalog = false;
  for (const line of lines) {
    if (/^\s*catalog:\s*$/.test(line)) {
      inCatalog = true;
      continue;
    }
    if (!inCatalog) continue;
    if (/^\S/.test(line) && /^[^#\s][^:]*:/.test(line)) break;
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const match = line.match(/^\s+(?:"([^"]+)"|'([^']+)'|([^:\s]+))\s*:/);
    if (match) names.add(match[1] || match[2] || match[3]);
  }
  return names;
}

const workspaceRoot = findWorkspaceRoot(process.cwd());
if (!workspaceRoot) {
  console.error('\n[catalog-guard] DEPLOY BLOCKED: unresolved catalog references found in a standalone repository.');
  console.error('  ' + locations.join(', '));
  console.error('  Commit resolved SemVer values before deploying.\n');
  process.exit(1);
}

let catalogNames;
try { catalogNames = readCatalogNames(workspaceRoot); }
catch (error) {
  console.error('\n[catalog-guard] DEPLOY BLOCKED: workspace catalog could not be validated: ' + error.message + '\n');
  process.exit(1);
}

const unknown = locations.filter(location => {
  const prefix = location.location.slice(0, location.location.indexOf('.') + 1);
  const packageName = location.location.slice(prefix.length);
  return !catalogNames.has(packageName);
});
if (unknown.length) {
  console.error('\n[catalog-guard] DEPLOY BLOCKED: catalog references are not defined in the workspace catalog.');
  console.error('  ' + unknown.map(item => item.location).join(', '));
  process.exit(1);
}

// Valid local workspace catalog references are expected on disk.

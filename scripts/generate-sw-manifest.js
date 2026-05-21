/**
 * Genera webapp/sw-ui5-manifest.js con la lista delle risorse SAPUI5
 * da pre-cachare nel Service Worker per il self-hosting offline.
 *
 * Modalità:
 *  A) dist/resources/ esiste (post `ui5 build --all`)  → scansione filesystem
 *  B) dist/resources/ non esiste (sviluppo)            → deriva dai libs in ui5-local.yaml
 */

const fs   = require('fs');
const path = require('path');

const ROOT          = path.join(__dirname, '..');
const DIST_DIR      = path.join(ROOT, 'dist');
const RESOURCES_DIR = path.join(DIST_DIR, 'resources');
const yamlArg       = process.argv.find(a => a.startsWith('--yaml='));
const YAML_PATH     = yamlArg ? path.join(ROOT, yamlArg.split('=')[1]) : path.join(ROOT, 'ui5-local.yaml');
const WEBAPP_OUT    = path.join(ROOT, 'webapp', 'sw-ui5-manifest.js');
const DIST_OUT      = path.join(DIST_DIR, 'sw-ui5-manifest.js');

// ─── MODALITÀ A: scansiona dist/resources/ ────────────────────────────────────

// Pattern dei bundle essenziali. Aggiungi qui se servono altre lib.
const SELECTIVE = [
    /^\/resources\/sap-ui-core(-preload)?\.js$/,
    /\/library-preload\.js$/,
    /\/library-preload\.json$/,
    /\/themes\/[\w-]+\/library(-RTL)?\.css$/,
    /\/themes\/[\w-]+\/library-parameters\.json$/,
    /\/themes\/[\w-]+\/.*\.(woff2?|ttf)$/,
    /\/messagebundle.*\.properties$/,
    /\/i18n.*\.properties$/
];

function scanDist(dir, baseDir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...scanDist(full, baseDir));
        } else {
            const url = '/' + path.relative(baseDir, full).replace(/\\/g, '/');
            if (SELECTIVE.some(p => p.test(url))) results.push(url);
        }
    }
    return results;
}

// ─── MODALITÀ B: deriva dai libs in ui5-local.yaml ────────────────────────────

function parseYamlLibraries(yaml) {
    const frameworkBlock = yaml.match(/^framework:[\s\S]*?(?=^\S|\Z)/m)?.[0] || '';
    return (frameworkBlock.match(/- name:\s+(\S+)/g) || [])
        .map(m => m.replace(/- name:\s+/, '').trim());
}

function parseTheme(libraries) {
    const themeLib = libraries.find(l => l.startsWith('themelib_'));
    return themeLib ? themeLib.replace('themelib_', '') : 'sap_horizon';
}

function generateFromConfig() {
    if (!fs.existsSync(YAML_PATH)) {
        console.error('[sw-manifest] ERRORE: ui5-local.yaml non trovato.');
        process.exit(1);
    }
    const yaml      = fs.readFileSync(YAML_PATH, 'utf8');
    const libraries = parseYamlLibraries(yaml);
    const theme     = parseTheme(libraries);

    // Core sempre richiesto
    const files = [
        '/resources/sap-ui-core.js'
    ];

    // Per ogni libreria di codice (non themelib) carichiamo:
    //  - library-preload.js  (bundle JS della lib)
    //  - library.css         (CSS del tema attivo per quella lib)
    //  - library-parameters.json (parametri tema usati a runtime)
    for (const lib of libraries) {
        if (lib.startsWith('themelib_')) continue;
        const libPath = lib.replace(/\./g, '/');
        files.push(`/resources/${libPath}/library-preload.js`);
        files.push(`/resources/${libPath}/themes/${theme}/library.css`);
        files.push(`/resources/${libPath}/themes/${theme}/library-parameters.json`);
    }

    // sap.ui.core ha anche un base CSS separato dal tema
    files.push(`/resources/sap/ui/core/themes/base/library-parameters.json`);

    console.log(`[sw-manifest] modalità DEV — librerie: ${libraries.join(', ')} | tema: ${theme}`);
    return { files, source: `ui5-local.yaml (tema: ${theme})` };
}

// ─── MODALITÀ C: CDN → manifest vuoto, la cache avviene dinamicamente dal SW ──

function generateEmpty() {
    console.log('[sw-manifest] CDN mode — manifest vuoto, SAPUI5 sarà cachato dinamicamente dal SW');
    return { files: [], source: 'CDN mode (cache dinamica)' };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

const isCDN = process.argv.includes('--cdn');

let ui5Files, source;

if (isCDN) {
    ({ files: ui5Files, source } = generateEmpty());
} else if (fs.existsSync(RESOURCES_DIR)) {
    ui5Files = scanDist(RESOURCES_DIR, DIST_DIR);
    source   = 'dist/resources/ (build produzione)';
} else {
    ({ files: ui5Files, source } = generateFromConfig());
}

// Deduplica
ui5Files = [...new Set(ui5Files)];

const content = [
    '// Auto-generato da scripts/generate-sw-manifest.js — non modificare a mano',
    `// Fonte: ${source} — ${new Date().toISOString()}`,
    `self.UI5_PRE_CACHE = ${JSON.stringify(ui5Files, null, 2)};`,
    ''
].join('\n');

// Assicura che la dir webapp esista
const webappDir = path.dirname(WEBAPP_OUT);
if (!fs.existsSync(webappDir)) fs.mkdirSync(webappDir, { recursive: true });

fs.writeFileSync(WEBAPP_OUT, content, 'utf8');
if (fs.existsSync(DIST_DIR)) fs.writeFileSync(DIST_OUT, content, 'utf8');

console.log(`[sw-manifest] ${ui5Files.length} risorse UI5 selezionate per pre-cache:`);
ui5Files.forEach(f => console.log('  ', f));

import { basename, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import { Project } from 'ts-morph';

import { PLUGIN_STUB_QUERY } from './plugin-loader.mjs';

// HACK: DO NOT USE @ ALIAS IN THIS FILE, IT WILL CAUSE PROBLEMS
import { Platform } from '../src/types/plugins';

const kebabToCamel = (text: string) =>
  text.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());

const __dirname = dirname(fileURLToPath(import.meta.url));
const globalProject = new Project({
  tsConfigFilePath: resolve(__dirname, '..', 'tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
  skipLoadingLibFiles: true,
  skipFileDependencyResolution: true,
});

export const pluginVirtualModuleGenerator = (
  mode: 'main' | 'preload' | 'renderer',
) => {
  const srcPath = resolve(__dirname, '..', 'src');
  const plugins = globSync([
    'src/plugins/*/index.{js,ts,jsx,tsx}',
    'src/plugins/*.{js,ts,jsx,tsx}',
    '!src/plugins/utils/**/*',
    '!src/plugins/utils/*',
  ]).map((path) => {
    let name = basename(path);
    if (
      name === 'index.ts' ||
      name === 'index.js' ||
      name === 'index.jsx' ||
      name === 'index.tsx'
    ) {
      name = basename(resolve(path, '..'));
    }

    name = name.replace(extname(name), '');

    return { name, path };
  });

  const src = globalProject.createSourceFile(
    'vm:pluginIndexes',
    (writer) => {
      for (const { name, path } of plugins) {
        const absolutePath = resolve(srcPath, '..', path).replace(/\\/g, '/');
        if (mode === 'main') {
          // dynamic import (for main)
          // The full module (with backend & menu) is only imported on demand,
          // e.g. for enabled plugins. The stub module (metadata & config only,
          // see plugin-loader) is what `allPlugins()` imports eagerly.
          writer.writeLine(
            `const ${kebabToCamel(name)}PluginImport = () => import('${absolutePath}');`,
          );
          writer.writeLine(
            `const ${kebabToCamel(name)}PluginStubImport = () => import('${absolutePath}?${PLUGIN_STUB_QUERY}');`,
          );
          writer.writeLine(
            `const ${kebabToCamel(name)}Plugin = async () => (await ${kebabToCamel(name)}PluginImport()).default;`,
          );
          writer.writeLine(
            `const ${kebabToCamel(name)}PluginStub = async () => (await ${kebabToCamel(name)}PluginStubImport()).pluginStub;`,
          );
          writer.writeLine(
            `const ${kebabToCamel(name)}PluginHasBackend = async () => (await ${kebabToCamel(name)}PluginStubImport()).pluginHasBackend !== false;`,
          );
        } else {
          // static import (preload does not support dynamic import)
          writer.writeLine(
            `import ${kebabToCamel(name)}PluginImport, { pluginStub as ${kebabToCamel(name)}PluginStubImport } from "${absolutePath}";`,
          );
          writer.writeLine(
            `const ${kebabToCamel(name)}Plugin = () => Promise.resolve(${kebabToCamel(name)}PluginImport);`,
          );
          writer.writeLine(
            `const ${kebabToCamel(name)}PluginStub = () => Promise.resolve(${kebabToCamel(name)}PluginStubImport);`,
          );
        }
      }

      writer.blankLine();
      if (mode === 'main' || mode === 'preload') {
        writer.writeLine("import is from 'electron-is';");
        writer.writeLine('globalThis.electronIs = is;');
      }
      writer.write(supportsPlatform.toString());
      writer.blankLine();

      // Context-specific exports
      writer.writeLine(`let ${mode}PluginsCache = null;`);
      writer.writeLine(`export const ${mode}Plugins = async () => {`);
      writer.writeLine(
        `  if (${mode}PluginsCache) return await ${mode}PluginsCache;`,
      );
      writer.writeLine(
        '  const { promise, resolve } = Promise.withResolvers();',
      );
      writer.writeLine('  ' + `${mode}PluginsCache = promise;`);
      writer.writeLine('  const pluginEntries = await Promise.all([');
      for (const { name } of plugins) {
        const checkMode = mode === 'main' ? 'backend' : mode;
        // HACK: To avoid situation like importing renderer plugins in main
        writer.writeLine(
          `    ${kebabToCamel(name)}Plugin().then((plg) => plg['${checkMode}'] ? ["${name}", plg] : null),`,
        );
      }
      writer.writeLine('  ]);');
      writer.writeLine(
        '  resolve(pluginEntries.filter((entry) => entry && supportsPlatform(entry[1])).reduce((acc, [name, plg]) => { acc[name] = plg; return acc; }, {}));',
      );
      writer.writeLine(`  return await ${mode}PluginsCache;`);
      writer.writeLine('};');
      writer.blankLine();

      // All plugins export (stub only) // Omit<Plugin, 'backend' | 'preload' | 'renderer'>
      writer.writeLine('let allPluginsCache = null;');
      writer.writeLine('export const allPlugins = async () => {');
      writer.writeLine('  if (allPluginsCache) return await allPluginsCache;');
      writer.writeLine(
        '  const { promise, resolve } = Promise.withResolvers();',
      );
      writer.writeLine('  allPluginsCache = promise;');
      writer.writeLine('  const stubEntries = await Promise.all([');
      for (const { name } of plugins) {
        writer.writeLine(
          `    ${kebabToCamel(name)}PluginStub().then((stub) => ["${name}", stub]),`,
        );
      }
      writer.writeLine('  ]);');
      writer.writeLine(
        '  resolve(stubEntries.filter(entry => entry && supportsPlatform(entry[1])).reduce((acc, [name, plg]) => { acc[name] = plg; return acc; }, {}));',
      );
      writer.writeLine('  return await promise;');
      writer.writeLine('};');
      writer.blankLine();

      if (mode === 'main') {
        // Lazy, per-plugin access to the full plugin (backend & menu), so only
        // the plugins that are actually used get their backend imported
        writer.writeLine('const fullPluginLoaders = {');
        for (const { name } of plugins) {
          writer.writeLine(`  "${name}": ${kebabToCamel(name)}Plugin,`);
        }
        writer.writeLine('};');
        writer.writeLine('const backendFlagLoaders = {');
        for (const { name } of plugins) {
          writer.writeLine(`  "${name}": ${kebabToCamel(name)}PluginHasBackend,`);
        }
        writer.writeLine('};');
        writer.blankLine();

        writer.writeLine('export const fullPlugin = async (id) => {');
        writer.writeLine('  if (!Object.hasOwn(fullPluginLoaders, id)) return undefined;');
        writer.writeLine('  const plg = await fullPluginLoaders[id]();');
        writer.writeLine('  return plg && supportsPlatform(plg) ? plg : undefined;');
        writer.writeLine('};');
        writer.blankLine();

        writer.writeLine('export const mainPlugin = async (id) => {');
        writer.writeLine('  if (!Object.hasOwn(backendFlagLoaders, id)) return undefined;');
        writer.writeLine('  if (!(await backendFlagLoaders[id]())) return undefined;');
        writer.writeLine('  const plg = await fullPlugin(id);');
        writer.writeLine("  return plg && plg['backend'] ? plg : undefined;");
        writer.writeLine('};');
        writer.blankLine();

        writer.writeLine('export const mainPluginNames = async () => {');
        writer.writeLine('  const stubs = await allPlugins();');
        writer.writeLine('  const flags = await Promise.all(');
        writer.writeLine(
          '    Object.keys(stubs).map(async (id) => [id, await backendFlagLoaders[id]()]),',
        );
        writer.writeLine('  );');
        writer.writeLine(
          '  return flags.filter(([, hasBackend]) => hasBackend).map(([id]) => id);',
        );
        writer.writeLine('};');
        writer.blankLine();
      }
    },
    { overwrite: true },
  );

  return src.getText();
};

function supportsPlatform({ platform }: { platform: string }) {
  if (typeof platform !== 'number') return true;

  const is = (globalThis as typeof globalThis & {
    electronIs: typeof import('electron-is');
  }).electronIs;

  if (is.windows()) return (platform & Platform.Windows) !== 0;
  if (is.macOS()) return (platform & Platform.macOS) !== 0;
  if (is.linux()) return (platform & Platform.Linux) !== 0;
  if (is.freebsd()) return (platform & Platform.Freebsd) !== 0;

  // unknown platform
  return false;
}

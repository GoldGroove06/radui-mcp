#!/usr/bin/env node
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import path from 'path';
import url from 'url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
const traverse = traverseModule.default || traverseModule;

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCS_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const COMPONENTS_DIR = path.join(DOCS_ROOT, 'app', 'docs', 'components');

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function extractMatches(regex, text) {
  const out = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

async function readDirNames(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => e.name);
}

function evaluate(node, env, source) {
  if (!node) return undefined;
  switch (node.type) {
    case 'ObjectExpression':
      return Object.fromEntries(
        node.properties.map(p => {
          if (p.type !== 'ObjectProperty') return [null, null];
          const key = p.key.type === 'Identifier' ? p.key.name : p.key.value;
          return [key, evaluate(p.value, env, source)];
        }).filter(([k]) => k !== null)
      );
    case 'ArrayExpression':
      return node.elements.map(el => evaluate(el, env, source));
    case 'StringLiteral':
      return node.value;
    case 'NumericLiteral':
      return node.value;
    case 'BooleanLiteral':
      return node.value;
    case 'NullLiteral':
      return null;
    case 'Identifier':
      return env[node.name];
    case 'TemplateLiteral':
      return node.quasis.map((q, i) => {
        const expr = node.expressions[i];
        return q.value.cooked + (expr ? String(evaluate(expr, env, source)) : '');
      }).join('');
    case 'JSXElement':
    case 'JSXFragment':
      if (typeof node.start === 'number' && typeof node.end === 'number' && typeof source === 'string') {
        return source.slice(node.start, node.end);
      }
      return undefined;
    default:
      return undefined;
  }
}

async function generateForComponent(componentName) {
  const componentDir = path.join(COMPONENTS_DIR, componentName);
  const codeUsagePath = path.join(componentDir, 'docs', 'codeUsage.js');
  const hasCodeUsage = await fileExists(codeUsagePath);

  const result = {
    component: componentName,
    codeUsagePath: path.relative(DOCS_ROOT, codeUsagePath).replace(/\\/g, '/'),
    exports: {},
    notes: []
  };

  if (!hasCodeUsage) {
    result.notes.push('codeUsage.js not found');
  } else {
    const content = await fs.readFile(codeUsagePath, 'utf8');

    // Parse with Babel
    const ast = parse(content, {
      sourceType: 'module',
      plugins: ['jsx', 'topLevelAwait']
    });

    // Build environment of variables that can be resolved statically
    const env = {};

    // Resolve imports from ./component_api to concrete objects
    traverse(ast, {
      ImportDeclaration(pathImp) {
        const src = pathImp.node.source.value;
        if (!src.startsWith('./component_api/')) return;
        const localSpecs = pathImp.node.specifiers.filter(s => s.type === 'ImportDefaultSpecifier' || s.type === 'ImportSpecifier');
        const apiFile = path.join(componentDir, 'docs', 'component_api', src.replace('./component_api/', ''));
        try {
          const apiCode = fsSync.readFileSync(apiFile, 'utf8');
          const apiAst = parse(apiCode, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
          // Find const data = { ... } and/or default export
          let dataNode = undefined;
          traverse(apiAst, {
            VariableDeclarator(p) {
              if (p.node.id.type === 'Identifier' && p.node.id.name === 'data' && p.node.init && p.node.init.type === 'ObjectExpression') {
                dataNode = p.node.init;
              }
            }
          });
          const value = dataNode ? evaluate(dataNode, {}, apiCode) : undefined;
          for (const s of localSpecs) {
            const localName = s.local.name;
            env[localName] = value;
          }
        } catch {
          // ignore if not found
        }
      }
    });

    traverse(ast, {
      VariableDeclarator(pathVar) {
        const id = pathVar.node.id;
        const init = pathVar.node.init;
        if (id.type !== 'Identifier' || !init) return;
        // const x = await getSourceCodeFromPath('...')
        if (
          init.type === 'AwaitExpression' &&
          init.argument &&
          init.argument.type === 'CallExpression' &&
          init.argument.callee.type === 'Identifier' &&
          init.argument.callee.name === 'getSourceCodeFromPath' &&
          init.argument.arguments.length === 1 &&
          init.argument.arguments[0].type === 'StringLiteral'
        ) {
          const rel = init.argument.arguments[0].value;
          env[id.name] = undefined; // placeholder; will fill below
          pathVar.skip();
        } else {
          const val = evaluate(init, env, content);
          if (val !== undefined) env[id.name] = val;
        }
      }
    });

    // Second pass: fill in awaited source contents
    // Map variable names to paths
    const varPathRegex = /const\s+([A-Za-z0-9_]+)\s*=\s*await\s+getSourceCodeFromPath\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
    let mm;
    while ((mm = varPathRegex.exec(content)) !== null) {
      const vname = mm[1];
      const rel = mm[2];
      try {
        let abs = path.join(DOCS_ROOT, rel);
        if (!fsSync.existsSync(abs)) {
          abs = path.join(PROJECT_ROOT, rel);
        }
        env[vname] = fsSync.readFileSync(abs, 'utf8');
      } catch {
        env[vname] = undefined;
      }
    }

    // Collect exported consts and evaluate them to JSON-friendly values
    traverse(ast, {
      ExportNamedDeclaration(pathExp) {
        const decl = pathExp.node.declaration;
        if (!decl || decl.type !== 'VariableDeclaration') return;
        for (const d of decl.declarations) {
          if (d.id.type !== 'Identifier') continue;
          const name = d.id.name;
          const value = evaluate(d.init, env, content);
          if (value !== undefined) {
            result.exports[name] = value;
          }
          // Special handling to ensure code export inlines nested language.code properly
          if (name === 'code' && d.init && d.init.type === 'ObjectExpression') {
            const rebuilt = {};
            for (const langProp of d.init.properties) {
              if (langProp.type !== 'ObjectProperty') continue;
              const langKey = langProp.key.type === 'Identifier' ? langProp.key.name : langProp.key.value;
              const langVal = langProp.value;
              if (langVal && langVal.type === 'ObjectExpression') {
                for (const inner of langVal.properties) {
                  if (inner.type === 'ObjectProperty') {
                    const innerKey = inner.key.type === 'Identifier' ? inner.key.name : inner.key.value;
                    if (innerKey === 'code') {
                      const evaluated = evaluate(inner.value, env, content);
                      rebuilt[langKey] = { code: evaluated };
                    }
                  }
                }
              }
            }
            if (Object.keys(rebuilt).length) {
              result.exports.code = rebuilt;
            }
          }
        }
      },
      ExportDefaultDeclaration(pathDef) {
        const def = pathDef.node.declaration;
        if (def.type === 'Identifier' && result.exports[def.name] !== undefined) {
          result.exports.default = result.exports[def.name];
        } else {
          const val = evaluate(def, env, content);
          if (val !== undefined) result.exports.default = val;
        }
      }
    });

    // If default is still missing but there is an exported 'code', set default = code
    if (result.exports.default === undefined && result.exports.code !== undefined) {
      result.exports.default = result.exports.code;
    }
  }

  const outPath = path.join(componentDir, 'mcp.json');
  await fs.writeFile(outPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  return { component: componentName, outPath };
}

async function run() {
  const [, , cmd] = process.argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log('Usage: npm run mcp:run');
    process.exit(0);
  }

  if (cmd !== 'run') {
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
  }

  if (!(await fileExists(COMPONENTS_DIR))) {
    console.error(`Components directory not found at: ${COMPONENTS_DIR}`);
    process.exit(1);
  }

  const componentNames = await readDirNames(COMPONENTS_DIR);
  const results = [];
  for (const name of componentNames) {
    try {
      const res = await generateForComponent(name);
      results.push(res);
    } catch (err) {
      console.error(`Failed for component ${name}:`, err.message);
    }
  }

  console.log(`Generated mcp.json for ${results.length} component(s).`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});



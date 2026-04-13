#!/usr/bin/env node
import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default || traverseModule;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const args = parseArgs(process.argv.slice(2));
const docsRoot = path.resolve(projectRoot, args.docsRoot ?? "docs");
const componentsDir = path.join(docsRoot, "app", "docs", "components");
const installationDocPath = path.join(docsRoot, "app", "docs", "first-steps", "installation", "content.mdx");
const outputPath = path.resolve(projectRoot, args.output ?? "mcp.json");

function parseArgs(argv) {
  const parsed = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--output" || arg === "-o") {
      parsed.output = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith("--output=")) {
      parsed.output = arg.slice("--output=".length);
      continue;
    }

    if (arg === "--docs-root") {
      parsed.docsRoot = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith("--docs-root=")) {
      parsed.docsRoot = arg.slice("--docs-root=".length);
    }
  }

  return parsed;
}

function normalizeSlashes(value) {
  return String(value).replace(/\\/g, "/");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readDirNames(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function evaluate(node, env, source) {
  if (!node) return undefined;

  switch (node.type) {
    case "ObjectExpression":
      return Object.fromEntries(
        node.properties
          .map((prop) => {
            if (prop.type !== "ObjectProperty") return [null, null];
            const key = prop.key.type === "Identifier" ? prop.key.name : prop.key.value;
            return [key, evaluate(prop.value, env, source)];
          })
          .filter(([key]) => key !== null)
      );

    case "ArrayExpression":
      return node.elements.map((element) => evaluate(element, env, source));

    case "StringLiteral":
      return node.value;

    case "NumericLiteral":
      return node.value;

    case "BooleanLiteral":
      return node.value;

    case "NullLiteral":
      return null;

    case "Identifier":
      return env[node.name];

    case "TemplateLiteral": {
      return node.quasis
        .map((quasi, index) => {
          const expression = node.expressions[index];
          return quasi.value.cooked + (expression ? String(evaluate(expression, env, source)) : "");
        })
        .join("");
    }

    case "JSXElement":
    case "JSXFragment":
      if (typeof node.start === "number" && typeof node.end === "number" && typeof source === "string") {
        return source.slice(node.start, node.end);
      }
      return undefined;

    default:
      return undefined;
  }
}

async function generateForComponent(componentName) {
  const componentDir = path.join(componentsDir, componentName);
  const codeUsagePath = path.join(componentDir, "docs", "codeUsage.js");
  const result = {
    component: componentName,
    exports: {},
    notes: []
  };

  if (!(await fileExists(codeUsagePath))) {
    result.notes.push("codeUsage.js not found");
    return result;
  }

  const codeUsageSource = await fs.readFile(codeUsagePath, "utf8");
  const ast = parse(codeUsageSource, {
    sourceType: "module",
    plugins: ["jsx", "topLevelAwait"]
  });

  const env = {};

  traverse(ast, {
    ImportDeclaration(pathImp) {
      const sourceValue = pathImp.node.source.value;
      if (!sourceValue.startsWith("./component_api/")) return;

      const localSpecifiers = pathImp.node.specifiers.filter(
        (spec) => spec.type === "ImportDefaultSpecifier" || spec.type === "ImportSpecifier"
      );

      const apiFilePath = path.join(componentDir, "docs", "component_api", sourceValue.replace("./component_api/", ""));

      try {
        const apiCode = fsSync.readFileSync(apiFilePath, "utf8");
        const apiAst = parse(apiCode, { sourceType: "module", plugins: ["jsx", "typescript"] });
        let dataNode;

        traverse(apiAst, {
          VariableDeclarator(variablePath) {
            if (
              variablePath.node.id.type === "Identifier" &&
              variablePath.node.id.name === "data" &&
              variablePath.node.init &&
              variablePath.node.init.type === "ObjectExpression"
            ) {
              dataNode = variablePath.node.init;
            }
          }
        });

        const evaluatedData = dataNode ? evaluate(dataNode, {}, apiCode) : undefined;
        for (const specifier of localSpecifiers) {
          env[specifier.local.name] = evaluatedData;
        }
      } catch {
        // Ignore missing/unreadable component_api files.
      }
    }
  });

  traverse(ast, {
    VariableDeclarator(variablePath) {
      const id = variablePath.node.id;
      const init = variablePath.node.init;
      if (id.type !== "Identifier" || !init) return;

      if (
        init.type === "AwaitExpression" &&
        init.argument &&
        init.argument.type === "CallExpression" &&
        init.argument.callee.type === "Identifier" &&
        init.argument.callee.name === "getSourceCodeFromPath" &&
        init.argument.arguments.length === 1 &&
        init.argument.arguments[0].type === "StringLiteral"
      ) {
        env[id.name] = undefined;
        variablePath.skip();
      } else {
        const evaluated = evaluate(init, env, codeUsageSource);
        if (evaluated !== undefined) env[id.name] = evaluated;
      }
    }
  });

  const sourceCodeCallRegex = /const\s+([A-Za-z0-9_]+)\s*=\s*await\s+getSourceCodeFromPath\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  let match;
  while ((match = sourceCodeCallRegex.exec(codeUsageSource)) !== null) {
    const variableName = match[1];
    const relPath = match[2];

    try {
      let absolute = path.join(docsRoot, relPath);
      if (!fsSync.existsSync(absolute)) {
        absolute = path.join(projectRoot, relPath);
      }
      env[variableName] = fsSync.readFileSync(absolute, "utf8");
    } catch {
      env[variableName] = undefined;
    }
  }

  traverse(ast, {
    ExportNamedDeclaration(exportPath) {
      const declaration = exportPath.node.declaration;
      if (!declaration || declaration.type !== "VariableDeclaration") return;

      for (const declarator of declaration.declarations) {
        if (declarator.id.type !== "Identifier") continue;

        const exportName = declarator.id.name;
        const value = evaluate(declarator.init, env, codeUsageSource);
        if (value !== undefined) {
          result.exports[exportName] = value;
        }

        if (exportName === "code" && declarator.init && declarator.init.type === "ObjectExpression") {
          const rebuiltCode = {};
          for (const languageProp of declarator.init.properties) {
            if (languageProp.type !== "ObjectProperty") continue;
            const languageName = languageProp.key.type === "Identifier" ? languageProp.key.name : languageProp.key.value;
            const languageValue = languageProp.value;

            if (languageValue && languageValue.type === "ObjectExpression") {
              for (const innerProp of languageValue.properties) {
                if (innerProp.type !== "ObjectProperty") continue;
                const innerName = innerProp.key.type === "Identifier" ? innerProp.key.name : innerProp.key.value;
                if (innerName !== "code") continue;

                rebuiltCode[languageName] = { code: evaluate(innerProp.value, env, codeUsageSource) };
              }
            }
          }

          if (Object.keys(rebuiltCode).length > 0) {
            result.exports.code = rebuiltCode;
          }
        }
      }
    },

    ExportDefaultDeclaration(exportPath) {
      const declaration = exportPath.node.declaration;
      if (declaration.type === "Identifier" && result.exports[declaration.name] !== undefined) {
        result.exports.default = result.exports[declaration.name];
      } else {
        const value = evaluate(declaration, env, codeUsageSource);
        if (value !== undefined) result.exports.default = value;
      }
    }
  });

  if (result.exports.default === undefined && result.exports.code !== undefined) {
    result.exports.default = result.exports.code;
  }

  return result;
}

function extractInstallMethods(content) {
  const methods = [];
  const codeBlocks = [...content.matchAll(/```(?:bash|sh|zsh)?\s*([\s\S]*?)```/g)];

  for (const match of codeBlocks) {
    const command = String(match[1] ?? "").trim();
    if (!command) continue;

    let manager = "unknown";
    if (command.startsWith("npm ")) manager = "npm";
    if (command.startsWith("pnpm ")) manager = "pnpm";
    if (command.startsWith("yarn ")) manager = "yarn";
    if (command.startsWith("bun ")) manager = "bun";

    methods.push({ manager, command });
  }

  if (!methods.length) {
    const inline = content.match(/\bnpm\s+install\s+@radui\/ui\b[^\n]*/i);
    if (inline?.[0]) {
      methods.push({ manager: "npm", command: inline[0].trim() });
    }
  }

  return methods;
}

async function generateInstallation() {
  if (!(await fileExists(installationDocPath))) {
    return {
      package: "@radui/ui",
      title: "Installation",
      methods: [{ manager: "npm", command: "npm install @radui/ui --save" }],
      content: "Install Rad UI with your package manager.",
      notes: ["installation content.mdx not found in docs"]
    };
  }

  const content = await fs.readFile(installationDocPath, "utf8");
  const headingMatch = content.match(/^#\s+(.+)$/m);
  const title = headingMatch?.[1]?.trim() || "Installation";
  const methods = extractInstallMethods(content);

  return {
    package: "@radui/ui",
    title,
    methods,
    content: content.trim(),
    notes: []
  };
}

async function run() {
  if (!(await fileExists(componentsDir))) {
    throw new Error(`Components directory not found at: ${componentsDir}`);
  }

  const componentNames = (await readDirNames(componentsDir)).sort((a, b) => a.localeCompare(b));
  const components = [];

  for (const componentName of componentNames) {
    try {
      const componentData = await generateForComponent(componentName);
      components.push(componentData);
    } catch (error) {
      components.push({
        component: componentName,
        exports: {},
        notes: [String(error.message || error)]
      });
    }
  }

  const installation = await generateInstallation();

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    installation,
    componentCount: components.length,
    components
  };

  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const outputDisplay = normalizeSlashes(path.relative(projectRoot, outputPath) || "mcp.json");
  console.log(`Generated ${payload.componentCount} component records into ${outputDisplay}`);
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

/**
 * Lets the Node test runner resolve imports the way TypeScript does.
 *
 * Two things Node does not do on its own: the project's "@/..." alias, which
 * lives in tsconfig.json, and extensionless relative imports like "./types".
 * Handling both here keeps the source free to be written normally and the
 * test suite free of dependencies.
 */
const SRC = new URL("../src/", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return {
      url: `${SRC}${specifier.slice(2)}.ts`,
      shortCircuit: true,
      format: "module-typescript",
    };
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const extensionless = /^\.{1,2}\//.test(specifier) && !/\.[a-z]+$/i.test(specifier);
    if (error?.code === "ERR_MODULE_NOT_FOUND" && extensionless) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}

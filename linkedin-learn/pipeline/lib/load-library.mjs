/* Load window.LIBRARY out of site/data/library.js without a browser, by running
   it in a VM with a fake window. Returns the library object. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LIBRARY_JS = path.join(__dirname, "..", "..", "site", "data", "library.js");
export const LIBRARY_JSON = path.join(__dirname, "..", "..", "site", "data", "library.json");

export function loadLibraryFromJs(file = LIBRARY_JS) {
  const code = fs.readFileSync(file, "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "library.js", timeout: 2000 });
  if (!sandbox.window.LIBRARY) throw new Error("library.js did not set window.LIBRARY");
  return sandbox.window.LIBRARY;
}

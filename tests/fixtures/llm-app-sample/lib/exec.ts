import * as child_process from 'node:child_process';
import vm from 'node:vm';

// code-exec surfaces: dynamic code construction, shell, and a VM context.
export function runUntrusted(code: string, cmd: string) {
  const fn = new Function('return ' + code);     // new Function — code-exec
  eval(code);                                     // eval — code-exec
  child_process.exec(cmd);                        // child_process.exec — code-exec
  return vm.runInNewContext(code);                // vm.runInNewContext — code-exec + fn()
}

// sandbox surfaces: a Pyodide runtime and a worker boundary.
export async function sandboxRun(src: string) {
  const pyodide = await loadPyodide();            // loadPyodide — sandbox
  const worker = new Worker('./w.js');            // new Worker — sandbox
  await pyodide.runPythonAsync(src);              // runPythonAsync — sandbox
  return worker;
}

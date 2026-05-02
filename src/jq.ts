import { spawn } from 'node:child_process';

export type JqResult = { stdout: string; stderr: string };

export async function runJq(filter: string, input: string, args: string[] = []): Promise<JqResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('jq', [...args, filter], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`jq exited ${code}: ${stderr}`));
    });
    child.stdin.end(input);
  });
}

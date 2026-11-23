import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface ScanFinding {
  ruleId: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  confidence: 'high' | 'medium' | 'low';
  file: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
  snippet: string;
  evidence?: string[];
  help?: string;
}

export interface ScanPayload {
  tool: string;
  version?: string;
  reportRoot?: string;
  findings: ScanFinding[];
  stats?: { files: number };
}

export interface DiagnosticSpec {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  ruleId: string;
  confidence: string;
}

export function parseScanPayload(stdout: string): ScanPayload {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error('slopgate returned no JSON');
  const start = trimmed.indexOf('{');
  if (start < 0) throw new Error('slopgate output did not contain a JSON object');
  const payload = JSON.parse(trimmed.slice(start)) as Partial<ScanPayload>;
  if (!Array.isArray(payload.findings)) throw new Error('slopgate payload has no findings array');
  return { ...payload, findings: payload.findings, tool: payload.tool ?? 'slopgate' };
}

export function buildScanArgs(
  target: string,
  options: { confidence: string; failOn: string },
  mode: 'scan' | 'fix' = 'scan',
): string[] {
  const args = [
    target,
    '--format',
    'json',
    '--confidence',
    options.confidence,
    '--fail-on',
    options.failOn,
    '--no-color',
  ];
  if (mode === 'fix') args.push('--fix');
  return args;
}

export function toDiagnostic(finding: ScanFinding): DiagnosticSpec {
  const evidence = finding.evidence ?? [];
  const details = [...evidence, finding.help].filter((value): value is string => Boolean(value));
  return {
    file: finding.file,
    line: finding.start.line,
    column: finding.start.column,
    endLine: finding.end.line,
    endColumn: finding.end.column,
    severity: finding.severity,
    ruleId: finding.ruleId,
    confidence: finding.confidence,
    message:
      `${finding.message} [${finding.ruleId}, ${finding.confidence} confidence]` +
      (details.length > 0 ? `\n${details.join('\n')}` : ''),
  };
}

export function isFixableRule(ruleId: string): boolean {
  return ruleId === 'py/unreachable' || ruleId === 'ts/unreachable';
}

export async function runSlopgate(
  executable: string,
  args: readonly string[],
  cwd: string,
): Promise<ScanPayload> {
  try {
    const { stdout } = await exec(executable, [...args], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      // npm exposes `slopgate.cmd` on Windows; execFile cannot launch a .cmd
      // shim without a shell.
      shell: process.platform === 'win32',
    });
    return parseScanPayload(stdout);
  } catch (error) {
    // `slopgate` exits 1 when findings exist; the JSON payload is still on stdout.
    const stdout = (error as { stdout?: string }).stdout ?? '';
    if (stdout.trim().length > 0) return parseScanPayload(stdout);
    throw new Error((error as Error).message);
  }
}

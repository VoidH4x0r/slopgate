import type { Finding, ScanStats } from '../types.ts';

export interface PrettyInput {
  findings: readonly Finding[];
  stats: ScanStats;
  suppressedByComment: number;
  baselined: number;
  hiddenByConfidence: number;
  version: string;
  color: boolean;
  quiet?: boolean;
}

function ansi(enabled: boolean, code: string): (text: string) => string {
  return (text: string) => (enabled ? `\u001b[${code}m${text}\u001b[0m` : text);
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

const LOC_WIDTH = 8;
const SEV_WIDTH = 7;
const CONF_WIDTH = 6;
const RULE_WIDTH = 23;
const GUTTER = ' '.repeat(LOC_WIDTH + 2);

export function renderPretty(input: PrettyInput): string {
  const { findings, stats, version, color } = input;
  const bold = ansi(color, '1');
  const dim = ansi(color, '2');
  const red = ansi(color, '31');
  const yellow = ansi(color, '33');
  const cyan = ansi(color, '36');
  const green = ansi(color, '32');

  const out: string[] = [];
  out.push('');
  out.push(`${bold('slopgate')} ${dim(version)}  ${dim('·')}  ${stats.files} files  ${dim('·')}  ${stats.durationMs}ms`);
  out.push('');

  if (findings.length === 0) {
    out.push(`  ${green('✓')} no findings above the confidence threshold`);
    out.push('');
  }

  let currentFile: string | undefined;
  if (!input.quiet) {
    for (const finding of findings) {
      if (finding.file !== currentFile) {
        if (currentFile !== undefined) out.push('');
        out.push(cyan(finding.file));
        currentFile = finding.file;
      }

      const location = `${finding.start.line}:${finding.start.column}`.padStart(LOC_WIDTH);
      const severity =
        finding.severity === 'error'
          ? red(finding.severity.padEnd(SEV_WIDTH))
          : finding.severity === 'warning'
            ? yellow(finding.severity.padEnd(SEV_WIDTH))
            : dim(finding.severity.padEnd(SEV_WIDTH));
      const confidence = dim(finding.confidence.padEnd(CONF_WIDTH));
      const rule = dim(finding.ruleId.padEnd(RULE_WIDTH));
      out.push(`  ${location}  ${severity} ${confidence} ${rule} ${finding.message}`);
      if (finding.snippet) {
        out.push(`${GUTTER}  ${dim('│ ' + finding.snippet)}`);
      }
      for (const item of finding.evidence.slice(0, 2)) {
        out.push(`${GUTTER}  ${dim('· ' + item)}`);
      }
      if (finding.help) {
        const lines = wrap(finding.help, 92);
        lines.forEach((line, index) => {
          const marker = index === 0 ? '↳ ' : '  ';
          out.push(dim(`${GUTTER}  ${marker}${line}`));
        });
      }
    }
  }

  if (findings.length > 0 && !input.quiet) out.push('');

  const bySeverity = { error: 0, warning: 0, info: 0 };
  const byConfidence = { high: 0, medium: 0, low: 0 };
  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byConfidence[finding.confidence] += 1;
  }

  const fileCount = new Set(findings.map((finding) => finding.file)).size;
  out.push(
    `  ${bold(String(findings.length))} ${findings.length === 1 ? 'finding' : 'findings'} in ${fileCount} ${fileCount === 1 ? 'file' : 'files'}  ${dim('·')}  ${stats.files} files scanned in ${stats.durationMs}ms`,
  );
  out.push(
    dim(
      `  ${bySeverity.error} error · ${bySeverity.warning} warning · ${bySeverity.info} info   (${byConfidence.high} high · ${byConfidence.medium} medium · ${byConfidence.low} low confidence)`,
    ),
  );

  const extras: string[] = [];
  if (input.hiddenByConfidence > 0) extras.push(`${input.hiddenByConfidence} below confidence threshold`);
  if (input.suppressedByComment > 0) extras.push(`${input.suppressedByComment} suppressed by comment`);
  if (input.baselined > 0) extras.push(`${input.baselined} in baseline`);
  if (extras.length > 0) out.push(dim(`  hidden: ${extras.join(' · ')}`));
  if (stats.parseErrors > 0) {
    out.push(yellow(`  ${stats.parseErrors} file(s) had syntax errors and may be partially analysed`));
  }
  out.push('');
  return out.join('\n');
}

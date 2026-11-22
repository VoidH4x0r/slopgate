import type { Finding, ScanStats } from '../types.ts';

/**
 * GitHub Actions workflow commands: annotations show up inline on the pull
 * request diff without any extra setup (unlike SARIF, which needs code scanning).
 *
 * Escaping rules:
 *   property values: % \r \n : ,
 *   message data:    % \r \n
 */
function escapeProperty(value: string): string {
  return value
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
}

function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

const ANNOTATION_LEVEL: Record<Finding['severity'], 'error' | 'warning' | 'notice'> = {
  error: 'error',
  warning: 'warning',
  info: 'notice',
};

export function renderGithub(findings: readonly Finding[], stats: ScanStats): string {
  const lines: string[] = [];
  for (const finding of findings) {
    const properties = [
      `file=${escapeProperty(finding.file)}`,
      `line=${finding.start.line}`,
      `col=${finding.start.column}`,
      `endLine=${finding.end.line}`,
      `endColumn=${finding.end.column}`,
      `title=${escapeProperty(finding.ruleId)}`,
    ].join(',');
    // The message is shown as the annotation body; keep it to one line.
    const message = finding.help ? `${finding.message} — ${finding.help}` : finding.message;
    lines.push(`::${ANNOTATION_LEVEL[finding.severity]} ${properties}::${escapeData(message)}`);
  }

  const errors = findings.filter((finding) => finding.severity === 'error').length;
  const warnings = findings.filter((finding) => finding.severity === 'warning').length;
  lines.push(
    `::notice title=slopgate::${findings.length} finding(s) (${errors} error, ${warnings} warning) · ${stats.files} files scanned in ${stats.durationMs}ms`,
  );
  return lines.join('\n') + '\n';
}

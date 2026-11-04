export interface ScanSummary {
  total: number;
  bySeverity: Record<string, number>;
  byRule: Record<string, number>;
}

export function formatHumanSummary(summary: ScanSummary): string {
  const lines: string[] = ['Scan summary:'];

  for (const [key, value] of Object.entries(summary.bySeverity)) {
    lines.push(`  ${key}: ${value}`);
  }

  lines.push(`  Total: ${summary.total}`);

  if (Object.keys(summary.byRule).length > 0) {
    lines.push('  Rules:');
    for (const [ruleId, count] of Object.entries(summary.byRule)) {
      lines.push(`    ${ruleId}: ${count}`);
    }
  }

  return lines.join('\n');
}

export function formatFindingList(findings: Array<{ id: string; severity: string; title: string; location: { file: string; line: number } }>): string {
  if (findings.length === 0) {
    return 'No findings.';
  }

  return findings
    .map((item) => `${item.id} [${item.severity}] ${item.title} (${item.location.file}:${item.location.line})`)
    .join('\n');
}

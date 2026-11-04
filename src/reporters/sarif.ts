import type { Finding } from '../core/types.js';

const levelFor = (severity: Finding['severity']): 'error' | 'warning' | 'note' => {
  if (severity === 'P0' || severity === 'P1') return 'error';
  if (severity === 'P2') return 'warning';
  return 'note';
};

export function toSarif(findings: Finding[]): string {
  const rules = [...new Set(findings.map((finding) => finding.ruleId))].map((id) => ({
    id,
    shortDescription: { text: findings.find((finding) => finding.ruleId === id)?.title ?? id }
  }));
  const results = findings.map((finding) => ({
    ruleId: finding.ruleId,
    level: levelFor(finding.severity),
    message: { text: `${finding.title}: ${finding.description}` },
    locations: [{ physicalLocation: {
      artifactLocation: { uri: finding.location.file },
      region: { startLine: finding.location.line, startColumn: finding.location.column ?? 1 }
    } }],
    partialFingerprints: { guardianStableId: finding.id },
    properties: {
      severity: finding.severity,
      confidence: finding.confidence,
      category: finding.category,
      evidence: finding.evidence,
      recommendation: finding.recommendation
    }
  }));
  return JSON.stringify({
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{
      tool: { driver: {
        name: 'Engineering Guardian',
        informationUri: 'https://github.com/Muh-Adib/engineering-guardian-cli',
        rules
      } },
      results
    }]
  }, null, 2);
}

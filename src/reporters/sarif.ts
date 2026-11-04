import type { Finding } from '../core/types.js';

const levelFor = (severity: Finding['severity']): 'error' | 'warning' | 'note' => {
  if (severity === 'P0' || severity === 'P1') return 'error';
  if (severity === 'P2') return 'warning';
  return 'note';
};

export function toSarif(findings: Finding[]): string {
  const ruleIndex = new Map<string, { id: string; shortDescription: { text: string } }>();
  for (const finding of findings) {
    if (!ruleIndex.has(finding.ruleId)) {
      ruleIndex.set(finding.ruleId, { id: finding.ruleId, shortDescription: { text: finding.title } });
    }
  }
  const results = findings.map((finding) => ({
    ruleId: finding.ruleId,
    level: levelFor(finding.severity),
    message: { text: `${finding.title}: ${finding.description}` },
    locations: [{ physicalLocation: {
      artifactLocation: { uri: encodeURI(finding.location.file) },
      region: {
        startLine: finding.location.line,
        startColumn: finding.location.column ?? 1,
        ...(finding.location.endLine ? { endLine: finding.location.endLine } : {}),
        ...(finding.location.endColumn ? { endColumn: finding.location.endColumn } : {})
      }
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
        rules: [...ruleIndex.values()]
      } },
      results
    }]
  }, null, 2);
}

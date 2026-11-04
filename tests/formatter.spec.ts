import { describe, expect, it } from 'vitest';

import { formatFindingList, formatHumanSummary } from '../src/reporters/formatter.js';

describe('Engineering Guardian formatter', () => {
  it('formats human-readable summary output', () => {
    const summary = {
      total: 2,
      bySeverity: { P1: 1, P2: 1 },
      byRule: { 'EG-001': 1, 'EG-002': 1 }
    };

    const output = formatHumanSummary(summary);
    expect(output).toContain('Scan summary:');
    expect(output).toContain('P1: 1');
    expect(output).toContain('EG-001: 1');
  });

  it('formats finding list output', () => {
    const output = formatFindingList([
      { id: 'EG-001', severity: 'P1', title: 'Silent catch', location: { file: 'src/app.ts', line: 10 } }
    ]);

    expect(output).toContain('EG-001');
    expect(output).toContain('src/app.ts:10');
  });
});

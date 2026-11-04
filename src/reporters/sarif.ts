export interface SARIFResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note';
  message: string;
  file: string;
  startLine: number;
}

export function toSarif(results: SARIFResult[]): string {
  const runs = results.map((result) => ({
    ruleId: result.ruleId,
    level: result.level,
    message: {
      text: result.message
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: result.file
          },
          region: {
            startLine: result.startLine
          }
        }
      }
    ]
  }));

  return JSON.stringify(
    {
      version: '2.1.0',
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      runs: [
        {
          tool: {
            driver: {
              name: 'Engineering Guardian',
              informationUri: 'https://github.com/Muh-Adib/engineering-guardian-cli',
              rules: runs.map((run) => ({
                id: run.ruleId,
                shortDescription: {
                  text: run.message.text
                }
              }))
            }
          },
          results: runs
        }
      ]
    },
    null,
    2
  );
}

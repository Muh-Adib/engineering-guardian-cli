#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';

import { initProject, renderScanResult, runDoctor, runScan, verifyProject } from './application/commands.js';

const program = new Command();
program.name('eg').description('Engineering Guardian CLI for Next.js and Prisma quality analysis').version('0.2.0');

program.command('init').description('Create Guardian config and safely update the managed AGENTS.md section').action(() => {
  const result = initProject(process.cwd());
  console.log(`Initialized Guardian config at ${result.configPath}`);
  console.log(`Updated AGENTS instructions at ${result.agentsPath}`);
});

program.command('doctor').description('Inspect project stack and environment').action(() => {
  console.log(runDoctor(process.cwd()).output);
});

program.command('scan')
  .option('--changed', 'scan files changed in the working tree')
  .option('--base <ref>', 'scan files changed since base ref (requires --changed)')
  .option('--path <paths...>', 'scan only selected path(s)')
  .option('--format <format>', 'text, json, or sarif', 'text')
  .option('--out <file>', 'write report to file instead of stdout')
  .description('Run deterministic repository checks')
  .action((options) => {
    if (!['text', 'json', 'sarif'].includes(options.format)) {
      console.error('Invalid format. Choose text, json, or sarif.');
      process.exitCode = 2;
      return;
    }
    if (options.base && !options.changed) {
      console.error('--base requires --changed.');
      process.exitCode = 2;
      return;
    }

    try {
      const result = runScan({ cwd: process.cwd(), changed: options.changed, base: options.base, paths: options.path, format: options.format });
      const report = renderScanResult(result, options.format);
      if (options.out) {
        writeFileSync(resolve(process.cwd(), options.out), `${report}\n`, 'utf8');
      } else {
        console.log(report);
      }
      if (!result.passed) process.exitCode = 1;
    } catch (error) {
      console.error(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    }
  });

program.command('explain').requiredOption('--id <id>', 'finding ID to explain').description('Show deterministic finding guidance').action(({ id }) => {
  const result = runScan({ cwd: process.cwd() });
  const finding = result.findings.find((item) => item.id === id);
  if (!finding) {
    console.error(`Finding not found: ${id}. Run eg scan to refresh findings.`);
    process.exitCode = 1;
    return;
  }
  console.log(`${finding.title} (${finding.ruleId})\n${finding.description}\nEvidence: ${finding.evidence}\nImpact: ${finding.impact}\nRecommendation: ${finding.recommendation}`);
});

program.command('fix').requiredOption('--id <id>', 'finding ID to propose a repair for').option('--apply', 'apply approved patch (currently preview only)').description('Show repair guidance without writing files').action(({ id, apply }) => {
  const result = runScan({ cwd: process.cwd() });
  const finding = result.findings.find((item) => item.id === id);
  if (!finding) {
    console.error(`Finding not found: ${id}. Run eg scan to refresh findings.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Repair proposal for ${id}: ${finding.recommendation}`);
  console.log(apply ? 'Patch application is disabled in this MVP; no files were changed.' : 'Preview only; no files were changed.');
});

program.command('verify').description('Show recognized project quality scripts without executing them').action(() => {
  const result = verifyProject(process.cwd());
  console.log(result.status);
  for (const command of result.commands) {
    console.log(`${command.name}: ${command.script}`);
  }
  console.log(result.message);
});

program.parse(process.argv);

#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Command } from 'commander';

import { initProject, renderScanResult, runDoctor, runScan, verifyProject } from './application/commands.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const program = new Command();
program.name('eg').description('Engineering Guardian CLI for Next.js and Prisma quality analysis').version(version);

program.command('init').description('Create Guardian config and safely update the managed AGENTS.md section').action(() => {
  const result = initProject(process.cwd());
  console.log(`${result.configCreated ? 'Created' : 'Kept existing'} Guardian config at ${result.configPath}`);
  console.log(`Updated managed instructions at ${result.agentsPath}`);
});

program.command('doctor').description('Inspect project stack and environment').action(() => {
  console.log(runDoctor(process.cwd()).output);
});

program.command('scan')
  .option('--changed', 'scan files changed in the working tree (staged and unstaged)')
  .option('--base <ref>', 'scan files changed from a Git base ref (requires --changed)')
  .option('--path <paths...>', 'scan only the specified file(s) or directory(s)')
  .option('--format <format>', 'text, json, or sarif', 'text')
  .option('--out <file>', 'write report to a file instead of stdout')
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
      const result = runScan({ cwd: process.cwd(), changed: options.changed, base: options.base, paths: options.path });
      for (const warning of result.warnings) console.error(`[eg] Warning: ${warning}`);
      const report = renderScanResult(result, options.format);
      if (options.out) {
        const target = resolve(process.cwd(), options.out);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, `${report}\n`, 'utf8');
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

program.command('fix').requiredOption('--id <id>', 'finding ID to propose a repair for').option('--apply', 'request application (not supported without a configured repair provider and approval flow)').description('Show safe repair status').action(({ id, apply }) => {
  const result = runScan({ cwd: process.cwd() });
  const finding = result.findings.find((item) => item.id === id);
  if (!finding) {
    console.error(`Finding not found: ${id}. Run eg scan to refresh findings.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Repair for ${id}: ${finding.recommendation}`);
  console.log(apply ? 'Patch application is not yet implemented; no files were changed.' : 'Preview only; no files were changed.');
});

program.command('verify').description('Show recognized project quality scripts without executing them').action(() => {
  const result = verifyProject(process.cwd());
  console.log(result.status);
  for (const command of result.commands) console.log(`${command.name}: ${command.script}`);
  console.log(result.message);
});

program.parse(process.argv);

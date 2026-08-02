#!/usr/bin/env node
import { createProgram } from './program.js';
import { CommanderError } from 'commander';
import { createMeloPulseService } from '../service.js';

const program = createProgram(createMeloPulseService());

try {
  await program.parseAsync();
} catch (error) {
  if (!(error instanceof CommanderError)) process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

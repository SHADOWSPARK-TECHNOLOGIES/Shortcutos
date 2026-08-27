import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  AdapterAvailability,
  ExecutionResultStatus
} from './dist/index.js';

export function createNodeMemoryTextStore(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new TypeError('Memory file path must be a non-empty string.');
  }

  return {
    async read() {
      try {
        return await readFile(filePath, 'utf8');
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },
    async write(text) {
      if (typeof text !== 'string') {
        throw new TypeError('Memory store writes must be strings.');
      }
      await mkdir(dirname(filePath), { recursive: true });
      const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
      await writeFile(temporary, text, 'utf8');
      await rename(temporary, filePath);
    }
  };
}

export function createLocalFileReadAdapter({ id, root }) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('Adapter id must be a non-empty string.');
  }
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('Adapter root must be a non-empty string.');
  }

  return {
    id,
    capability: 'file.read',
    availability: AdapterAvailability.AVAILABLE,
    async invoke(input) {
      if (!input || typeof input !== 'object' || typeof input.path !== 'string' || input.path.length === 0) {
        throw new TypeError('file.read input must contain a non-empty path string.');
      }

      const rootReal = await realpath(root);
      const requested = resolve(rootReal, input.path);

      const relRequested = relative(rootReal, requested);
      if (
        relRequested === '..' ||
        relRequested.startsWith('..\\') ||
        relRequested.startsWith('../') ||
        isAbsolute(relRequested)
      ) {
        throw new Error('Requested path resolves outside configured root.');
      }

      const targetReal = await realpath(requested);
      const rel = relative(rootReal, targetReal);
      if (
        rel === '..' ||
        rel.startsWith('..\\') ||
        rel.startsWith('../') ||
        isAbsolute(rel)
      ) {
        throw new Error('Requested path resolves outside configured root.');
      }

      const text = await readFile(targetReal, 'utf8');
      return {
        status: ExecutionResultStatus.SUCCEEDED,
        output: { path: input.path, text },
        evidence: [{ kind: 'local-file-read', ref: targetReal }]
      };
    }
  };
}

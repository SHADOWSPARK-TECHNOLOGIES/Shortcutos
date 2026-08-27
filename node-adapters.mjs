import { mkdir, readFile, realpath, rename, writeFile, rm } from 'node:fs/promises';
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

  const lockPath = `${filePath}.lock`;

  async function acquireLock(maxRetries = 200, delayMs = 10) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(lockPath, String(process.pid), { flag: 'wx' });
        return;
      } catch (err) {
        if (err && (err.code === 'EEXIST' || err.code === 'EPERM')) {
          // Check for stale lock (> 3 seconds old)
          try {
            const { stat } = await import('node:fs/promises');
            const s = await stat(lockPath);
            if (Date.now() - s.mtimeMs > 3000) {
              await rm(lockPath, { force: true });
            }
          } catch {}
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw err;
      }
    }
    const lockErr = new Error(`LOCK_ACQUISITION_FAILED: Could not acquire lock for ${filePath}`);
    lockErr.code = 'LOCK_ACQUISITION_FAILED';
    throw lockErr;
  }

  async function releaseLock() {
    try {
      await rm(lockPath, { force: true });
    } catch {}
  }

  return {
    async read() {
      await acquireLock();
      try {
        return await readFile(filePath, 'utf8');
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
          return null;
        }
        throw error;
      } finally {
        await releaseLock();
      }
    },
    async write(text) {
      if (typeof text !== 'string') {
        throw new TypeError('Memory store writes must be strings.');
      }
      await acquireLock();
      try {
        await mkdir(dirname(filePath), { recursive: true });
        const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
        await writeFile(temporary, text, 'utf8');
        await rename(temporary, filePath);
      } finally {
        await releaseLock();
      }
    },
    async withLock(fn) {
      await acquireLock();
      try {
        return await fn();
      } finally {
        await releaseLock();
      }
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

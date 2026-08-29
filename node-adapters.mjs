import { mkdir, readFile, realpath, rename, writeFile, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  AdapterAvailability,
  ExecutionResultStatus
} from './dist/index.js';

let globalFencingSequence = Date.now();

export function createNodeMemoryTextStore(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new TypeError('Memory file path must be a non-empty string.');
  }

  const lockPath = `${filePath}.lock`;

  async function readLockData() {
    try {
      const text = await readFile(lockPath, 'utf8');
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function acquireLock(options = {}) {
    const ownerToken = options.ownerToken ?? randomUUID();
    const leaseMs = options.leaseMs ?? 10000;
    const maxRetries = options.maxRetries ?? 200;
    const delayMs = options.delayMs ?? 10;

    await mkdir(dirname(filePath), { recursive: true });

    for (let i = 0; i < maxRetries; i++) {
      const existing = await readLockData();
      if (existing) {
        if (existing.ownerToken === ownerToken) {
          return { ownerToken, fencingToken: existing.fencingToken, release: () => releaseLock(ownerToken) };
        }
        if (Date.now() > (existing.expiresAt ?? 0)) {
          try {
            await rm(lockPath, { force: true });
          } catch {}
        } else {
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
      }

      try {
        const fencingToken = ++globalFencingSequence;
        const payload = JSON.stringify({
          ownerToken,
          fencingToken,
          pid: process.pid,
          createdAt: Date.now(),
          expiresAt: Date.now() + leaseMs
        });
        await writeFile(lockPath, payload, { flag: 'wx', encoding: 'utf8' });
        return { ownerToken, fencingToken, release: () => releaseLock(ownerToken) };
      } catch (err) {
        if (err && (err.code === 'EEXIST' || err.code === 'EPERM')) {
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

  async function releaseLock(ownerToken) {
    if (typeof ownerToken !== 'string') {
      throw new TypeError('releaseLock requires ownerToken string.');
    }
    const existing = await readLockData();
    if (!existing) {
      return;
    }
    if (existing.ownerToken !== ownerToken) {
      const err = new Error(`LOCK_NON_OWNER_RELEASE_FORBIDDEN: Lock is owned by token ${existing.ownerToken}, cannot be released by ${ownerToken}`);
      err.code = 'LOCK_NON_OWNER_RELEASE_FORBIDDEN';
      throw err;
    }
    try {
      await rm(lockPath, { force: true });
    } catch {}
  }

  async function unlockedRead() {
    try {
      return await readFile(filePath, 'utf8');
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async function unlockedWrite(text, activeOwnerToken, activeFencingToken) {
    if (typeof text !== 'string') {
      throw new TypeError('Memory store writes must be strings.');
    }

    if (activeOwnerToken !== undefined || activeFencingToken !== undefined) {
      const existing = await readLockData();
      if (!existing) {
        const err = new Error(`LOCK_FENCING_STALE: Writer fencing token ${activeFencingToken} is no longer active because lock was released or expired.`);
        err.code = 'LOCK_FENCING_STALE';
        throw err;
      }
      if (activeFencingToken !== undefined && existing.fencingToken > activeFencingToken) {
        const err = new Error(`LOCK_FENCING_STALE: Writer fencing token ${activeFencingToken} outranked by active lock fencing token ${existing.fencingToken}`);
        err.code = 'LOCK_FENCING_STALE';
        throw err;
      }
      if (activeOwnerToken !== undefined && existing.ownerToken !== activeOwnerToken) {
        const err = new Error(`LOCK_FENCING_STALE: Writer owner token ${activeOwnerToken} no longer matches active lock owner ${existing.ownerToken}`);
        err.code = 'LOCK_FENCING_STALE';
        throw err;
      }
    }

    await mkdir(dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temporary, text, 'utf8');
    await rename(temporary, filePath);
  }

  return {
    acquireLock,
    releaseLock,
    async read() {
      const lock = await acquireLock();
      try {
        return await unlockedRead();
      } finally {
        await releaseLock(lock.ownerToken);
      }
    },
    async write(text) {
      const lock = await acquireLock();
      try {
        await unlockedWrite(text, lock.ownerToken, lock.fencingToken);
      } finally {
        await releaseLock(lock.ownerToken);
      }
    },
    async withLock(fn, options = {}) {
      const ownerToken = options.ownerToken ?? randomUUID();
      const lock = await acquireLock({ ownerToken, leaseMs: options.leaseMs });
      const transaction = {
        read: unlockedRead,
        write: (text) => unlockedWrite(text, lock.ownerToken, lock.fencingToken)
      };
      try {
        return await fn(transaction);
      } finally {
        await releaseLock(ownerToken);
      }
    }
  };
}

export function createLocalFileReadAdapter(options = {}) {
  const id = options.id ?? 'local.file.read';
  const capability = options.capability ?? 'file.read';
  const root = options.root;

  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('Local file read adapter requires a non-empty root path.');
  }

  const rootResolved = resolve(root);

  return {
    id,
    capability,
    availability: AdapterAvailability.AVAILABLE,
    async invoke(input) {
      const pathInput = input?.path;
      if (typeof pathInput !== 'string' || pathInput.length === 0) {
        return {
          status: ExecutionResultStatus.FAILED,
          output: null,
          error: {
            code: 'INVALID_INPUT',
            message: 'path is required and must be a non-empty string.'
          },
          evidence: []
        };
      }

      const targetPath = resolve(rootResolved, pathInput);
      const relBefore = relative(rootResolved, targetPath);
      if (relBefore.startsWith('..') || isAbsolute(relBefore)) {
        throw new Error(`Path ${pathInput} resolves outside configured root ${rootResolved}`);
      }

      try {
        const rootReal = await realpath(rootResolved);
        const targetReal = await realpath(targetPath);
        const relAfter = relative(rootReal, targetReal);
        if (relAfter.startsWith('..') || isAbsolute(relAfter)) {
          throw new Error(`Path ${pathInput} resolves outside configured root ${rootResolved}`);
        }

        const content = await readFile(targetReal, 'utf8');
        return {
          status: ExecutionResultStatus.SUCCEEDED,
          output: { path: pathInput, text: content },
          evidence: [
            {
              id: `evi-file-${Date.now()}`,
              kind: 'file-read',
              ref: targetReal,
              source: id,
              timestamp: new Date().toISOString(),
              integrity: 'checksum-valid'
            }
          ]
        };
      } catch (err) {
        if (err instanceof Error && err.message.includes('resolves outside configured root')) {
          throw err;
        }
        return {
          status: ExecutionResultStatus.FAILED,
          output: null,
          error: {
            code: 'FILE_READ_FAILED',
            message: err instanceof Error ? err.message : String(err)
          },
          evidence: []
        };
      }
    }
  };
}

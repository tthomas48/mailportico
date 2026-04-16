import { mkdir, readdir, readFile, rm, unlink, writeFile, rename } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { Message, MessageListFilter } from './types.js';

export interface MessageStore {
  save(message: Message): Promise<void>;
  get(id: string): Promise<Message | undefined>;
  list(filter?: MessageListFilter): Promise<Message[]>;
  delete(id: string): Promise<boolean>;
  deleteAll(): Promise<number>;
}

export class FileMessageStore implements MessageStore {
  constructor(private readonly dataDir: string) {}

  private pathFor(id: string): string | undefined {
    if (!isSafeMessageId(id)) {
      return undefined;
    }
    const baseDir = resolve(this.dataDir);
    const candidate = resolve(baseDir, `${id}.json`);
    if (candidate !== baseDir && !candidate.startsWith(`${baseDir}${sep}`)) {
      return undefined;
    }
    return candidate;
  }

  async save(message: Message): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const finalPath = this.pathFor(message.id);
    if (!finalPath) {
      throw new Error('Invalid message id');
    }
    const tmpPath = `${finalPath}.tmp`;
    const body = JSON.stringify(message, null, 2);
    await writeFile(tmpPath, body, 'utf8');
    await rename(tmpPath, finalPath);
  }

  async get(id: string): Promise<Message | undefined> {
    const path = this.pathFor(id);
    if (!path) {
      return undefined;
    }
    try {
      const raw = await readFile(path, 'utf8');
      return JSON.parse(raw) as Message;
    } catch {
      return undefined;
    }
  }

  async list(filter?: MessageListFilter): Promise<Message[]> {
    let names: string[];
    try {
      names = await readdir(this.dataDir);
    } catch {
      return [];
    }
    const jsonFiles = names.filter((n) => n.endsWith('.json'));
    const messages: Message[] = [];
    for (const name of jsonFiles) {
      try {
        const raw = await readFile(join(this.dataDir, name), 'utf8');
        const msg = JSON.parse(raw) as Message;
        if (filter?.to && normalizeForFilter(msg.to) !== normalizeForFilter(filter.to)) {
          continue;
        }
        if (filter?.threadId && msg.threadId !== filter.threadId) {
          continue;
        }
        messages.push(msg);
      } catch {
        /* skip corrupt file */
      }
    }
    messages.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return messages;
  }

  async delete(id: string): Promise<boolean> {
    const path = this.pathFor(id);
    if (!path) {
      return false;
    }
    try {
      await unlink(path);
      return true;
    } catch {
      return false;
    }
  }

  async deleteAll(): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.dataDir);
    } catch {
      return 0;
    }
    let n = 0;
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        await rm(join(this.dataDir, name));
        n++;
      } catch {
        /* ignore */
      }
    }
    return n;
  }
}

function normalizeForFilter(s: string): string {
  return s.trim().replace(/\s+/g, '');
}

function isSafeMessageId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

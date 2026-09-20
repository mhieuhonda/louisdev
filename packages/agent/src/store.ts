import { Database } from "bun:sqlite"

export type StoredRole = "system" | "user" | "assistant" | "tool"

export interface StoredMessage {
  id: number
  role: StoredRole
  content: string
  createdAt: number
}

export interface Session {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: StoredMessage[]
}

/** SQLite-backed session store. One file per user, WAL mode. */
export class SessionStore {
  private readonly db: Database

  constructor(path: string) {
    this.db = new Database(path, { create: true })
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'untitled',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
    `)
  }

  create(title = "untitled"): Session {
    const now = Date.now()
    const id = `ses_${now.toString(36)}${Math.floor(Math.random() * 0xffff).toString(36)}`
    this.db
      .query("INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(id, title, now, now)
    return { id, title, createdAt: now, updatedAt: now, messages: [] }
  }

  append(sessionId: string, role: StoredRole, content: string): void {
    const now = Date.now()
    this.db
      .query("INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)")
      .run(sessionId, role, content, now)
    this.db.query("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sessionId)
  }

  get(sessionId: string): Session | undefined {
    const row = this.db
      .query("SELECT id, title, created_at, updated_at FROM sessions WHERE id = ?")
      .get(sessionId) as { id: string; title: string; created_at: number; updated_at: number } | null
    if (!row) return undefined
    const messages = this.db
      .query("SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC")
      .all(sessionId) as { id: number; role: StoredRole; content: string; created_at: number }[]
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at,
      })),
    }
  }

  list(): Pick<Session, "id" | "title" | "createdAt" | "updatedAt">[] {
    const rows = this.db
      .query("SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC")
      .all() as {
      id: string
      title: string
      created_at: number
      updated_at: number
    }[]
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  close(): void {
    this.db.close()
  }
}

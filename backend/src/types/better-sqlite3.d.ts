declare module 'better-sqlite3' {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Statement {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    pluck(toggle?: boolean): Statement;
  }

  class Database {
    constructor(path: string);
    pragma(command: string): void;
    exec(sql: string): void;
    prepare(sql: string): Statement;
  }

  export = Database;
}

export type WriteOperation = "marker" | "category" | "note" | "preset" |
  "import" | "account-import" | "clear-game" | "clear-map" | "restore";

export class WriteStatus {
  private pending = 0;
  private savedAt: string | null = null;
  private errors: { operation: WriteOperation; at: string; code: string }[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  public get() {
    return {
      state: this.errors.length ? "failed" : this.pending ? "saving" : this.savedAt ? "saved" : "idle",
      pending: this.pending,
      savedAt: this.savedAt,
      errors: this.errors.map((error) => ({ ...error })),
    };
  }

  public run<T>(operation: WriteOperation, write: () => Promise<T>): Promise<T> {
    this.pending++;
    const task = this.queue.then(async () => {
      try {
        const value = await write();
        this.savedAt = new Date().toISOString();
        return value;
      } catch (error) {
        // Never expose exception messages: they can contain account or note data.
        const code = error instanceof Error &&
          ["QuotaExceededError", "AbortError", "ConstraintError", "DataError"].includes(error.name)
          ? error.name : "WriteError";
        this.errors = [...this.errors.slice(-9), { operation, at: new Date().toISOString(), code }];
        throw error;
      } finally {
        this.pending--;
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }
}

export type SaveStatus = ReturnType<WriteStatus["get"]>;

import backendService from "@/services/backend.service";
import type { RecoveryEntry, RecoveryReason } from "@/common/storage/recovery";
import { selectGames } from "./store/features/app/appSlice";
import { setNeedsReload } from "./store/features/saves/savesSlice";
import { useAppDispatch, useAppSelector } from "./hooks";
import style from "./RecoveryView.module.scss";

const backend = backendService.use();
const labels: Record<RecoveryReason, string> = {
  import: "Before JSON import", "account-import": "Before account import",
  "clear-map": "Before clearing map", "clear-game": "Before clearing game", restore: "Before restore",
};

export function RecoveryView({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const dispatch = useAppDispatch();
  const games = useAppSelector(selectGames);
  const [entries, setEntries] = React.useState<RecoveryEntry[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [selected, setSelected] = React.useState<RecoveryEntry | null>(null);
  const [success, setSuccess] = React.useState("");
  async function load() {
    setLoading(true);
    setError("");
    try { setEntries(await backend.getRecoveryPoints()); }
    catch { setError("Could not load recovery points. Open a MapGenie map and try again."); }
    finally { setLoading(false); }
  }
  React.useEffect(() => { void load(); }, []);
  const confirmation = useConfirm((accepted) => { if (accepted) void restore(); });
  async function restore() {
    if (!selected || busy) return;
    setBusy(true);
    onBusy(true);
    setError("");
    setSuccess("");
    try {
      await backend.restoreRecoveryPoint(selected.id);
      dispatch(setNeedsReload(true));
      setSuccess("Recovery point restored.");
      await load();
    } catch { setError("Restore failed. Refresh the recovery list and check your game data."); }
    finally { setBusy(false); onBusy(false); }
  }
  return <section className={style.recovery}>
    <Confirm {...confirmation.state} message="Restore this recovery point? All data for its listed games will be replaced. A recovery point of the current data will be created first." />
    <header><h2>Recovery points</h2>
      <Button title="Refresh recovery points" ariaLabel="Refresh recovery points" disabled={busy || loading} onClick={load}><FontIcon icon="reload" /></Button>
    </header>
    <p className={style.notice}>Up to 5 points for the current profile. Stored on this device; clearing site data removes them.</p>
    {error && <p role="alert">{error}</p>}
    {success && <p role="status">{success}</p>}
    {loading ? <p role="status">Loading...</p> : entries.length === 0 ? <p>No recovery points yet.</p> :
      <ul>{entries.map((entry) => <li key={entry.id}>
        <div>
          <strong>{labels[entry.reason]}</strong>
          <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
          <span>{entry.gameIds.map((id) => games.find((game) => game.id === id)?.title ?? `Game ${id}`).join(", ")}</span>
          <small>{entry.locations} locations · {entry.notes} notes</small>
        </div>
        <Button disabled={busy} title="Restore recovery point" ariaLabel="Restore" onClick={() => { setSelected(entry); confirmation.open(); }}><FontIcon icon="reload" /> Restore</Button>
      </li>)}</ul>}
  </section>;
}

import backendService from "@/services/backend.service";
import { bounded } from "@/common/diagnostics";
import type { SaveStatus } from "@/common/storage/writeStatus";
import style from "./Connection.module.scss";

const backend = backendService.use();

export function SaveIndicator() {
  const [status, setStatus] = React.useState<SaveStatus | null>(null);
  React.useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await bounded(backend.getSaveStatus());
        if (!stopped) setStatus(value);
      } catch { if (!stopped) setStatus(null); }
      if (!stopped) timer = setTimeout(poll, 1500);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  const label = !status ? "Save status unavailable" : status.state === "failed" ? "Save failed"
    : status.state === "saving" ? "Saving..." : status.state === "saved" ? "Saved locally" : "No new changes";
  return <span className={style.saveStatus} data-failed={status?.state === "failed"}
    role="status" title={status?.state === "failed" ? "A write failed during this session. Check diagnostics before closing the map."
      : status?.savedAt ? `Last write: ${new Date(status.savedAt).toLocaleString()}` : label}>{label}</span>;
}

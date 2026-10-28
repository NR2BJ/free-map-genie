import backendService from "@/services/backend.service";
import pageService from "@/services/page.service";
import { bounded } from "@/common/diagnostics";
import style from "./Info.module.scss";

const backend = backendService.use();
const page = pageService.use();

export function Diagnostics({ children }: React.PropsWithChildren) {
  const [open, setOpen] = React.useState(false);
  const [report, setReport] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const request = React.useRef(0);
  React.useEffect(() => () => { request.current++; }, []);
  function close() {
    request.current++;
    setOpen(false);
    setBusy(false);
    setMessage("");
  }
  async function prepare() {
    const current = ++request.current;
    setOpen(true);
    setBusy(true);
    setReport("");
    setMessage("");
    const read = async <T,>(request: Promise<T>) => {
      try { return await bounded(request); } catch { return "unavailable"; }
    };
    const [map, saves, persisted, estimate] = await Promise.all([
      read(page.getDiagnostics()), read(backend.getSaveStatus()),
      read(backend.isStoragePersisted()), read(backend.storageEstimate()),
    ]);
    if (current !== request.current) return;
    setReport(JSON.stringify({ version: browser.runtime.getManifest().version,
      browser: navigator.userAgent, map, saves, storage: {
        persisted, usage: typeof estimate === "object" ? estimate.usage : null,
        quota: typeof estimate === "object" ? estimate.quota : null,
      } }, null, 2));
    setBusy(false);
  }
  async function copy() {
    const current = request.current;
    try {
      await navigator.clipboard.writeText(report);
      if (current === request.current) setMessage("Copied");
    } catch {
      if (current === request.current) setMessage("Clipboard unavailable. Select the report to copy it.");
    }
  }
  return <section className={style.diagnostics}>
    <div className={style.diagnosticToolbar}>
      <button type="button" className={style.diagnosticToggle} aria-label="Diagnostics" aria-expanded={open}
        aria-controls="diagnostic-report" onClick={open ? close : prepare}>
        <FontIcon icon="info-circled" /> Diagnostics
      </button>
      {open && <>
        <button type="button" disabled={!report || busy} title="Copy report" aria-label="Copy report" onClick={copy}>
          <FontIcon icon="document" />
        </button>
        <button type="button" title="Close diagnostics" aria-label="Close diagnostics" onClick={close}>
          <FontIcon icon="cross" />
        </button>
      </>}
    </div>
    {open ? <div id="diagnostic-report" className={style.diagnosticReport}>
      {busy ? <span role="status">Collecting...</span> : <textarea aria-label="Diagnostic report" readOnly value={report} />}
      {message && <span role="status">{message}</span>}
    </div> : <div className={style.infoContent}>{children}</div>}
  </section>;
}

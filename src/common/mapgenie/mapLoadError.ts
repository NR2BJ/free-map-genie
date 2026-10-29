export const showMapLoadError = () => {
  if (document.getElementById("fmg-map-load-error")) return;

  const alert = document.createElement("section");
  alert.id = "fmg-map-load-error";
  alert.setAttribute("role", "alert");
  Object.assign(alert.style, {
    position: "fixed", top: "16px", left: "50%", transform: "translateX(-50%)",
    zIndex: "2147483647", width: "min(480px, calc(100vw - 32px))",
    boxSizing: "border-box", padding: "16px", background: "#202020",
    color: "#fff", border: "1px solid #d77265", borderRadius: "4px",
    font: "14px/1.5 sans-serif",
  });
  const message = document.createElement("p");
  message.textContent = "FMG could not load the requested map data. Your saved progress has not been changed.";
  message.style.margin = "0 0 12px";

  const retry = document.createElement("button");
  retry.textContent = "Retry";
  retry.type = "button";
  retry.addEventListener("click", () => window.location.reload());
  const original = document.createElement("a");
  const url = new URL(window.location.href);
  url.searchParams.delete("fmgMapId");
  original.href = url.href;
  original.textContent = "Open original map";
  original.style.color = "#a9d4ff";
  original.style.marginLeft = "16px";

  alert.append(message, retry, original);
  document.body.append(alert);
};

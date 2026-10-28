import React from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import clsx from "clsx";
import * as components from "../src/components";
import { useConfirm } from "../src/hooks/confirm.hooks";
import { ReactUtils } from "../src/utils/react.utils";
import { store } from "../src/contexts/dataManager/store";
import App from "../src/contexts/dataManager/App";
import PopupApp from "../src/contexts/popup/App";
import { store as popupStore } from "../src/contexts/popup/store";
import { Diagnostics } from "../src/contexts/popup/store/features/info/Diagnostics";
import { SaveIndicator } from "../src/contexts/popup/store/features/app/Footer/SaveIndicator";
import "../src/contexts/dataManager/style.css";

Object.assign(globalThis, components, { React, clsx, useConfirm, ReactUtils,
  logger: { debug() {}, error() {}, warn() {} }, injectStyle: async () => {},
  popupStore,
  browser: { runtime: { getManifest: () => ({ version: "test" }) },
    tabs: { create: async (tab: {url: string}) => { Object.assign(globalThis, { openedTab: tab.url }); } } },
});

const diagnostics = location.pathname === "/diagnostics";
createRoot(document.getElementById("root")!).render(
  location.pathname === "/popup" ? <Provider store={popupStore}><PopupApp /></Provider> :
  diagnostics ? <components.ThemeProvider theme="dark"><div style={{ padding: 12, maxWidth: 400, minHeight: "100vh", color: "var(--color)", background: "var(--background)" }}>
    <Diagnostics /><SaveIndicator />
  </div></components.ThemeProvider> : <Provider store={store}><App /></Provider>
);

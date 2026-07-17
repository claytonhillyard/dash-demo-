// Preload script for the iDesign Command Center desktop shell.
//
// Intentionally minimal / empty: the renderer just loads the real Next.js
// app over http://127.0.0.1:<port> (same as a browser tab would), so there is
// no Node<->renderer bridge to expose. contextIsolation is on and
// nodeIntegration is off (see desktop/main.js), so this file's only job is to
// exist as a valid, harmless preload target — it does not use
// contextBridge/ipcRenderer today. If a future slice needs main<->renderer
// IPC (e.g. native menu actions, file dialogs), add a contextBridge.exposeInMainWorld
// API here rather than relaxing contextIsolation/nodeIntegration.

"use strict";

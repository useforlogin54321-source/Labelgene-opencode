const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // List available printers
  getPrinters: () => ipcRenderer.invoke('get-printers'),

  // Silent print: send PDF buffer to a specific printer, no OS dialog
  silentPrint: (pdfBase64, printerName, copies) =>
    ipcRenderer.invoke('silent-print', { pdfBase64, printerName, copies }),

  // Fallback: open system print dialog
  systemPrint: (pdfBase64) =>
    ipcRenderer.invoke('system-print', { pdfBase64 }),
});
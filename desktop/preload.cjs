const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('clearVoiceDesktop', {
  platform: process.platform,
  isDesktop: true
});

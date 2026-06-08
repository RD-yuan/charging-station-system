import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('chargingApp', {
  platform: process.platform
})

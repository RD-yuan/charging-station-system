<script setup lang="ts">
import { ref } from 'vue'

const codePackage = ref(`{
  "name": "charging-station-system-admin",
  "version": "1.0.0",
  "main": "electron/main.js",
  "scripts": {
    "dev:electron": "electron .",
    "build:electron": "electron-builder --win --x64"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.9.0"
  }
}`)

const codeMain = ref(`const { app, BrowserWindow } = require('electron')
const path = require('path')

function createWindow () {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  // Load production file built by Vite or local development live port
  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)`)
</script>

<template>
  <div class="space-y-6 font-sans">
    <div class="border-b border-slate-200 pb-5">
      <h2 class="text-xl font-bold text-slate-900 tracking-tight">Electron 桌面端容器配置与打包极简教程</h2>
      <p class="text-xs text-slate-500 mt-1">适用于答辩现场使用桌面程序双客户端双开运行（User 与 Admin 分开独立运行）的极速打包方案</p>
    </div>

    <!-- Step tutorial -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      
      <!-- Descriptions -->
      <div class="space-y-4">
        <h3 class="text-sm font-bold text-slate-900">1. 操作指南 (Packaging Procedure)</h3>
        
        <div class="space-y-3 text-xs leading-relaxed text-slate-600">
          <p>
            为了在答辩现场达到最佳演示效果（摆脱浏览器标签页，直接运行两个独立的桌面端程序 <strong>（用户客户端 .exe 与 管理后台 .exe）</strong>），请配合 Electron 打包运行：
          </p>
          
          <div class="flex items-start gap-2.5 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <span class="bg-emerald-500 text-slate-950 font-bold h-5 w-5 rounded-full flex items-center justify-center font-mono">1</span>
            <div>
              <p class="font-bold text-slate-900">装配依赖包</p>
              <p class="mt-0.5 text-[11px] text-slate-500">在本地的 <code>package.json</code> 中，将 Electron 塞入 devDependencies 开发依赖。</p>
            </div>
          </div>

          <div class="flex items-start gap-2.5 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <span class="bg-emerald-500 text-slate-950 font-bold h-5 w-5 rounded-full flex items-center justify-center font-mono">2</span>
            <div>
              <p class="font-bold text-slate-900">装载入口配置</p>
              <p class="mt-0.5 text-[11px] text-slate-500">在项目根目录（或新建 <code>electron</code> 文件夹）编写主进程文件 <code>main.js</code>，用于承载 Chromium 浏览器并载入 Vue 构建生成的 dist/index.html。</p>
            </div>
          </div>

          <div class="flex items-start gap-2.5 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <span class="bg-emerald-500 text-slate-950 font-bold h-5 w-5 rounded-full flex items-center justify-center font-mono">3</span>
            <div>
              <p class="font-bold text-slate-900">启动与编译打包</p>
              <p class="mt-0.5 text-[11px] text-slate-500">本地输入 <code>npm run build</code> 生成静态产物后，使用 <code>npm run build:electron</code> 编译打包出最终绿色免安装压缩包 .exe，即可双击演示主流程！</p>
            </div>
          </div>
        </div>

        <div class="bg-amber-50 border border-amber-200/60 p-4 rounded-xl text-xs text-amber-800 space-y-1.5 leading-relaxed">
          <p class="font-semibold flex items-center gap-1.5">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shield-alert shrink-0"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12" y1="16" y2="16"/></svg>
            跨域联调温馨提示：
          </p>
          <p class="text-[11px] text-amber-700 font-sans">
            一旦客户端打包入 Electron 后运行，在生产包中所有的相对路径调用将不成立。请务必将 API 请求基地址 <code>VITE_API_BASE_URL</code> 设定为本地局域网真实 IP <strong>(例如 http://192.168.1.5:3000)</strong> 或者本地外链，不要使用 localhost！
          </p>
        </div>
      </div>

      <!-- Code views -->
      <div class="space-y-4 font-mono text-xs">
        <div>
          <label class="block text-[10px] font-bold uppercase text-slate-400 mb-1.5 font-sans">本地配置 package.json 补充项</label>
          <pre class="bg-slate-950 text-slate-300 p-4 rounded-lg overflow-x-auto leading-relaxed border border-slate-800">{{ codePackage }}</pre>
        </div>
        
        <div>
          <label class="block text-[10px] font-bold uppercase text-slate-400 mb-1.5 font-sans">项目主进程 main.js 配置样例</label>
          <pre class="bg-slate-950 text-slate-300 p-4 rounded-lg overflow-x-auto leading-relaxed border border-slate-800">{{ codeMain }}</pre>
        </div>
      </div>

    </div>
  </div>
</template>

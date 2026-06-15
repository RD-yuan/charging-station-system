# 智能充电桩统一前端（Client）

用户端与管理端已合并到 `apps/client`，通过 `/auth` 登录页切换入口。

## 目录结构

```text
apps/client/src/
├── api/http.ts           # 统一 API 封装
├── router/index.ts       # 路由：/auth、/user、/admin
├── views/
│   ├── AuthView.vue      # 统一登录/注册入口
│   ├── AdminLayout.vue   # 管理端主布局
│   ├── DashboardView.vue
│   ├── MonitorView.vue
│   ├── ReportView.vue
│   ├── WebSocketView.vue
│   └── user/
│       ├── UserLayout.vue
│       └── UserDashboard.vue
└── components/Sidebar.vue
```

## 启动

```bash
npm run dev
```

- 前端：http://localhost:5173
- 后端 API：http://localhost:3000/api

## 默认账号

- 用户端：自行注册，或 seed 用户 `user_01` / `password123`
- 管理端：`admin` / `admin888`（无自助注册，由数据库 seed 预置）

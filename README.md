# 智能充电桩调度计费系统

这是一个用于课程项目的基础工程框架，采用 Vue3 / Electron 前端、Node.js / TypeScript 后端、MySQL、Redis 和 Python 调度算法服务。

## 架构

```text
用户客户端                    管理员客户端
Web / Electron               Web / Electron
     ↓                            ↓
     └────────── 前端页面 Vue3 ──────────┘
                         ↓
                 HTTP API / WebSocket
                         ↓
              Node.js / TypeScript 后端
                         ↓
        ┌────────────────┼────────────────┐
        ↓                ↓                ↓
   MySQL数据库        Redis队列缓存       Python调度算法服务
        ↓
  用户、车辆、充电桩、订单、详单、报表数据
```

## 目录结构

```text
charging-station-system/
  apps/
    client/              Electron + Vue3 前端
    server/              NestJS + TypeScript 后端
  services/
    scheduler/           Python FastAPI 调度算法服务
  docs/                  项目文档
  docker-compose.yml     MySQL + Redis
  .env.example           环境变量示例
```

## 快速开始

### 1. 安装 Node 依赖

```bash
npm install
```

### 2. 启动 MySQL 和 Redis

```bash
docker compose --env-file .env.example up -d
```

### 3. 初始化后端数据库

```bash
npm --workspace apps/server run prisma:generate
npm --workspace apps/server run prisma:migrate
```

### 4. 启动 Python 调度服务

```bash
cd services/scheduler
python -m venv .venv
.venv\Scripts\activate
pip install -e .[dev]
uvicorn app.main:app --reload --port 8100
```

### 5. 启动前后端

```bash
npm run dev
```

默认地址：

- Electron / Vue3 前端：由 electron-vite 自动打开
- Node.js 后端 API：http://localhost:3000/api
- Swagger 文档：http://localhost:3000/docs
- Python 调度服务：http://localhost:8100/docs

## 关键业务约定

订单状态统一为：

```text
WAITING
IN_PILE_QUEUE
CHARGING
FINISHED
CANCELED
ABORTED
```

修改请求规则：

- 只有 `WAITING` 状态允许修改模式和电量。
- `IN_PILE_QUEUE` 后不允许修改，只能取消后重新排队。

取消充电规则：

- 等候区取消：移出 WaitingQueue，状态 `CANCELED`。
- 充电区未充电取消：移出 PileQueue，状态 `CANCELED`。
- 正在充电用户主动结束：生成详单，状态 `FINISHED`。
- 故障或系统强制中断：生成详单，状态 `ABORTED`。

充电桩状态：

```text
physicalState: ON / OFF
workingState: IDLE / CHARGING / FAULT
```

批量最优调度：

- 接口不传 `mode`。
- 不区分快充和慢充。
- 所有车辆可分配任意类型充电桩。

## 分工

详见 [docs/team-division.md](docs/team-division.md)。

## 当前框架状态

当前版本是项目骨架，已经包含：

- Vue3 / Electron 页面框架
- 用户端基础页面
- 管理员端基础页面
- 调度算法面板
- NestJS 模块结构
- Prisma 数据库 schema
- Python FastAPI 调度服务
- 调度算法测试样例

下一步应优先完成真实数据库落库、Redis 队列缓存、WebSocket 推送和前后端接口联调。

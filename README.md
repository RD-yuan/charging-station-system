# 智能充电桩调度计费系统

这是一个用于课程项目的基础工程框架，采用 Vue3 Web 前端、Node.js / TypeScript 后端、MySQL、Redis 和 Python 调度算法服务。

## 架构

```text
用户端 / 管理端（统一 Vue3 Web 前端 apps/client）
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
    client/              Vue3 Web 前端（用户端 + 管理端）
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

- Vue3 前端：http://localhost:5173
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

## 演示账号

执行 `npm --workspace apps/server run prisma:seed` 后可用：

| 入口 | 用户名 | 密码 |
|------|--------|------|
| 管理端 `/auth?mode=admin` | `admin` | `admin123` |
| 用户端 `/auth?mode=user` | `user_01` | `user123` |

管理端不提供自助注册；用户端支持注册新账号。

## 相对 PR #1（JWT 鉴权合并）的本地修复

详见 [docs/backend-a-report.md §8](docs/backend-a-report.md#8-2026-06-15-本地修复相对-pr-1--41850d6)，摘要如下：

- **后端**：补全 `/user/login`、`/admin/login` 等路由注册；公开端点加 `@Public()`；修复 `tsx` 下 `@Inject` 依赖注入；seed 增加演示用户 `user_01`。
- **前端**：登录页默认账号与 seed 对齐；用户端登录/注册分 Tab；注册后自动登录拿 token；管理端响应对齐 `username` 字段。

## 当前框架状态

当前版本已包含：

- 统一 Vue3 Web 前端（用户端 + 管理端，`apps/client`）
- NestJS 模块结构 + JWT / 角色 / 订单归属鉴权
- Prisma 数据库 schema
- Python FastAPI 调度服务与 Node 本地降级策略
- Redis 队列缓存（Redis 不可用时业务自动降级）
- 标准 WebSocket 实时推送、用户订单恢复和日/周/月报表
- 演示用户、5 个充电桩和峰平谷计费规则 seed

## 队友连接主机数据库

主机已完成数据库初始化时，队友只需把根目录 `.env.example` 复制为 `apps/server/.env`，并将以下三项主机地址改为实际 IP：

```ini
DATABASE_URL=mysql://charging_app:charging_pass@10.29.52.22:3306/charging_station
REDIS_URL=redis://:redis_charging_2026@10.29.52.22:6379
SCHEDULER_SERVICE_URL=http://10.29.52.22:8100
```

然后执行：

```bash
npm install
npm --workspace apps/server run prisma:generate
npm run dev
```

队友模式不要执行 `prisma:migrate` 或 `prisma:seed`。如果 API 或 WebSocket 不在浏览器本机，可复制 `apps/client/.env.example` 为 `apps/client/.env` 并修改对应地址。

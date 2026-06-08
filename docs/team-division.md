# 项目分工建议

## 前端 A：用户客户端负责人

负责用户端全部页面和交互：

- 注册、登录。
- 提交充电请求。
- 修改充电请求。
- 取消充电。
- 查看排队状态。
- 开始充电、结束充电。
- 查看充电详单。

主要目录：

```text
apps/client/src/renderer/src/views/UserDashboard.vue
apps/client/src/renderer/src/api/
apps/client/src/renderer/src/stores/
```

## 前端 B：管理员客户端与 Electron 负责人

负责管理员端页面和桌面端打包：

- 管理员登录。
- 查看充电桩状态。
- 查看桩队列车辆。
- 启动/关闭充电桩。
- 故障上报。
- 故障重调度。
- 故障恢复。
- 报表展示。
- Electron 窗口和打包配置。

主要目录：

```text
apps/client/src/main/
apps/client/src/preload/
apps/client/src/renderer/src/views/AdminDashboard.vue
apps/client/src/renderer/src/views/DispatchDashboard.vue
```

## 后端 A：组长，架构与集成负责人

负责整体后端架构、接口文档和最终集成：

- NestJS 项目结构。
- Prisma schema。
- OpenAPI / Swagger。
- 状态枚举统一。
- 环境变量和启动脚本。
- 模块集成与代码审查。

重点检查：

- 订单状态是否只使用统一枚举。
- `IN_PILE_QUEUE` 是否禁止修改。
- 批量调度是否不传 `mode`。
- Redis 与 MySQL 是否一致。

主要目录：

```text
apps/server/src/app.module.ts
apps/server/src/common/
apps/server/prisma/
```

## 后端 B：用户、订单与队列负责人

负责用户、车辆、订单、排队号和队列生命周期：

- Auth / User。
- ChargingOrder。
- F/T 排队号生成。
- WaitingQueue。
- PileQueue。
- 提交、修改、取消充电请求。
- 查询排队状态。

主要目录：

```text
apps/server/src/modules/auth/
apps/server/src/modules/charging/
```

## 后端 C：充电桩、计费、详单与报表负责人

负责设备状态、充电过程、计费和报表：

- ChargingPile。
- ChargingSession。
- BillingDetail。
- 峰平谷计费。
- 用户详单。
- 管理员报表。
- 充电桩状态监控。

主要目录：

```text
apps/server/src/modules/pile/
apps/server/src/modules/report/
```

后续建议新增：

```text
apps/server/src/modules/billing/
apps/server/src/modules/session/
```

## 后端 D：调度算法与 Python 服务负责人

负责所有调度算法和 Python 服务：

- 基础最短完成时间调度。
- 故障优先级调度。
- 故障时间顺序调度。
- 故障恢复调度。
- 单次最优时长调度。
- 批量最优时长调度。
- Node.js Dispatch 模块对接 Python。

主要目录：

```text
apps/server/src/modules/dispatch/
services/scheduler/
```

## 协作规则

1. 接口先行，先维护 Swagger，再联调页面。
2. 前端不要私自写复杂状态判断，优先使用后端返回的状态和允许动作。
3. Python 只计算调度方案，不直接操作数据库。
4. Node.js 后端负责事务落库和 Redis 刷新。
5. 数据库最终状态以 MySQL 为准，Redis 只做缓存和锁。
6. 每个模块至少保留关键单元测试。

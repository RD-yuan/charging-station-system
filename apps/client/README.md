# 智能充电桩管理端（Admin）后端团队协作与接口交底文档

本文件旨在说明管理端前端（Admin Dashboard）的系统架构、视图逻辑以及与后端服务（NestJS API & FastAPI 调度算法服务）进行数据通信、实时推送、调度触发时的接口契约与协作流程。

---

## 📂 推荐项目目录规划

为了保障多端协同的健壮性，建议在主仓库 `charging-station-system` 的 `apps/` 目录下为管理端规划专属的结构空间：

```text
charging-station-system/
├── apps/
│   ├── admin/             # 👈 管理端前端 (Vue 3 + Tailwind CSS + TypeScript)
│   │   ├── src/
│   │   ├── README.md      # 本文档建议直接重命名存放在此路径下
│   │   └── package.json
│   ├── client/            # 用户端前端 (Electron + Vue 3)
│   └── server/            # 后端核心服务 (NestJS + TypeScript)
├── services/
│   └── scheduler/         # 智能规划算法服务 (Python FastAPI)
└── docs/                  # 系统级全局架构文档
```

---

## ⚡ 一、系统业务全景与核心视图

管理后台共包含 **5个核心业务视图**。在接入 NestJS 服务时，各视图对应的功能与接口归属如下：

### 1. 登录鉴权视窗 (`LoginView.vue`)
*   **交互逻辑**：管理员输入凭证进行签到，系统建立 Session，后续所有管理操作请求需在 Header 中携带 `Authorization: Bearer <token>`。
*   **后端支撑**：NestJS Auth Guard / JWT。

### 2. 控制台概览 (`DashboardView.vue`)
*   **核心功能**：
    1.  **全局状态汇总卡片**：直观反映当前“开启电桩数 (ON)”、“正在充电中 (CHARGING)”、“等候区派单数 (WAITING)”、“故障桩数 (FAULT)”。
    2.  **今日峰平谷收益报表**：根据当前的尖峰平谷时段计费规则，对今日累计服务电量及财务收益进行汇总展示。
    3.  **等候区派单车辆实时队列**：展示等待分配车位的排队序列（如：车牌、快/慢充类型、预计请求充电电量、用户账号等）。

### 3. 电桩状态监控 (`MonitorView.vue`)
*   **核心功能**：
    1.  **物理桩级联控制**：支持对集群内的指定充电桩执行**一键拉闸 / 启动电源**（`ON`/`OFF` 物理控制）。
    2.  **故障模拟与故障恢复**：支持对物理桩进行临时故障设置（如电控过载报错，模拟上报 `FAULT` 状态），或对受损设备进行后台复位（恢复为闲置 `IDLE` 或其他安全状态）。
    3.  **负载人工调度干预**：支持后台管理员一键强制执行当前等候队列重排与分配。

### 4. 运营统计报表 (`ReportView.vue`)
*   **核心功能**：
    1.  **收益汇总看板**：聚合历史所有的充放电订单数据。
    2.  **峰平谷多维环比图表**：以可视化图标直观对比各时段下的运营收益比重，用于辅助管理员手动调整或微调系统的时段计费系数。

### 5. WebSocket 仿真广播网关 (`WebSocketView.vue`)
*   **核心功能**：
    1.  **实时状态广播调试器**：由于充电桩在实际现场是通过网关每秒上报工作参数的，在答辩和联调演练中，该界面充当“硬件仿真器”，供后端开发同学观测实时链路的心跳日志。
    2.  **推送流日志查看器**：直接抓取由 NestJS 广播出来的现场状态报文。

---

## 🌐 二、HTTP REST API 接口定义规范

在对接管理端时，后端（NestJS）需要满足以下接口数据格式要求：

### 1. 管理员登陆
*   **请求类型**：`POST`
*   **终结点**：`/api/admin/auth/login`
*   **请求体 (JSON)**：
    ```json
    {
      "username": "admin",
      "password": "hashed_password"
    }
    ```
*   **响应体 (200 OK)**：
    ```json
    {
      "code": 200,
      "message": "success",
      "data": {
        "adminName": "超级管理员",
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
      }
    }
    ```

### 2. 获取控制台度量统计
*   **请求类型**：`GET`
*   **终结点**：`/api/admin/dashboard/stats`
*   **响应体 (200 OK)**：
    ```json
    {
      "code": 200,
      "data": {
        "activeCount": 4,          // 开启中的充电桩
        "chargingCount": 2,        // 充电中的电桩
        "waitingQueueCount": 3,    // 等候区派单队列中的车辆总数
        "faultCount": 0,           // 故障报警中的充电桩
        "overallEfficiency": 50    // 整体设备负载率 (%)
      }
    }
    ```

### 3. 三阶段时段计费规则获取/设定 (峰平谷)
*   **请求类型**：`GET` | `POST`
*   **终结点**：`/api/admin/billing/tariff-rules`
*   **响应体 / 请求体 (200 OK)**：
    ```json
    {
      "rules": [
        { "period": "Peak", "duration": "10:00-15:00 / 18:00-21:00", "price": 1.0 },
        { "period": "Flat", "duration": "07:00-10:00 / 15:00-18:00 / 21:00-23:00", "price": 0.7 },
        { "period": "Valley", "duration": "23:00-07:00 (次日)", "price": 0.4 }
      ]
    }
    ```

### 4. 物理桩硬拉闸与状态强制变更 (Monitor 业务)
*   **请求类型**：`POST`
*   **终结点**：`/api/admin/piles/:pileId/control`
*   **请求体 (JSON)**：
    ```json
    {
      "action": "TOGGLE_POWER", // 支持 "TOGGLE_POWER", "REPORT_FAULT", "RECOVER_PILE"
      "targetState": "ON"      // 或 "OFF", "FAULT", "IDLE"
    }
    ```
*   **说明**：后端收到该调用后，应立刻通过 Redis/WebSocket 同步通知该桩绑定的客户端组件，强制断开当前车辆充电进程。

---

## 🔌 三、WebSocket 实时推送契约

由于系统需要高度的**实时响应**，当用户下单排队、充电桩功率输出发生波动、设备断电或触发调度算法时，NestJS 后端必须通过 **WebSocket** 向管理员监控端广播事件。

*   **常规长连接机制**：一主多路复用，管理员登录后即建立 Socket 通信通道。
*   **主要广播事件群（Emitters）**：

### 1. 充电桩运行度量变更广播 (`pile_metrics_update`)
后端在收到充电桩的物理心跳后（例如每10个模拟秒一次），向管理员监控大屏推送该桩的详细电参。
*   **发往客户端的数据报文**：
    ```json
    {
      "event": "pile_metrics_update",
      "data": [
        {
          "id": "A-01",
          "name": "1号快速专用桩",
          "type": "FAST",
          "status": "CHARGING",
          "currentPower": "42.5",     // 当前充电功率(kW)
          "voltage": "380",           // 当前工作电压(V)
          "targetCar": "粤B·88888",
          "progress": 68              // 当前电量百分比 (%)
        }
      ]
    }
    ```

### 2. 调度区队列实时更新通知 (`waiting_queue_changed`)
每当大排队算法模块分配了新的车位，或者用户取消了充电请求。
*   **数据报文**：
    ```json
    {
      "event": "waiting_queue_changed",
      "data": [
        { "rank": 1, "carId": "T3", "type": "SLOW", "targetKwh": 25, "userAccount": "user_06", "checkInTime": "10:09:45" },
        { "rank": 2, "carId": "F4", "type": "FAST", "targetKwh": 30, "userAccount": "user_07", "checkInTime": "10:10:02" }
      ]
    }
    ```

---

## 🧠 四、FastAPI 智能规划算法微服务联调点

充电桩调度规划是整个系统的核心科技（搭载在 **FastAPI 粒子群/遗传规划调度系统 `services/scheduler/`** 里）。管理员管理端内置了主动调度的操作触点，需打通如下逻辑：

### 1. 手动触发调度重排 (Emergency Manual Reschedule)
当现场车流发生突发堆积，或有大批量故障桩报警、电网限电时。
*   **调用流向**：`Admin前端` -> `NestJS API` -> `FastAPI Scheduler (携带当前所有已接纳车辆与可用充电桩状态)` -> `计算得出重置组合分配结果并存入 Redis` -> `WebSocket 广播至两端 (Client & Admin) 局部刷新`。
*   **算法微服务输入格式建议 (FastAPI 接收端)**：
    ```json
    {
      "active_piles": ["A-01", "A-02"],
      "waiting_orders": [
        { "order_id": "ORD001", "car_type": "FAST", "required_electricity": 45.0, "arrival_timestamp": 1686362400 }
      ],
      "tariff_pricing": { "Peak": 1.0, "Flat": 0.7, "Valley": 0.4 }
    }
    ```

### 2. 时段价格对队列优先级的灵敏度权重
算法应当基于“计费波谷段（Valley）”自动优化。对于非紧急充电倾向（慢充）的排队车辆，FastAPI 调度应计算其在波谷段启动的经济性，并在计算结果中将此类车辆置于波谷充电的优先级策略。
当管理员通过管理端调高或调低时段单价时，此价格系数的变化应促发二次优化，后端须捕获更新并触发重新调度。

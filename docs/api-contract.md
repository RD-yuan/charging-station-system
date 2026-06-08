# API 契约草案

## 用户端

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录 |
| POST | `/api/charging/request` | 提交充电请求 |
| PUT | `/api/charging/:orderId/mode` | 修改充电模式，仅 WAITING |
| PUT | `/api/charging/:orderId/amount` | 修改请求电量，仅 WAITING |
| POST | `/api/charging/:orderId/cancel` | 取消充电 |
| GET | `/api/charging/:orderId/queue` | 查看排队状态 |
| POST | `/api/charging/:orderId/start` | 开始充电 |
| POST | `/api/charging/:orderId/stop` | 结束充电 |

## 管理员端

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/piles` | 查看所有充电桩状态 |
| GET | `/api/admin/piles/:pileId/queue` | 查看某桩队列车辆 |
| POST | `/api/admin/piles/:pileId/power-on` | 启动充电桩 |
| POST | `/api/admin/piles/:pileId/power-off` | 关闭充电桩 |
| POST | `/api/admin/piles/:pileId/fault` | 上报故障 |
| POST | `/api/admin/piles/:pileId/reschedule` | 执行故障重调度 |
| POST | `/api/admin/piles/:pileId/recover` | 恢复故障桩 |
| GET | `/api/admin/reports` | 获取报表 |

## Python 调度服务

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/dispatch/basic` | 基础最短完成时间调度 |
| POST | `/dispatch/fault-priority` | 故障优先级调度 |
| POST | `/dispatch/fault-time-order` | 故障时间顺序调度 |
| POST | `/dispatch/recovery-time-order` | 故障恢复调度 |
| POST | `/dispatch/single-optimization` | 单次最优时长调度 |
| POST | `/dispatch/batch-optimization` | 批量最优时长调度，不传 mode |

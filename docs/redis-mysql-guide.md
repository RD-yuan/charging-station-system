# Redis 与 MySQL 使用指南

> 更新日期：2026-06-14 | 当前环境：Windows 原生安装

## 一、概览

| 服务 | 版本 | 端口 | 用途 |
|------|------|------|------|
| MySQL | 8.0.41 (Windows) | 3306 | 数据最终状态，持久化存储 |
| Redis | 3.0.504 (Windows) | 6379 | 缓存 + 分布式锁，断电不保留 |

---

## 二、MySQL

### 连接信息

| 项 | 值 |
|------|------|
| 数据库名 | `charging_station` |
| 字符集 | utf8mb4 / utf8mb4_unicode_ci |
| 应用用户 | `charging_app` / `charging_pass` |
| 连接串 | `mysql://charging_app:charging_pass@localhost:3306/charging_station` |
| 环境变量 | `DATABASE_URL`（定义在 `apps/server/.env`） |

### 6 张表

```
charging_station
├── _prisma_migrations    # Prisma 迁移记录
├── user                  # 用户（含角色 USER/ADMIN）
├── chargingpile          # 充电桩（含状态和累计字段）
├── chargingorder         # 充电订单（核心表，含排队号、状态、外键）
├── chargingsession       # 充电会话（一次实际充电过程）
└── billingdetail         # 计费详单（费用固化后不可变）
```

### 默认管理员

| 账号 | 密码 | 角色 |
|------|------|------|
| `admin` | `admin123` | ADMIN |

### 常用命令

```bash
# 连接数据库
mysql -u charging_app -pcharging_pass charging_station

# 查看表结构
mysql -u root -p123456 charging_station -e "DESCRIBE ChargingOrder"

# 查订单状态
mysql -u root -p123456 charging_station -e "SELECT id, queueNo, status, chargeMode FROM ChargingOrder"

# 重置数据库（重新迁移）
cd apps/server
npx prisma migrate reset
npm run prisma:seed
```

### 代码中使用

```typescript
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class YourService {
  constructor(private readonly prisma: PrismaService) {}

  async example() {
    // 查询
    const user = await this.prisma.user.findUnique({ where: { id: userId } })

    // 关联查询
    const order = await this.prisma.chargingOrder.findUnique({
      where: { id: orderId },
      include: { user: true, assignedPile: true }
    })

    // 创建
    await this.prisma.chargingOrder.create({ data: { ... } })

    // 更新
    await this.prisma.chargingOrder.update({ where: { id }, data: { ... } })
  }
}
```

`PrismaModule` 是 `@Global()` 的，任意模块直接注入即可。

---

## 三、Redis

### 运行信息

| 项 | 值 |
|------|------|
| 安装目录 | `D:\Program Files\Redis` |
| 配置文件 | `D:\Program Files\Redis\redis.windows.conf` |
| 数据文件 | `D:\Program Files\Redis\dump.rdb`（RDB 快照） |
| 持久化方式 | RDB（自动触发：900s内1次变更 / 300s内10次 / 60s内10000次） |
| AOF | 关闭 |

### 启停命令

```bash
# 启动（使用配置文件）
"D:\Program Files\Redis\redis-server.exe" "D:\Program Files\Redis\redis.windows.conf" --port 6379

# 停止
"D:\Program Files\Redis\redis-cli.exe" shutdown

# 检查是否运行
"D:\Program Files\Redis\redis-cli.exe" ping
# 返回 PONG = 正常
```

### 代码中使用

```typescript
import { RedisService } from '../../redis/redis.service'

@Injectable()
export class YourService {
  constructor(private readonly redis: RedisService) {}

  async example() {
    // ── 基础缓存 ──
    await this.redis.set('key', 'value', 60)         // 写入，60秒过期
    const val = await this.redis.get('key')           // 读取
    await this.redis.del('key')                       // 删除

    // ── 队列操作（List） ──
    await this.redis.queuePush('waiting:FAST', 'order-1')     // 队尾入队
    const id = await this.redis.queuePop('waiting:FAST')      // 队首出队
    const all = await this.redis.queueRange('waiting:FAST')   // 查看全部
    const len = await this.redis.queueLength('waiting:FAST')   // 队列长度
    await this.redis.queueRemove('waiting:FAST', 'order-1')   // 移除指定

    // ── 分布式锁 ──
    const ok = await this.redis.lock('lock:dispatch:FAST', 5000)
    if (ok) {
      // ... 执行调度 ...
      await this.redis.unlock('lock:dispatch:FAST')
    }

    // ── 健康检查 ──
    if (!await this.redis.ping()) {
      // Redis 不可用 → 降级：直接走 MySQL
    }
  }
}
```

`RedisModule` 是 `@Global()` 的，任意模块直接注入即可。

### Key 命名约定

| 模式 | 类型 | 用途 |
|------|------|------|
| `waiting:{FAST\|SLOW}` | List | 等候区订单 ID 队列 |
| `pile:{pileId}:queue` | List | 某桩的专属队列 |
| `pile:{pileId}:state` | String | 桩状态 JSON 快照 |
| `lock:dispatch:{FAST\|SLOW}` | String | 调度分布式锁 |
| `lock:dispatch:fault:{pileId}` | String | 故障调度锁 |

---

## 四、Redis + MySQL 协作模式

```
┌──────────────┐
│   Service    │
└──────┬───────┘
       │
       写入
       │
       ▼
   ┌───────┐  OK?   ┌───────┐
   │ MySQL │────────▶│ Redis │  刷新缓存
   └───────┘         └───────┘

       读取
       │
       ▼
   ┌───────┐  miss?  ┌───────┐
   │ Redis │────────▶│ MySQL │  回填 Redis
   └──┬────┘         └───────┘
      │ hit?
      ▼
   返回数据
```

**规则：**
- **写**：先 MySQL，成功后刷 Redis
- **读**：先 Redis，未命中查 MySQL 并回填
- **Redis 挂了**：应用不崩溃，直接走 MySQL，`ping()` 返回 false 时降级
- **MySQL 是数据源**，Redis 是缓存——Redis 清空不影响持久数据

---

## 五、环境变量

### 主机（你的机器）

`apps/server/.env`：

```ini
DATABASE_URL=mysql://charging_app:charging_pass@localhost:3306/charging_station
REDIS_URL=redis://:redis_charging_2026@localhost:6379
JWT_SECRET=change-me-in-development
SCHEDULER_SERVICE_URL=http://localhost:8100
PORT=3000
```

### 队友（远程连接）

队友的 `apps/server/.env` 中 `DATABASE_URL` 和 `REDIS_URL` 需改为：

```ini
DATABASE_URL=mysql://charging_app:charging_pass@10.29.52.22:3306/charging_station
REDIS_URL=redis://:redis_charging_2026@10.29.52.22:6379
```

> 将 `10.29.52.22` 替换为你当前的局域网 IP（`ipconfig` 查看）。

---

## 六、远程访问配置

### 当前状态

| 服务 | 监听地址 | 密码 | 防火墙 |
|------|----------|------|--------|
| MySQL | `*`（所有接口） ✅ | `charging_pass` ✅ | **需手动开放** ⚠️ |
| Redis | `0.0.0.0` ✅ | `redis_charging_2026` ✅ | **需手动开放** ⚠️ |

### 主机需要手动执行的命令（管理员 PowerShell）

```powershell
# 开放 MySQL 3306
netsh advfirewall firewall add rule name="MySQL Remote" dir=in action=allow protocol=TCP localport=3306

# 开放 Redis 6379
netsh advfirewall firewall add rule name="Redis Remote" dir=in action=allow protocol=TCP localport=6379

# 验证已添加
netsh advfirewall firewall show rule name="MySQL Remote"
netsh advfirewall firewall show rule name="Redis Remote"
```

### 队友验证连接

队友在各自机器上测试：

```bash
# 测试 MySQL（替换 10.29.52.22 为主机当前 IP）
mysql -u charging_app -pcharging_pass -h 10.29.52.22 -P 3306 charging_station -e "SELECT 1"

# 测试 Redis
redis-cli -h 10.29.52.22 -p 6379 -a redis_charging_2026 ping
```

返回 `PONG` 或 `1` 即表示连接成功。

### 故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| `Can't connect to MySQL server` | 防火墙未开放 | 执行上面 PowerShell 命令 |
| `Access denied for user` | 用户权限问题 | 已在 MySQL 中创建 `'charging_app'@'%'`，如果 IP 变了可能需要重建 |
| `NOAUTH Authentication required` | Redis 需要密码 | REDIS_URL 中带上 `:redis_charging_2026@` |

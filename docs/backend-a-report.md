# 后端 A 完成报告 —— 供全体成员参考

> 更新日期：2026-06-14 | 负责人：架构/集成

## 1. 环境变更

### 新增依赖

```bash
cd apps/server
npm install
```

新增包：`@nestjs/jwt`、`@nestjs/passport`、`passport`、`passport-jwt`、`bcryptjs`、`@types/passport-jwt`、`@types/bcryptjs`

### 数据库迁移

**首次启动前必须执行**（MySQL Docker 运行后）：

```bash
npm --workspace apps/server run prisma:migrate
npm --workspace apps/server run prisma:seed     # 创建默认管理员
```

Schema 新增 `UserRole` 枚举（USER / ADMIN）和 `User.role` 字段。

**默认管理员账号：** `admin` / `admin123`

### .env 文件

已包含 `JWT_SECRET=change-me-in-development`，无需额外配置。

---

## 2. 认证体系（所有成员必读）

### 安全模型

```
公开（无需 token）:
  POST /api/auth/register
  POST /api/auth/login

需要登录（JWT Bearer token）:
  所有 /api/charging/* 、/api/dispatch/*

需要管理员（JWT + role=ADMIN）:
  所有 /api/admin/*
```

### 注册与登录

```
POST /api/auth/register  { username, password, batteryCapacity? }
POST /api/auth/login     { username, password }
→ 返回 { accessToken, userId, username, role }
```

密码已用 bcryptjs（10轮）哈希存储。登录返回真实 JWT（24h 有效）。

### 前端调用方式

```typescript
// 登录后保存 token
localStorage.setItem('access_token', data.accessToken)

// 所有后续请求携带
Authorization: Bearer <accessToken>

// 前端已有的 http.ts 拦截器会自动处理（已配置）
```

---

## 3. 后端开发规范

### 新接口默认需要认证

全局 `JwtAuthGuard` 已注册——**所有新接口默认需要 token**。如需公开访问：

```typescript
import { Public } from '../../common/decorators/public.decorator'

@Public()
@Post('some-public-endpoint')
```

### 管理员接口

```typescript
import { Roles } from '../../common/decorators/roles.decorator'
import { RolesGuard } from '../auth/guards/roles.guard'

@UseGuards(RolesGuard)
@Roles('ADMIN')
@Controller('admin/...')
```

### 获取当前用户

```typescript
import { CurrentUser } from '../../common/decorators/current-user.decorator'

// 获取完整用户对象 { userId, username, role }
@CurrentUser() user: JwtPayload

// 获取单个字段
@CurrentUser('userId') userId: string
```

### 异常处理

全局异常过滤器已统一格式，直接 `throw new HttpException(...)` 即可：

```json
{
  "statusCode": 400,
  "message": "Only WAITING orders can be modified.",
  "error": "BadRequest",
  "timestamp": "2026-06-14T...",
  "path": "/api/charging/xxx/mode"
}
```

### 统一枚举

所有状态必须使用 `src/common/enums.ts` 中的枚举：`OrderStatus`、`ChargeMode`、`PhysicalState`、`WorkingState`、`DispatchStrategyType`。

---

## 4. 接口变更（Breaking Changes）

### Charging 模块

| 变更 | 说明 |
|------|------|
| `SubmitChargingRequestDto.userId` | **已移除**。userId 现在从 JWT token 自动提取 |
| `POST /charging/request` | 不再需要传 `userId` 字段 |

### Dispatch 模块

| 原路径 | 新路径 | 说明 |
|------|------|------|
| `POST /dispatch/basic/:mode` | `POST /dispatch/basic` | mode 改为 body 字段 `{ "mode": "FAST" }` |
| （缺失） | `POST /dispatch/recovery-time-order` | 新增恢复调度端点 |

### Admin 模块

所有 `/api/admin/*` 端点现在需要 ADMIN 角色的 JWT token，否则返回 403。

---

## 5. 后端 B / C / D 注意事项

| 角色 | 关键提示 |
|------|----------|
| **后端 B**（订单/队列） | `submitRequest(dto, userId)` 签名已变更；userId 来自 `@CurrentUser()` |
| **后端 C**（充电桩/计费） | admin 端点已加 `@Roles('ADMIN')` 保护，无需额外处理 |
| **后端 D**（调度） | 新增 `triggerRecoveryTimeOrder()` 方法；`triggerBasic` 参数不变 |

---

## 6. 已知待办

| 事项 | 优先级 | 备注 |
|------|--------|------|
| 执行 `prisma migrate dev` | 🔴 高 | 需要 Docker MySQL 启动后才能跑 |
| `recovery-time-order` 参数 | 🟢 低 | 当前发空 body，Python 侧可能需要 `pile_id` 等参数 |

---

## 7. 新增文件清单

```
src/common/
  decorators/
    public.decorator.ts          # @Public()
    roles.decorator.ts           # @Roles('ADMIN')
    current-user.decorator.ts    # @CurrentUser()
  filters/
    all-exceptions.filter.ts     # 全局异常格式

src/modules/auth/
  strategies/
    jwt.strategy.ts              # Passport JWT 策略
  guards/
    jwt-auth.guard.ts            # JWT 认证守卫
    roles.guard.ts               # 角色守卫

src/modules/dispatch/dto/
  dispatch.dto.ts                # Dispatch DTO

src/modules/pile/dto/
  pile.dto.ts                    # RescheduleDto
```

---

## 8. 2026-06-15 本地修复（相对 PR #1 / `41850d6`）

> 以下改动已在 main 分支推送，解决合并前端 + JWT 鉴权后**无法登录、接口 404/401** 等问题。

### 后端

| 问题 | 修复 |
|------|------|
| `POST /api/user/login`、`/api/user/register`、`/api/admin/login` 返回 404 | `AuthModule` 注册 `UserAuthAliasController`、`AdminAuthController`、`AdminAuthAliasController`（此前仅注册了 `/api/auth/*`） |
| 登录/注册被全局 JWT 守卫拦截 | 上述公开端点加 `@Public()` |
| `tsx` 运行时 Nest 依赖注入失败（`undefined` 注入） | `AuthService`、`JwtStrategy`、`JwtAuthGuard`、`RolesGuard`、`RedisService`、`main.ts` 等补 `@Inject()` |
| Redis 模块读不到配置 | `RedisModule` 导入 `ConfigModule` |
| seed 仅有 admin，无演示用户 | 新增 `user_01` / `user123`（USER 角色，60 kWh） |

### 前端（`apps/client/src/views/AuthView.vue`）

| 问题 | 修复 |
|------|------|
| 默认密码与 seed 不一致（`admin888`） | 改为 `admin` / `admin123`、`user_01` / `user123` |
| 管理端登录读 `adminName`，后端返回 `username` | 对齐响应字段 |
| 用户端登录页仍显示电池容量，`step=5` 导致 60 非法 | 登录/注册分 Tab；容量仅注册时填写，`step=1` |
| 注册接口不返回 `accessToken` | 注册成功后自动再调 `/user/login` 拿 token |

### 演示账号（与 seed 一致）

| 入口 | 用户名 | 密码 |
|------|--------|------|
| 管理端 | `admin` | `admin123` |
| 用户端 | `user_01` | `user123` |

### 已知未改项

- **电桩监控页空白**：当前 seed **不创建** `ChargingPile` 记录，需另行初始化桩数据或扩展 seed。
- 数据库迁移文件表名大小写不一致时，建议用 `prisma db push` + `prisma:seed`，慎用 `prisma migrate dev`。

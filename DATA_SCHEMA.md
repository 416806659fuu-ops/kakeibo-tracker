# 数据结构参考

这份文档描述「家庭记账」这个 app 本机保存/和后端同步的数据长什么样，来源是 `app.js` 的
`defaultState()`、`expense.js` 里记录（record）的字段、`settings.js` 里设置项的字段。
以后改字段的时候记得回来同步这份文档。

和「健康记录小工具」那两个 app 最大的不同：那两个 app 是整份状态打包同步，这里因为
FUU 和 MORI 两人会各自在自己手机上记账，是真正的多设备并发写入，所以改成了「按条记录」
同步——每一笔支出是独立的一条记录，各自有自己的 `id` 和 `updatedAt`，不是整份状态里的
一个字段。

## 顶层结构

```json
{
  "records": ["...见下"],
  "settings": {
    "paymentMethods": ["現金", "電子マネー", "VIEWカード", "..."],
    "fixedCosts": { "家賃": 0, "倉庫": 0, "...": "见下" },
    "categories": [{ "name": "食料品", "vendors": ["いなげや", "..."] }, "...": "见下"]
  }
}
```

本机另外还存了几样不参与服务器同步的东西（纯本机偏好/暂存数据）：
- `localStorage['kakeibo-identity']`：这台设备是 FUU 在用还是 MORI 在用，只用来决定
  记一笔时默认选中哪个人，从不上传。
- `localStorage['api_url']` / `localStorage['api_token']`：这台设备连的 Apps Script
  后端地址和密码。
- `kakeibo-pending-ops-v1`（localStorage + IndexedDB 镜像）：待同步队列，见下方
  「同步机制」一节。

## `records[]`

每一笔支出一条记录：

```json
{
  "id": "a1b2c3d4-...",
  "date": "2026-08-02",
  "category": "食料品",
  "vendor": "成城石井",
  "description": "咖啡、水",
  "amount": 1500,
  "paymentMethods": ["電子マネー", "SMBCカード"],
  "person": "MORI",
  "updatedAt": "2026-08-02T10:07:17.333Z",
  "deleted": false
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 已同步过的记录是服务器用 `Utilities.getUuid()` 分配的正式 id；本机新建但还没同步成功的记录，`id` 是本机生成的临时 id，格式固定 `tmp-` 开头 |
| `date` | string | `YYYY-MM-DD` |
| `category` | string | 消费项目分类，来自 `settings.categories` 里的某个 `name`，也可以是空字符串（不选） |
| `vendor` | string | 供应商/商家，可为空；选好 `category` 后表单会弹出该分类下的常用供应商快捷按钮，点一下直接填进这里，也可以手动打字 |
| `description` | string | 项目说明，历史遗留字段——UI 上已经和 `category` 合并成一件事，不再单独有输入框，新记录一律是空字符串；老记录如果这个字段有值，编辑时会自动并进 `vendor` 里 |
| `amount` | number | 金额，日元，必须 > 0 |
| `paymentMethods` | string[] | 支付方式，支持多选组合（如 `["JALカード","SMBCカード"]`），也可以是空数组 |
| `person` | string | `"FUU"` / `"MORI"` / `"SHARED"`（共用，两人共同的支出，显示成中文"共用"，见 `PERSON_LABELS`） |
| `updatedAt` | string | ISO 时间戳，**服务器打的**（`upsert` 时由 `Code.gs` 用 `new Date().toISOString()` 生成），本机新建但没同步过的记录用的是本机生成的临时时间戳，仅用于本机排序，不作为合并依据的权威时间 |
| `deleted` | boolean | 软删除标记；被删除的记录不会从服务器表里物理删掉，只是标记为 `true`（墓碑），本机的 `activeRecords()` 会把这些过滤掉不显示 |

## `settings.paymentMethods`

支付方式候选列表，种子数据见 `app.js`/`backend-gas/Code.gs` 里的 `DEFAULT_PAYMENT_METHODS`。
用户可以在「记一笔」或「设置」页里随手打字新增，新增的会存进这个数组，两台设备下次同步后
都能看到。

## `settings.fixedCosts`

固定出費参考表，键是费用名称（`家賃`/`倉庫`/`通信`/`ジム`/`iCloud`/`娯楽`/`電気`/`光熱`/
`ガス`/`水道`），值是数字（日元，默认 0，在设置页里填）。**这张表纯参考，不会被计入任何
月度合计**——原始参考表（MORI家出費記録）里这张表和月度流水之间没有公式关联，v1 保持这个
设计，不臆造分摊/结算规则。

## `settings.categories`

消费项目分类列表，每项 `{ name, vendors }`：`name` 是分类名，`vendors` 是这个分类下的
常用供应商快捷列表（可以为空数组，比如「外食」——因为吃饭去哪家店每次都不一样，没有固定
供应商可以预设）。种子数据（`DEFAULT_CATEGORIES`，`app.js`/`backend-gas/Code.gs` 两边
保持一致）是把「MORI家出費記録」参考表里 4 个月的真实历史记录翻了一遍，数出现频率最高的
5 类实际得出的：

| 分类 | 常用供应商 | 依据 |
|---|---|---|
| 食料品 | いなげや / 肉のハナマサ / まいばすけっと | 用户确认 + 历史里出现频率最高的类别 |
| 咖啡 | 711 / ファミマ / LAWSON / ミニストップ | 用户确认 |
| 交通 | JR / メトロ / つくばTX | 历史里交通类记录（多为「交通系IC」支付、JR/地铁路线说明）出现频率很高，仅次于食料品 |
| 网购 | AMAZON / taobao / 京东 | 历史里这几个供应商反复出现 |
| 外食 | （无预设，供应商手动填） | 历史里"外食"这个说明常出现，但每次去的餐厅不一样，没有固定供应商 |

用户可以在「记一笔」或「设置」页里随手打字新增分类/常用供应商，新增的会存进这个数组，
两台设备下次同步后都能看到。

## 派生指标（不持久化）

以下数值都是前端实时算出来的，不存进 `records`/`settings`，改动计算逻辑不需要迁移数据：

- 月度总支出（某人）= `Σ amount`，其中 `!deleted && date 属于该月 && person === 该人`
- 月度总支出（全部）= `Σ amount`，其中 `!deleted && date 属于该月`
- 固定出費参考表**不参与**以上任何合计

## 同步机制（`pendingOps` 待同步队列，不是持久化数据模型的一部分，但影响本机行为）

本机维护一个待同步操作队列，元素形如：

```json
{ "opId": "...", "type": "upsert", "isNew": true, "tempId": "tmp-...", "id": null, "record": { "...": "见上" } }
{ "opId": "...", "type": "delete", "id": "..." }
{ "opId": "...", "type": "saveSettings", "settings": { "...": "见上" } }
```

- 新增/编辑一条记录都产生一个 `upsert` 操作；同一条记录如果还有未发出去的 `upsert` 排在
  队列里，会被新的替换掉，不会连续发两次请求。
- 删除一条从未同步成功过的记录（`id` 还是 `tmp-` 开头），会直接把队列里对应的 `upsert`
  撤销，不会产生 `delete` 请求（服务器压根没见过这条记录）。
- 队列按顺序逐条发送，服务器返回正式 `id` 后，本机缓存和队列里后续还引用同一个临时 id
  的操作都会一并改写（`reconcileId`）。
- 从服务器拉取最新数据时（`mergeServerData`）：本机还有待同步操作的记录，服务器版本一律
  不采用（早晚会被这条待同步操作覆盖过去）；其余记录按 `updatedAt` 谁新用谁——两人各自
  编辑不同记录不会互相覆盖，撞上同一条也只丢失较旧的那次编辑，不会丢掉整个数据集。

---
改动 `records`/`settings` 的字段时，记得回来同步这份文档。

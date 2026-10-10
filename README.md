# 法律案源线索

面向律师的**法律案源线索**。从公开事件发现潜在法律服务需求，保留原始来源、发布时间、事件时间、业务类别、推断理由与待人工核验状态。新闻事件不能等同已确认案件或客户；不采集非公开个人资料，不自动联系潜在客户。

基于 [KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT)，起始版本 `9848e936106db037d99a304887c36aad3fd0fad4`。保留 MIT [LICENSE](LICENSE)、[NOTICE](NOTICE) 与第三方字体许可；本站采用独立天平图标，不使用上游Logo。原框架说明见 [上游 README](docs/upstream-readme.md)。

## 第一版

- `/leads`：关键词与法律业务类别搜索，规则推断候选理由，来源及日期、待人工核验状态。
- 3条有官方原文依据的人工整理历史参考事件，可在没有模型凭据时检索。明确标注非实时、非模型结果。
- 延续框架的事件、阅读索引、RSS/API/MCP与后台能力；首页提供线索搜索入口。
- 法律行业分类和提示词；数值门槛保留，需法律样本校准。
- [信源证据与筛选边界](docs/legal-sources.md)、[迭代待办](docs/ROADMAP.md)。

**当前边界**：已适配7个官方信源并提供本机 Codex/ChatGPT 客户端处理模式。示例配置仍默认关闭采集和模型；本次获授权的本机运行已启用。来源覆盖、法律评分校准、业务有效性和客户验收仍有缺口，不能称全量案源系统。条款与隐私页仍需运营者上线前确认。最新自动PDF采集、招募附件核验及模型额度阻塞见 [10月10日真实运行记录](docs/LIVE-RUN-20261010.md)。

## 本机运行

要求 Node.js ≥24.11、PostgreSQL16/17。安装 `npm ci`，运行 `node scripts/init-env.ts` 生成专属随机本机凭据；不要复用其他项目密钥，禁止提交 `.env` 与 `.data`。

本机 `.env` 添加：

```dotenv
DATABASE_URL=postgres://你的本机用户@127.0.0.1:5432/lawhot
API_BASE_URL=http://127.0.0.1:3001
API_HOST=127.0.0.1
COLLECT_ENABLED=false
MODEL_CALLS_ENABLED=false
```

```sh
createdb lawhot
node --env-file=.env scripts/migrate.ts
node --env-file=.env scripts/seed.ts
npm run build -w @aihot/web
node --env-file=.env apps/api/src/main.ts
# 第二个终端
cd apps/web
NODE_ENV=production node --env-file=../../.env server.ts
```

访问 `http://localhost:3000/leads`。模型经过后端回执/预算机制调用，读者页面不触发模型。启用自动采集与处理、本机客户端模型及 macOS 登录后台的方法见 [本机持续运行](docs/local-runtime.md)。本机自动导出并发布公开静态版见 [GitHub Pages 公开版](docs/public-pages.md)。

## 验证

```sh
npm run typecheck
DATABASE_URL=postgres://你的本机用户@127.0.0.1:5432/lawhot_test npm test
npm run build -w @aihot/web
node --test apps/web/tests/*.test.ts
node scripts/smoke.ts --base http://localhost:3000
node scripts/leads-smoke.ts http://localhost:3000
```

测试数据库名称必须以 `_test`/`_ci` 结尾，账号需有建库权限。测试用本地假服务，不证明真实模型调用。GitHub Actions继承框架验证流程，新增功能测试随主测试运行。

维护时按“来源核验 → 单条适配 → 日期/去重验证 → 人工样本校准 → 受控启用”推进。每日采集使用项目 worker 的 PostgreSQL 持久队列与调度；未部署外部生产。

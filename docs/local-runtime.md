# 本机持续运行

核验起始日：2026-10-04，时区 Asia/Shanghai。这是当前 Mac 用户登录后的后台服务；电脑关机、休眠或用户退出时不承诺执行。唤醒/重新登录后，持久队列与信源 next_fetch_at 继续处理到期任务，已有模型回执会复用。

## 模型客户端

本机先运行 `codex login status` 确认 ChatGPT 登录。项目调用官方 `codex exec`，不提取登录凭据，不使用其他项目的 API key。此模式消耗当前 ChatGPT 账号的 Codex 用量，受账号可用模型、额度及登录状态限制；回执记录实际 CLI 用量，人民币费用未知时保持 null。

```dotenv
LLM_PROVIDER=codex-client
CODEX_CLI_PATH=/本机/codex/完整路径
CODEX_MODEL=gpt-6.1-sol
CODEX_REASONING_EFFORT=high
CODEX_TIMEOUT_MS=180000
MODEL_CALLS_ENABLED=true
COLLECT_ENABLED=true
SOURCE_ADAPT_INTERVALS_ENABLED=false
```

`CODEX_CLI_PATH` 可由 `command -v codex` 得到；登录后台使用完整路径避免 PATH 差异。调用在临时目录、只读沙箱、关闭 shell/网页/插件等工具下运行，输入材料作为不可信数据。结构化任务适用时由 JSON Schema 限制输出，再经过现有 Zod 校验；动态键任务采用提示词和最终 Zod 校验。超时、未知结果、工具调用均不冒充成功。

后台“设置”可调整 `llm` 请求预算。本次设为每分钟10、每小时240、滚动24小时400次；达到预算时任务等待，不绕过熔断。两次评分仍是独立请求。后续换回 API 时设置 `LLM_PROVIDER=openai-compatible` 并填写 `LLM_BASE_URL/LLM_API_KEY/LLM_MODEL`，既有处理能力及回执不变。

单独核验真实客户端及回执复用：

```sh
node --env-file=.env scripts/model-client-check.ts
```

这个脚本检查固定的历史公告生效日期例子，成功只证明该客户端调用及回执链；不等同法律内容全面质量验收。

## 登录后台

要求原仓库的 Node24、PostgreSQL17 集群 `.data/postgres`、已构建的 web 和 `.env`。首次安装先正常关闭本项目手动进程和数据库；脚本拒绝复制活动数据库。不要停止其他项目服务。

```sh
node scripts/local-services.ts install
node scripts/local-services.ts status
node scripts/local-services.ts stop
node scripts/local-services.ts start
```

从原仓库执行这些命令；不要在运行副本中执行安装器。脚本在当前用户 `~/Library/LaunchAgents` 创建以项目绝对路径 hash 区分的4个标签：postgres、api、web、worker。运行副本位于 `~/Library/Application Support/AI-HOT-ON-LAW/<项目hash>`，避开后台进程对Documents目录的额外授权要求。首次冷复制保留原库及备份；此后运行副本中的数据库是实际业务库，原库不再更新，禁止同时启动两份。只操作这4个标签；配置文件不包含密钥，原仓库 `.env` 在install时复制到运行副本（权限0600），供进程加载。`install` 会重载这4个服务的定义，按消费者先停、数据库后停的顺序执行，有界等待数据库停机，然后同步代码副本；保留已有运行数据和凭据。`stop/start` 可恢复运行。数据库、API和Web仅监听127.0.0.1，数据库端口55432。实际日志与数据位于运行副本 `.data/`，原仓库 `.data/live-20261004`保留原始批次与pre-live.dump备份，均不得提交。运行副本根及数据目录权限0700。改原仓库配置或源码后重新build（如涉及前端），再install接管；仅start不会同步配置。LaunchAgent环境设置有效locale以避免PostgreSQL在macOS后台启动失败。

启动成功需要同时核验 launchctl 状态/PID、实际进程入口、对应端口和 `/api/health`。单独的 loaded 输出只证明 launchctl 接收了注册。

## 调度

5个信源成功后间隔1440分钟；每分钟调度器检查 next_fetch_at。`SOURCE_ADAPT_INTERVALS_ENABLED=false` 阻止改成自动频率；采集失败仍采用现有退避重试（最长6小时，预算阻塞15分钟）。处理与补偿每5分钟检查，热榜每5分钟计算，热度每小时存快照。日报每天08:00起、每半小时检查未生成的应出期次。

日报日期D覆盖北京时间 `[D-1 08:00,D 08:00)`，只取符合条件的非回填资料。历史首导入保持原始日期，不进入当日日报或热度。热榜要求48小时窗口中至少2个独立参与者。没有合格资料时这些页面可以为空，不伪造热度、日期、日报或收藏。读者的收藏仍由读者自己操作。

# WorkBuddy 每日执行入口

本机任务迁移准备，2026-10-13。WorkBuddy 任务由协调界面配置，本说明不创建任务。

WorkBuddy 执行模型固定为 **DeepSeek V4.1 Flash**，不使用自动选模，由协调界面配置并验证。此设置不覆盖应用内部模型：现有后端仍调用Codex客户端，受其账号额度和回执预算约束，费用未知不能宣称零成本。换成其他内部提供方需独立核对可用模型、项目专属凭据、计费和结构化结果兼容性；本次不换提供方、不借密钥、不发收费验证请求。

## 准确目录与环境

- 源码：`/Users/zhanghongqian/Documents/Codex项目/AIhot-law`。
- 实际数据与服务：`/Users/zhanghongqian/Library/Application Support/AI-HOT-ON-LAW/0721047ef4`。
- Node：运行副本的 `.runtime/node`（24.21.0），系统 Node 22 不符合后台测试要求。
- PostgreSQL 17：127.0.0.1:55432，lawhot；API 3001，网页 3000。
- 运行参数只从运行副本 `.env` 读取，禁止输出内容、复制到其他项目或提交。
- 数据库、采集开关、模型客户端路径、模型选择及公开发布参数已配置；配置存在不证明模型额度可用。当前真实模型仍由后端 `codex-client / gpt-6.1-sol / high` 调用本机登录态。WorkBuddy 是任务执行者，不使用 Codex 聊天或聊天派发；更换调度器不会更换模型服务或消除额度限制。

## 调度交接

`WORKER_SCHEDULES_ENABLED=false` 时，worker 保留队列消费者，但不注册自动定时器，并撤掉现有定时器。手动任务通过 `scripts/dispatch-task.ts` 派发；只要数据库还有自动定时器，入口拒绝执行，防止混合调度。

迁移范围仅本机应用的16项自动触发，包括采集检查、内容扫描、翻译、归组关联、热榜、日报、恢复/运维及Pages。定时器撤销不删除业务材料、回执、历史运行记录或队列。迁移前应确认无active/created/retry作业并保存原配置和定时器清单；若有进行中付费请求先正常收尾，不强杀。原服务的KeepAlive仅守护手动worker，不会触发每日采集。

Codex `automation-2` 由拥有该自动化的协调界面停用。WorkBuddy 每日09:00（Asia/Shanghai）任务由该界面创建；不能把说明文件当作已配置任务。其他项目及其任务不变。

本机交接已执行：原worker正常停止，在无active/created/retry作业的检查结果下保存源及runtime环境、旧worker代码至源码忽略目录`.data/workbuddy-migration-20261013`，两处环境设置手动模式，仅同步worker两文件及入口脚本，重启worker。迁移后自动定时器应为0，数据库/API/Web仍保留。没有运行采集派发、模型调用、外部发布或修改凭据。协调聊天另已报告Codex自动化全部PAUSED，此处不代其操作或声称已独立读回。

## 可直接交给 WorkBuddy 的完整任务指令

每天北京时间09:00，在本机执行法律案源线索搜索的实际采集、处理、日报检查和结果验证。只操作上述项目及运行副本；先读源码根目录AGENTS.md、README.md、本文件和最新LIVE-RUN记录。不得向Codex或其他聊天派发工作。

1. 检查四个本机服务及数据库，确认runtime marker指向上述源码、`WORKER_SCHEDULES_ENABLED=false`、pgboss.schedule为空、无另一个WorkBuddy运行正在执行。若已有任务未结束，不启动第二轮。记录北京时间和本轮开始时间。服务不在时通过已核实的本机LaunchAgent恢复，不能安装新库或覆盖数据库。环境和凭据只检查可用性，不打印值。
2. 使用以下通用入口，按步骤调用。每条仅表示入队，必须核对该队列作业终态和业务数据，不能将queued当作完成。入口出错立即调查，不能绕开自动调度检查。

```sh
cd '/Users/zhanghongqian/Library/Application Support/AI-HOT-ON-LAW/0721047ef4'
./.runtime/node --env-file=.env scripts/dispatch-task.ts sources.schedule
```

本步骤按已配置来源的到期时间实际采集。等待来源抓取、正文提取、文章分析、归组和摘要队列结束；再每5分钟调用一次 `content.sweep`，最多等待30分钟，以原预算/回执处理未完成的到期工作。不要为了让数字增加强制遍历未到期源或重发成功调用。记录每个fetch_run的原来源、读取/新增/修订/失败数量。

3. 依次以相同命令替换任务名为 `stories.links`、`content.translate`、`hot.rank`、`hot.snapshot`。每步读回终态后再继续。翻译只按站点现有开关运行，不另开付费通道。归组/翻译失败不能称成功。
4. 调用 `reports.compose`，读回job_runs及reports。日报遵守既有08:00截止窗口；09:00任务不把09时新处理内容倒改进08时窗口，无符合窗口条目就明确no_selected_items，不造空日报、热度或当天原文日期。已有报告的key/revision也要核查。
5. 无processing pending时调用 `pages.publish`，按现有公开发布配置及授权发布摘要、链接和待核验线索。若deferred或failed就保留旧版并报告。确认公开data.json与真实gh-pages分支对应文件一致，记录时间、提交及部署状态；不上传全文、附件、DB、私有证据或密钥。
6. 执行以下只读验证，证据保存在运行副本忽略目录中：

```sh
./.runtime/node --env-file=.env scripts/live-validation.ts YYYY-MM-DD
./.runtime/node scripts/smoke.ts --base http://127.0.0.1:3000
./.runtime/node scripts/leads-smoke.ts http://127.0.0.1:3000
```

将日期替换为当天北京时间；检查精选、法律动态、热点榜、法律日报、主题、案源线索六类入口及原始来源追溯。收藏仅用户操作。核查未知原发布日期、首次收录日、事件发生日、历史回填，不能用落款替代发布时间。PDF必须核验当前revision、页数、文本哈希、全部段覆盖和尾部证据；旧修订摘要不能当新全文分析成功。
7. 模型未知结果先核对完整回执及尝试，只有已有合法恢复流程及真实条件满足才恢复。不得删除未知记录、宣称免费、重复已成功请求、自动买积分、重置额度或借用其他项目密钥。最新真实限制提示10月18日21:26后重试；不要仅凭通用额度面板宣布可调用，也不要每日探测收费。超时未知与额度拒绝分别记录。已有预算10/min、240/hour、400/day不改。
8. 公开线索只是待人工核验候选，不是确认客户或律师需求。不采集非公开个人资料，不自动外联；无律师标注集不调整权重或门槛。原始材料与45/46等复核样本均为私有，没有人工标签不能称质量验收。
9. 汇报本轮实际采集、成功模型/unknown/失败数量、报告key、原始日期质量、公开快照以及具体阻塞。正常无变化保持安静；仅实质进展、失败或需要人行动时通知。维护/恢复/保留期检查迁移后不再自动执行，必要操作须由WorkBuddy按项目文档执行并留证据；不要无证据删除材料或自动放行未知付费回执。

## 恢复旧调度

只在WorkBuddy定时任务停止后，恢复迁移备份的项目及运行副本.env，或设`WORKER_SCHEDULES_ENABLED=true`，正常重启本机worker并核验定时器数量与时区。不要同时启用两套任务；数据库和材料无需恢复或重建。

# 本机处理与 GitHub Pages 公开版

本机继续运行 PostgreSQL、API、完整网页和 worker。采集与 Codex client 模型处理留在本机；GitHub Pages 只提供公开资讯与待人工核验的事件线索，不运行后台或模型。

`modules/public-snapshot/` 通过统一 publication 读取层导出精选、全部公开动态、热点、日报/周报/月报、主题、规则命中的候选及人工参考。导出使用明确字段白名单，不包含全文、收藏、身份、收据、任务日志、数据库、环境变量或凭据。原文日期与发现时间保留，快照时间单独标注。热点或日报没有内容时显示真实空态。

## 本机定时发布

在项目私有 `.env` 设置 `PUBLIC_PAGES_ENABLED=true`，并以本机用户交互方式完成 GitHub CLI 登录。不要把 token 写入仓库或发布文件。发布器使用 `/opt/homebrew/bin/gh auth git-credential`，适用于本项目当前 macOS 运行环境。

重新构建本机网页并运行 `node scripts/local-services.ts install` 后，worker 注册 `pages.publish`，每 15 分钟（Asia/Shanghai）执行。若文章处理或公开精选候选归组仍未完成，本次延后，保留上一版。模型调用和报告生成仍由既有 worker 任务负责，发布器不调用模型。

发布器在运行目录 `.data/pages/repository` 维护独立的 `gh-pages` 分支，只允许静态页面、样式、脚本、品牌图标、`data.json` 和 `.nojekyll`。不暂存主分支或私有运行目录。不允许 force push。公开数据与页面没有变化时不创建新提交；上次已提交但 push 中断时，下次仍会补推。分支有不明文件或未完成的本地修改时停止，供检查。

手动请求同一个 worker 单例队列：

```bash
node --env-file=.env scripts/publish-public.ts
```

手动请求只是入队，完成证据应读取 `job_runs` 中 `pages.publish` 的结果、GitHub 分支提交和实际 Pages 页面。应用休眠、断网或未登录用户会延迟本机任务，不能承诺全天在线采集。

## Pages 配置与验收

目标仓库为 `zhanghongqian2025/AI-HOT-ON-LAW`。Pages 从 `gh-pages` 根目录发布，标准地址为 `https://zhanghongqian2025.github.io/AI-HOT-ON-LAW/`。hash 导航与相对资源适配项目路径。

GitHub 的分支发布仍使用 Actions 部署；`.nojekyll` 仅跳过 Jekyll 构建。账户或平台限制可能阻断部署，分支 push 成功不代表网站可访问。验收必须核对 Pages 配置、部署提交、公网 HTML/资源和公开 `data.json`，并检查六类页面、空状态及原文链接。

赋界官网仅链接验收通过的公开产品地址，由官网聊天修改；本项目不修改官网目录。

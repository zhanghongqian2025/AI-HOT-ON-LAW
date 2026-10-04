# 本机验证记录（2026-10-04）

## 基线

上游提交：9848e936106db037d99a304887c36aad3fd0fad4。

目录原先为空；克隆至用户已创建项目，未覆盖已有内容，其他聊天副本未修改。
Node24.21.0 位于本项目忽略目录 .data/runtime；PostgreSQL17.11，独立集群 .data/postgres，只监听127.0.0.1:55432；未注册开机服务。

原始基础：npm ci审计0漏洞；typecheck通过；web build通过；前端27/27测试通过；后端504/504测试通过。本机测试数据库 lawhot_test，与运行库 lawhot分开。原始日志保存在忽略目录 .data/baseline-*.log。

本机 .env 独立生成随机认证/签名密钥，权限0600；没有模型API key。采集、模型、飞书、IndexNow关闭，不启动worker。没有外部生产部署。

## 第一版验证

最终代码：全链 typecheck 通过，web production build 通过，前端27/27，后端与模块515/515（504项框架测试+11项案源模块测试），整站smoke和leads-smoke均通过。

浏览器实际验证桌面与390px手机布局、关键词搜索与无结果状态。公开历史证据通过HTTP模块API → backend/publication读取层提供；API过滤和无效类别400有回归覆盖。11项模块测试包含营销标题噪声排除。发布前只读审阅已修复并复核通过。

运行日志保存于忽略目录 .data/final-*.log。无真实模型凭据，未做真实模型调用或法律线索质量验收；自动信源采集尚未适配；Docker本机未验证。继承GitHub CI已加入leads-smoke，云端结果需按Actions实际状态核验。法律规则测试为本地合成输入；公开事件摘要为有官方原文依据的人工整理历史资料，不能混称真实模型结果或当前客户线索。

## GitHub 发布读回

公开仓库：https://github.com/zhanghongqian2025/AI-HOT-ON-LAW 。本机与GitHub main源码提交一致：`8b10b3609e554d260c5bea1d1fae7c6400b21232`（后续文档提交仅补充此记录）。远端tree读回确认无 `.env` 和 `.data/`。

首次推送因GitHub邮箱隐私保护被拒，随后仅将本项目新增提交使用账户noreply邮箱重新提交，保持账户保护开启。上游历史与许可证未改。

GitHub工作流已存在且active，但 workflow_dispatch 实际返回 HTTP422 `Actions has been disabled for this user.`，没有云端测试运行。该阻塞属于账户Actions设置，本机515+27项测试、build/typecheck与运行smoke是已完成证据，不能冒充GitHub CI通过。

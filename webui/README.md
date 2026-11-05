# Heybox Daily Web UI (小黑盒每日任务 Web 管理界面)

本项目基于 [Cansiny0320/heybox-daily](https://github.com/Cansiny0320/heybox-daily) 构建，为其增加了直观现代的 Web 控制台，支持免终端短信登录、任务状态查看、手动立即执行以及后台自动定时任务调度。

## 特性亮点

- **零代码污染**：全部 Web 逻辑、前端界面与容器配置严格隔离在 `webui/` 目录与 `compose.override.yaml` 中，**未修改上游仓库任何原有文件**。在后续拉取或合并上游主项目代码（`git merge upstream/main`）时，保证 **0 冲突**。
- **免终端 Web 登录**：直接在网页端输入手机号接收验证码并核验登录，自动生成并保存 APP 原生设备令牌与凭据，同时支持人机滑块验证降级拦截。
- **任务与收益看板**：实时查看每日签到、三项分享任务完成状态，以及当前账号的经验值和 H 币数量。
- **灵活定时任务**：支持设置每日自动执行时间（默认北京时间 09:15），内置后台定时调度引擎，可随时切换开关与自定义时间。
- **实时日志审计**：提供控制台日志查看面板，记录每次任务执行详情及定时调度结果。

## 快速使用

```bash
# 1. 启动 Web 控制台（后台运行）
docker compose up -d web

# 2. 访问控制台
# 浏览器打开 http://<服务器IP>:8620
```

## 合并上游代码说明

当主项目更新时，直接执行：

```bash
git fetch upstream
git merge upstream/main
git push origin main
docker compose build web
docker compose up -d web
```

因为本扩展的所有代码都在独立路径，合并将自动完成且无任何冲突。

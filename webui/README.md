# Heybox Daily WebUI (小黑盒每日任务 Web 管理与通知)

本项目基于 [Cansiny0320/heybox-daily](https://github.com/Cansiny0320/heybox-daily) 构建，为其增加了现代 Web 控制台、微信 PushPlus 结果与告警推送、后台定时任务调度引擎以及自动化 GitHub Actions 镜像构建流程。

---

## 🌟 功能特性

1. **零污染分支隔离设计**：
   - `main` 分支保持与原作者上游主分支 100% 纯净同步。
   - 所有 Web 控制台代码、通知逻辑与 Docker 扩展全部收敛在 `webui/` 分支，合并上游时 **0 冲突**。
2. **免终端 Web 短信登录**：
   - 网页端直接输入手机号接收验证码并核验登录，自动生成并保存 APP 原生设备令牌与凭据，支持人机滑块验证降级。
3. **任务与收益看板**：
   - 实时查看每日签到、三项分享任务完成状态，以及当前账号的经验值和 H 币数量。
4. **灵活定时任务**：
   - 支持设置每日自动执行时间（默认北京时间 09:15），内置后台定时调度引擎，可随时切换开关与自定义时间。
5. **PushPlus 微信通知推送**：
   - 每日任务执行完成后（或异常报错时），自动推送图文 Markdown 报告至微信。
   - 包含详细任务状态（签到、分享帖子/游戏/评价）、经验与 H 币增量及当前总额。
   - 页面内置「测试微信推送」功能，快速验证配置。
6. **自动化多架构 Docker 构建 (CI/CD)**：
   - 每次将 `main` 合并至 `webui` 并推送到 GitHub 时，GitHub Actions 自动触发构建 `linux/amd64` 与 `linux/arm64` 双架构镜像并发布至 GitHub Container Registry (`ghcr.io`)。

---

## 🚀 部署与使用

### 方式一：本地直接构建并启动

```bash
git checkout webui
docker compose build web
docker compose up -d web
```

### 方式二：直接拉取 GitHub Actions 构建的预编译镜像

```bash
docker compose pull web
docker compose up -d web
```

- **Web 控制台地址**：`http://<服务器IP>:8620`

---

## 🔄 同步上游更新的标准流程 (Merge Workflow)

当原作者（`Cansiny0320/heybox-daily`）发布新版本时，只需执行以下 3 步：

```bash
# 1. 切换到 main 分支，拉取上游最新代码并同步到自己的 fork
git checkout main
git pull upstream main
git push origin main

# 2. 切换到 webui 分支并合并 main，然后推送到 GitHub
git checkout webui
git merge main
git push origin webui
```

> 💡 **推送后**：
> GitHub Actions 会自动检测到 `webui` 分支更新并**自动触发 Docker 镜像构建**，几分钟后即可在服务器执行 `docker compose pull web && docker compose up -d web` 完成热更新！

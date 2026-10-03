# 9000 / 9999 访问监控

2026-10-04 在 `120.24.94.69` 部署 Grafana OSS、单机 Loki 和 Grafana Alloy。9999 的 Nginx JSONL 文件和 9000 的 `fujian-oshi9.service` journal 由 Alloy 采集；旧版 9999 combined log 一次性转换为 JSONL 导入。Loki 保留数据 14 天。原始日志仍遵循各自原有的轮换策略。

## 安全访问

Grafana、Loki 和 Alloy 只监听服务器的 `127.0.0.1`，不直接暴露公网。请在**本地电脑**（或支持本地端口转发的手机 SSH 客户端）建立 SSH 隧道：

```powershell
ssh -i C:\Users\micro\.ssh\id_ed25519 -N -L 3000:127.0.0.1:3000 root@120.24.94.69
```

隧道保持运行时，在**同一台设备的浏览器**打开：

<http://localhost:3000/d/live-access-9000-9999/9000-9999-e8aebf-e997ae-e79b91-e68ea7>

Grafana 用户名是 `admin`。首次密码保存在服务器的 `/root/.grafana-initial-password`，只有 root 可读。使用 `ssh -i C:\Users\micro\.ssh\id_ed25519 root@120.24.94.69 'cat /root/.grafana-initial-password'` 查看，然后登录并在 Grafana 中修改密码。不要将密码写入 Git 或通过公网 HTTP 登录。手机端若 SSH 客户端没有端口转发功能，可以在电脑上访问，或另行配置正式 HTTPS 入口。

## 查询

仪表盘显示两端口请求趋势、总量、4xx/5xx、热门 IP、热门路径和最新访问。Grafana 的 Explore 页面可按 IP 细查，例如：

```logql
{job=~"live-9999|oshi-9000"} | json | kind="access" | ip="117.28.251.178"
```

日志中的 IP 是服务器收到的连接 IP。首页轮询也计入 HTTP 请求量，所以请求数不等于独立访客数。所有仪表盘统计默认使用浏览器时区。

## 配置和检查

- Loki 配置：`/etc/loki/config.yml`，仓库模板 `ops/monitoring/loki.yml`
- Alloy 配置：`/etc/alloy/config.alloy`，仓库模板 `ops/monitoring/alloy.alloy`
- Grafana 数据源与仪表盘：`/etc/grafana/provisioning/` 与 `/var/lib/grafana/dashboards/live-access/`
- Grafana 登录仅允许本机访问，关闭匿名访问和自行注册；随机初始密码及签名密钥没有入库
- Loki 使用文件系统存储，14 天过期数据由 Compactor 清理
- 小内存服务器增加了 2 GB swap；安装后 Grafana、Loki、Alloy 与业务服务均正常运行

在服务器中执行：

```sh
systemctl status grafana-server loki alloy
live-monitor-verify
```

`live-monitor-verify` 的仓库原件位于本目录。安装包来自 Grafana 官方 RPM 仓库。`configure-server.sh` 是部署时的配置脚本，运行前应先把本目录配置文件复制到服务器 `/tmp/`，并安装 `grafana`、`loki`、`alloy` 软件包。

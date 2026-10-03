# 9000 / 9999 访问日志

在服务器 SSH 中查看最近 100 条或实时访问：

```sh
live-access 9000
live-access 9999
live-access 9000 follow
live-access 9999 follow
```

9000 是 `fujian-oshi9.service` 的 Node 站点，请求结束时将一行 JSON 写入 systemd journal；可直接使用 `journalctl -u fujian-oshi9.service --since today -o cat`。9999 是 `live-idol-timetable.service` 的 Nginx 站点，结构化日志位于 `/var/log/nginx/live-idol-timetable-access.jsonl`；既有的 `/var/log/nginx/live-idol-timetable-access.log` 作为历史文件保留，不再追加请求。新增日志包括时间、公网连接 IP、方法、路径、状态码、耗时及 User-Agent；9999 另有响应字节数。端口 9000 的日志由持久化 journal 管理，9999 由系统 logrotate 每日轮换并保留 10 轮。

两项记录均使用服务器实际收到的连接 IP，不信任请求者可伪造的 `X-Forwarded-For`。只记录 URL 路径，不记录查询参数、Cookie、请求正文或管理员密钥。若将来接入可信反向代理/CDN，应重新配置真实来源 IP 的可信代理列表。公网 HTTP 请求不包含访客设备的 MAC 地址；服务器 ARP/邻居表只能看到当前链路邻居（通常是网关），不能据此识别远端访客。

9000 的日志模块保存在 `deploy/access-log-9000.mjs`，部署为 `/opt/fujian-idol/access-log.mjs`，由该站点的 `oshi9-server.mjs` 在请求处理开始时调用 `attachAccessLog(req, res)`。9999 的配置保存在 `deploy/nginx-9999.conf`。轮换配置见 `deploy/logrotate-nginx-access.conf`，必须给独立的 Nginx 主进程 `/run/live-idol-timetable-nginx.pid` 发送 `USR1`，使其重新打开新日志文件。

可视化监控已使用 Grafana、Loki、Alloy 部署。访问方式、仪表盘和维护说明见 [`ops/monitoring/README.md`](../ops/monitoring/README.md)。

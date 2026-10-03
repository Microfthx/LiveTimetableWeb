# 第一批微博团体库导入记录（2026-10-03）

来源：[微博原帖](https://weibo.com/7716940453/5308924492256939)。原帖长文包含团体主页链接。本次仅导入同时满足以下条件的团体：微博主页能核实数字 UID，微博名称与现有活动中的团体名称严格一致，头像可以下载并缓存到本站。没有使用模糊匹配，也没有修改 OCR EventData。

## 结果

- 服务器团体库新增 32 个团体，32 张头像均已缓存并可通过公开头像接口读取。
- 45 场现有活动中，33 场增加了团体绑定，共 68 条。原有活动 ID、城市、海报引用以及全部 EventData 保持不变。
- 线上活动详情已核对 `TSDD-土笋冻冻`、`JuiceBrew-汽汐果酿`、`SCM-生草莓` 使用 `/api/groups/:id/avatar`。
- 导入前的活动备份位于服务器 `/var/lib/live-idol-timetable/activities.before-group-seed-20261003.json`。团体记录和头像保存在服务器持久化数据目录，不提交到 Git。

## 已核实并导入

| 团体名 | 微博 UID |
| --- | --- |
| 惑星VORTEX | 6596154111 |
| YUMEDOLL | 8271931633 |
| 魅隐EvilSecret | 7609007975 |
| 心动AfterSchool | 7545720717 |
| 青空日记Serenitas | 7990767735 |
| MetaMates | 7791947226 |
| 她蝶效应Psychelles | 7998857709 |
| NULL空值变数 | 7889194912 |
| 一骑当千XERO | 8321544591 |
| 一骑当千OneKiss | 7887751959 |
| 异色星Harmonia | 7950591732 |
| EMBEFUSE | 8472141732 |
| 予絆TENKIZUNA | 8231206346 |
| 星巡Hoshimeguri | 7940384278 |
| 恋音契约 | 7777196754 |
| 極夜NightFell | 7864799082 |
| 永昼Eternal | 7943528678 |
| 月匙Moon-Key | 7879504592 |
| Neobooster | 7950374471 |
| 宫灯百合SanderSonia | 6475736725 |
| SunnyPetit | 9059123321 |
| 环屿MelodiArch | 9074808856 |
| 風絡KazeNic | 7995648699 |
| 夜燐REYN | 8202187598 |
| DollClass | 7897562017 |
| DollSign | 9018744049 |
| 蝴蝶空鏡_MiromaRi | 7957941312 |
| 恋星Koihoshi | 9149752901 |
| TSDD-土笋冻冻 | 7843009600 |
| SCM-生草莓 | 9196498791 |
| JuiceBrew-汽汐果酿 | 7994178497 |
| 電波退廃記録 | 8018446766 |

以下 9 个名称虽与现有活动匹配，但公开主页没有可靠地给出数字 UID，本轮没有导入：StarWinK、電波TOXIC、百色星河、BubbleLabo、花与心事Affloret、PunkySweety朋克甜心、青苔法則、当第一道裂缝出现时我所见到的、螢石FluorMelo。

微博 Cookie 仅用于这次读取微博资料及下载头像，没有保存在仓库、团体库或活动记录中。

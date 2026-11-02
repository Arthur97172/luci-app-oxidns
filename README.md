# luci-app-oxidns

语言：中文 | [English](./README.en.md)

`luci-app-oxidns` 是 OxiDNS 的 OpenWrt / LuCI 管理插件。安装后，LuCI 会增加 `服务 -> OxiDNS` 页面，用于安装 OxiDNS 内核、管理 OpenWrt 服务、编辑配置、查看日志，以及按需将局域网 DNS 通过 dnsmasq 转发到 OxiDNS。

本仓库只包含 LuCI 管理界面和 rpcd 后端；OxiDNS 内核、WebUI 与通用 release 由 [svenshi/oxidns](https://github.com/svenshi/oxidns) 提供。

**完整操作说明**：从零配置 DNS、普通模式/高级模式逐项参考、插件参数、常见任务、故障排查以及 OxiDNS WebUI 的使用方法，见 [info/README.md](info/README.md)。其中在 `基本信息` 一键启用 dnsmasq 转发、手动配置以及回滚，见 [4.9 用 dnsmasq 转发（推荐）](info/README.md#49-用-dnsmasq-转发推荐)。

## 功能

- `基本信息`：`状态概览` 展示后端、内核、构建信息、服务状态、开机自启和 WebUI 入口；下方可启动、停止或重启服务。
- `系统 DNS 接入`：位于 `基本信息` 页面，可一键启用或停用 dnsmasq 转发。启用后 dnsmasq 将通用 DNS 查询转发到 OxiDNS 的监听地址，保留特定域名上游；默认关闭，停用时会恢复原来的通用上游和 `noresolv` 设置。
- `DNS配置`：普通模式表单与高级模式完整 YAML；两种模式都支持校验、下载/上传配置、保存、保存并应用和改动预览。
- `设置`：安装、更新、上传、修复或删除内核与 WebUI；配置内核仓库、bundle、路径、系统日志输出和下载凭据。
- `日志`：查看 OxiDNS 运行日志。

## 安装 LuCI 插件

从本仓库 Release 下载安装包并上传到设备（例如 `/tmp`），然后安装。

OpenWrt 24.10（`opkg`）：

```sh
opkg install /tmp/luci-app-oxidns_*.ipk

# 可选：安装简体中文语言包
opkg install /tmp/luci-i18n-oxidns-zh-cn_*.ipk
```

OpenWrt 25.12（`apk`）：

```sh
apk add --allow-untrusted /tmp/luci-app-oxidns-*.apk

# 可选：安装简体中文语言包
apk add --allow-untrusted /tmp/luci-i18n-oxidns-zh-cn-*.apk
```

如果安装后菜单没有出现，重启 `rpcd`，然后打开 `服务 -> OxiDNS`：

```sh
/etc/init.d/rpcd restart
```

### 从源码编译

要把本包裁剪进固件或自行调整时，把它放进 OpenWrt 构建树编译：

```sh
cd openwrt
./scripts/feeds update -a
./scripts/feeds install -a
git clone https://github.com/Arthur97172/luci-app-oxidns.git package/luci-app-oxidns
make menuconfig   # LuCI -> Applications -> luci-app-oxidns
make package/luci-app-oxidns/compile V=s
```

产物在 `bin/packages/<架构>/` 下：24.10 构建树生成 `.ipk`，25.12 构建树生成 `.apk`。

## 默认路径

| 项目 | 路径 |
| --- | --- |
| 内核二进制 | `/usr/bin/oxidns` |
| WebUI | `/usr/share/oxidns/webui` |
| 配置文件 | `/etc/oxidns/config.yaml` |
| 工作目录 | `/var/lib/oxidns` |
| 日志文件 | `/tmp/oxidns/oxidns.log` |
| 服务脚本 | `/etc/init.d/oxidns` |

## 已知限制

- 只支持 OxiDNS 已发布的 Linux musl release target。
- `更新内核` 只安装严格更新的正式版本，不会降级已安装的较新或自定义构建。
- 替换内核或 WebUI 前会暂存并校验新文件；复制失败时恢复旧文件，避免留下内核与 WebUI 不匹配的状态。
- 普通模式只编辑已存在的插件实例，新增/删除插件和 sequence 规则需在高级模式或 OxiDNS WebUI 中完成；配置使用 YAML anchor、alias 或 merge key 时，普通模式会变为只读。
- 普通模式保存会重新序列化 YAML：保留注释、字段顺序和表单未管理的字段，只写入实际改动的字段。普通模式、高级模式和 OxiDNS WebUI 编辑同一份文件，建议同时只使用一个入口。
- `基本信息` 的 WebUI 入口要求 WebUI 文件已安装、服务正在运行且 HTTP 监听地址可访问；只监听 `127.0.0.1` / `::1` 时需要本机访问或 SSH 隧道。
- `系统 DNS 接入` 要求 OxiDNS 已启动，UDP 与 TCP 监听使用同一个端口并共享可达的 IPv4 地址；只监听 IPv6、端口不一致或没有共同可达的 IPv4 地址时，“启用 dnsmasq 转发”按钮不可用。
- 启用 `系统 DNS 接入` 后，停止 OxiDNS 会导致局域网 DNS 解析失败（fail-closed），不会自动绕过 OxiDNS；需重新启动 OxiDNS 或停用转发。
- `系统 DNS 接入` 不接管 53 端口；dnsmasq 继续监听 53 并提供 DHCP、本地域名和租约解析。需要 OxiDNS 直接监听 53 时属于另一种部署方式，代价和步骤见详细文档。

## 私有仓库与下载

路由器需要能访问 GitHub Releases 和 release archive。私有仓库或受限网络可以在 `设置` 中配置 GitHub token 或下载代理；Token 和代理值保存后不会在 LuCI 中回显。配置下载代理需要安装 `curl`，也可以使用 `上传内核` 离线安装。

## 许可证

本项目以 GNU General Public License v3.0 或更高版本（`GPL-3.0-or-later`）发布。完整许可证文本见 [LICENSE](LICENSE)。

## 致谢

- [https://oxidns.org/](https://oxidns.org/)：OxiDNS 官方主页，提供文档、配置参考和最新动态。
- [https://github.com/svenshi/oxidns](https://github.com/svenshi/oxidns)：OxiDNS 内核及其 WebUI 的源代码仓库；本插件安装的内核和 WebUI 均来自该项目的 release。
- 本仓库克隆自 [svenshi/luci-app-oxidns](https://github.com/svenshi/luci-app-oxidns)，并在此基础上进行了优化。

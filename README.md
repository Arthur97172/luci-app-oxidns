# luci-app-oxidns

语言：中文 | [English](./README.en.md)

`luci-app-oxidns` 是 OxiDNS 的 OpenWrt / LuCI 管理插件。安装后，LuCI 会出现 `Services -> OxiDNS` 页面，用来安装 OxiDNS 内核二进制、管理 OpenWrt 服务、编辑配置和查看日志。

本仓库仅提供用于安装和管理 OxiDNS 的简单实现。欢迎其他开发者在此基础上扩展，或重新实现覆盖现有功能、提供更多功能的 LuCI 插件。

## 你需要安装什么

- `luci-app-oxidns`：LuCI 管理页面、rpcd 后端和 OpenWrt init 服务脚本。
- `luci-i18n-oxidns-zh-cn`：可选简体中文语言包。

## 安装 LuCI 插件

推荐从本仓库 Release 下载对应的 LuCI 包后手动安装：
把安装包上传到设备（例如 `/tmp`），然后安装：

OpenWrt 24.10：

```sh
opkg install /tmp/luci-app-oxidns_*.ipk

#可选，安装简体中文语言包

opkg install /tmp/luci-i18n-oxidns-zh-cn_*.ipk
```

OpenWrt 25.12：

```sh
apk add --allow-untrusted /tmp/luci-app-oxidns_*.apk

#可选，安装简体中文语言包：

apk add --allow-untrusted /tmp/luci-i18n-oxidns-zh-cn_*.apk
```

### 从源码编译

要把本包裁剪进固件或自行调整时，把它放进 OpenWrt 构建树，和其他包一起编译：

```sh
cd openwrt
./scripts/feeds update -a
./scripts/feeds install -a
git clone https://github.com/Arthur97172/luci-app-oxidns.git package/luci-app-oxidns
make menuconfig   # LuCI → Applications → luci-app-oxidns
make package/luci-app-oxidns/compile V=s
```

产物在 `bin/packages/<架构>/` 下。同一份源码在 24.10 的构建树里得到 `.ipk`，在 25.12
的构建树里得到 `.apk`；`VERSION` 与 `PKG_RELEASE` 决定包名中的版本号。

---

如果安装后菜单没有出现，重启 `rpcd`：

```sh
/etc/init.d/rpcd restart
```

然后打开 LuCI：`Services -> OxiDNS`。

## 安装 OxiDNS 内核

如果你是从旧的 OpenWrt `oxidns` 包模式迁移，先停止服务并移除旧内核包，避免它继续拥有 `/usr/bin/oxidns` 或 `/etc/init.d/oxidns`：

```sh
/etc/init.d/oxidns stop
opkg remove oxidns
```

如果系统使用 `apk`，对应执行：

```sh
/etc/init.d/oxidns stop
apk del oxidns
```

1. 打开 `Services -> OxiDNS -> Settings`，确认 `Core repository` 为 `svenshi/oxidns`，`Core bundle` 为 `full`。
2. 打开 `Services -> OxiDNS -> Core`，点击 `Install Core`；离线环境也可以点击 `Upload Core` 上传官方 `.tar.gz` archive 或单个 `oxidns` 二进制。
3. 安装成功后，到 `基本设置` 页面启动并启用服务。

LuCI 会按当前设备 CPU 架构选择 OxiDNS Linux musl release archive，例如 `oxidns-x86_64-unknown-linux-musl.tar.gz`。安装时会校验 GitHub release asset 的 SHA256 digest。

注意：`full` 和 `standard` 归档包含 WebUI 文件，`minimal` 归档不包含。上传单个 `oxidns` 二进制不会安装 WebUI；如果当前没有已安装的 WebUI，LuCI 会拒绝 `full` / `standard` 内核但缺少 `webui/` 的上传，避免出现“内核已安装但 WebUI 缺失”的半安装状态。

如果内核已经安装，`Core` 页面提供 `更新内核`、`重新安装`、`Install WebUI` 和 `Upload Core`。`更新内核` 会检查官方最新 release，只有存在更新版本时才自动下载并安装，且保持当前已安装的 bundle；`重新安装` 和 `Upload Core` 用于重新下载当前已安装版本或用上传文件修复二进制 / WebUI 文件。WebUI 缺失时，`Install WebUI` 会从 GitHub 下载官方最新 release，并同时替换内核二进制和 `/usr/share/oxidns/webui`。bundle 的选择顺序是：当前已安装的 bundle 若是 `full` / `standard` 则保持不变；否则使用设置中的 bundle；两者都不包含 WebUI 时回退到 `standard`。该操作需要设备能访问 GitHub，配置文件中已有的设置不会被覆盖。

## 让 OxiDNS 成为系统 DNS

OxiDNS 的 `udp_server` / `tcp_server` 插件默认监听 `:5335`，而 OpenWrt 的 53 端口由 dnsmasq 占用，DHCP 也由它提供。推荐保留 dnsmasq，让它把查询转发给 OxiDNS：LAN 客户端的 DHCP、`xxx.lan` 主机名和租约名解析都不受影响，客户端也无需改动。

1. 打开 `Services -> OxiDNS -> Configuration`，把两个 DNS 服务改为只监听本机，保存后重启 OxiDNS：

```yaml
  - tag: udp_server
    type: udp_server
    args:
      entry: main_sequence
      listen: "127.0.0.1:5335"

  - tag: tcp_server
    type: tcp_server
    args:
      entry: main_sequence
      listen: "127.0.0.1:5335"
```

上游服务器在 `forward` 插件的 `upstreams` 中配置，默认是 `223.5.5.5`。

2. 让 dnsmasq 只向 OxiDNS 查询：

```sh
uci set dhcp.@dnsmasq[0].noresolv='1'
uci add_list dhcp.@dnsmasq[0].server='127.0.0.1#5335'
uci commit dhcp
/etc/init.d/dnsmasq restart
```

`noresolv=1` 让 dnsmasq 忽略 `/tmp/resolv.conf.d/resolv.conf.auto`，WAN 重连重写它也不会绕过 OxiDNS。

3. 验证：

```sh
nslookup -po=5335 www.baidu.com 127.0.0.1   # 直连 OxiDNS
nslookup www.baidu.com 127.0.0.1            # 经 dnsmasq
```

停掉 OxiDNS 后经 dnsmasq 的查询应当超时或失败，重新启动后恢复，这说明流量确实经过 OxiDNS。

回滚：

```sh
uci set dhcp.@dnsmasq[0].noresolv='0'
uci -q delete dhcp.@dnsmasq[0].server
uci commit dhcp
/etc/init.d/dnsmasq restart
```

如果 OxiDNS 需要按客户端源地址做策略，也可以让它直接监听 53 端口：先执行 `uci set dhcp.@dnsmasq[0].port='0'` 关闭 dnsmasq 的 DNS 功能（DHCP 不受影响），并确认 DHCP 仍下发本机地址作为 DNS，再把上面两个 `listen` 改为 `":53"`。代价是 `xxx.lan` 主机名、DHCP 租约名和 dnsmasq 的 rebind 保护不再生效；IPv6 客户端还需要 OxiDNS 同时监听 IPv6，例如 `"[::]:53"`。

无论哪种方式，都不要把 53 或 5335 端口暴露到 WAN，否则路由器会成为开放解析器。

## 常用页面

- `基本设置`：查看内核状态、服务状态、WebUI 入口、配置路径和工作目录，并启停服务。
- `Core`：首次安装、更新、上传安装、重新安装、单独安装 WebUI 或删除 OxiDNS 内核。
- `Configuration`：查看、校验、保存配置文件，并可下载当前配置或上传 `config.yaml` 覆盖。
- `Settings`：设置 core repository、bundle、代理、配置路径和工作目录。
- `Logs`：设置日志文件路径，查看运行日志，支持刷新和暂停。

## 默认路径

- 二进制：`/usr/bin/oxidns`
- WebUI：`/usr/share/oxidns/webui`
- 配置：`/etc/oxidns/config.yaml`
- 工作目录：`/var/lib/oxidns`
- 日志文件：`/tmp/oxidns/oxidns.log`
- 服务脚本：`/etc/init.d/oxidns`

## 升级与删除

升级 OxiDNS 内核可以在 LuCI 的 `Core` 页面点击 `更新内核`，它会检查官方最新 release 并在有更新时自动安装；也可以使用 OxiDNS 自带的升级功能，例如内核 WebUI / API / CLI 中的升级能力。

升级 LuCI 插件时，下载新版本 `luci-app-oxidns` 包并重新安装即可。LuCI 页面内不提供自升级。

删除 OxiDNS 内核可以在 LuCI 的 `Core` 页面点击 `Remove Core`。该操作会停止并禁用服务，删除 `/usr/bin/oxidns` 和 `/usr/share/oxidns/webui`，但保留 `/etc/oxidns/config.yaml` 和 `/var/lib/oxidns`。

## 私有仓库与下载

路由器需要能直接访问 GitHub Releases 和 release archive。私有仓库或受限网络环境可以在 `Settings` 中配置 GitHub token 或下载代理。Token 和代理值保存后不会在 LuCI 页面中回显，需要清除时请勾选对应清除选项。配置下载代理时需要安装 `curl`，否则 LuCI 会返回明确错误；也可以在 `Core` 页面手动上传 release archive 或二进制进行离线安装。

## 已知限制

- 目前只支持 OxiDNS 已发布的 Linux musl release target。
- `更新内核` 只会安装严格更新的正式版本，不会降级已安装的较新或自定义构建；无法解析的版本号会被视为无需更新。
- 替换内核或 WebUI 前会先完整暂存新文件并校验；复制失败时会恢复旧的内核二进制和 WebUI，避免留下新内核搭配缺失 WebUI 的状态。
- `基本设置` 的 WebUI 入口根据配置文件中的 HTTP listen 地址生成；如果监听 `127.0.0.1`，LuCI 会保留链接并提示需要本机访问或 SSH 隧道。
- 日志页优先读取配置文件中 `log.file` 指定的日志文件，默认为 `/tmp/oxidns/oxidns.log`；文件不存在或不可读时回退到 OpenWrt `logread`。日志页顶部的“日志路径”可修改日志目录，保存时会把 `log.file` 写入配置文件；服务正在运行时自动重启 OxiDNS 使设置生效。内核安装时默认写入 `/tmp/oxidns/oxidns.log`，重启后该目录会被清空。
- 可在 `Settings` 中关闭“写入系统日志”（默认开启），保存后需重启 OxiDNS 才会生效。LuCI 会停止服务，等待旧 procd 实例被移除（最多 10 秒），再启动新实例，以应用 stdout/stderr 设置。状态查询失败或停止超时时，重启会中止。替换正在运行的内核前也会执行相同的停止等待。
- `基本设置` 上的服务操作（Start / Stop / Restart / Enable / Disable）始终会向系统日志写入一条以 `luci-app-oxidns` 为 tag 的审计记录，包含动作和成功或失败结果。内核未安装、init 脚本缺失或操作失败时同样会记录。这些记录可在 `logread` 原始输出和 LuCI 系统日志页看到；由于日志页只显示 `oxidns[PID]:` 格式的内核输出，审计记录不会出现在 OxiDNS 日志页。

## 许可证

本项目以 GNU General Public License v3.0 或更高版本（`GPL-3.0-or-later`）发布。完整许可证文本见 [LICENSE](LICENSE)。

## 致谢

本仓库克隆自 [svenshi/luci-app-oxidns](https://github.com/svenshi/luci-app-oxidns)，并在此基础上进行了优化。

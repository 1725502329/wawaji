# 让别人玩到 CLAWVERSE

这个游戏是纯静态网页，没有后端、数据库或构建步骤。整个 `claw-machine` 文件夹就是完整网站。

## 方案一：生成一个公开链接（最推荐）

### Netlify Drop

1. 打开 <https://app.netlify.com/drop>。
2. 把整个 `claw-machine` 文件夹拖进去（不是只拖 `index.html`）。
3. 等部署完成，会得到一个类似 `https://xxxx.netlify.app` 的网址。
4. 把这个网址发给别人，手机、电脑都能直接打开。

Netlify 可能要求登录或注册免费账号来保留站点；如果只是临时分享，拖拽后生成的链接通常也能直接访问。

### Cloudflare Pages 或 GitHub Pages

也可以用同样的静态文件部署到 Cloudflare Pages（Direct Upload）或 GitHub Pages。核心要求只有一条：**保持 `index.html`、`style.css`、`game.js` 在同一个目录**。

## 方案二：同一 Wi-Fi 下局域网分享

适合朋友就在旁边、连同一个路由器的情况。

在电脑上打开 PowerShell：

```powershell
cd "D:\nodejs deepseek\claw-machine"
npx --yes serve . -l 8080
```

或者电脑装了 Python 时：

```powershell
cd "D:\nodejs deepseek\claw-machine"
python -m http.server 8080
```

然后查看电脑的局域网 IP：

```powershell
ipconfig
```

找到类似 `192.168.1.23` 的 IPv4 地址。让同一 Wi-Fi 下的朋友访问：

```text
http://192.168.1.23:8080
```

如果 Windows 弹出防火墙提示，选择允许 Node.js / Python 通过专用网络。这个地址只在局域网内有效，不能发给外网的人。

## 方案三：直接把文件发给对方

把整个 `claw-machine` 文件夹压缩成 ZIP 发给对方。对方解压后双击 `index.html` 即可。

注意：**不要只发 `index.html`**，它还需要同目录下的 `style.css` 和 `game.js`。手机上直接打开本地 HTML 可能受文件管理器限制，这种情况建议用方案一或方案二。

## 方案四：临时公网隧道

如果不想注册托管平台，可以在启动本地服务器后，用隧道工具临时映射到公网：

```powershell
npx --yes localtunnel --port 8080
```

或安装 `cloudflared` 后：

```powershell
cloudflared tunnel --url http://localhost:8080
```

这类链接是临时的，电脑关闭或隧道停止后就失效，速度和稳定性也不如正式静态托管。

## 需要改内容时

修改本目录里的 `index.html`、`style.css`、`game.js` 后：

- 本地直接刷新页面即可；
- 已部署到 Netlify / Cloudflare Pages 时，重新拖拽整个文件夹或重新上传即可更新。

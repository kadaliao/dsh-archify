# Archify 图解：细节

[English](details.md) | 简体中文 · [回到 README](https://github.com/kadaliao/dsh-archify/blob/main/README.zh-CN.md)

## 默认就快

Archify 的检查很严，模型的时间大多花在修布局上。插件把这部分控制住：

- **格式小错直接修，不用返工。** 检查之前，工具按这种图自己的 schema 把草稿过一遍，修掉模型最常犯的错：
  schema 里没有的字段、大小写或近义词不对的枚举值（`cache` 当 `database`、`queue` 当 `messagebus`、`vpc` 当
  `security-group`、`async` 当 `dashed`）、超过三条的来源、过长的标签、只写了路径的来源。结果里列出每一处
  改动。以前每一处都要失败一次、再修一轮。
- **一次看清一个仓库。** `archify_scan` 一次调用就给模型仓库的全貌：Git 远端和版本、带文件数的目录、语言、
  清单和依赖、Docker Compose 服务、Dockerfile、Kubernetes 对象、Terraform 资源、CI 工作流、配置项的名字、
  README 开头，还有一份代码地图：目录之间的模块依赖（哪个目录引用哪个），以及关键文件各自引用了哪些文件、
  主要声明从第几行开始，可以直接引用。几千个文件的仓库也不到一秒，模型不用再 grep 引用、一页页翻大文件。
  从面板发起的运行会把它直接附在提示词里。
- **源码证据由插件钉住。** Archify 对图的仓库身份查得很严（远端要和 `origin` 一致、提交要存在、网页链接要用
  规范的 HTTPS 地址），模型手写往往要失败好几次。工具直接按本地仓库写好 `meta.repository`；不在 Git 仓库里
  时，就去掉来源并说明，而不是一直失败。
- **架构图由插件排版。** 模型只写有哪些框、哪些箭头、哪些分组，位置由插件用
  [ELK](https://github.com/kieler/elkjs) 的分层布局算出来（同组的框排在一起，主链路从上往下），
  大约一秒内试四种排法、逐个过 Archify 的检查，留下通过检查里交叉和绕行最少的一种。位置写进
  `candidate.json`，之后照样能改：改了文字或结构会重新排，手动挪过的位置保持不动。
- **检查通过的页面就是答案。** 页面一生成，模型就直接回复，不会自己再去做视觉检查、截图或者再调一轮
  布局。Archify 建议整理连线时，回复最后会问一句要不要整理；你说「整理一下布局」就会做这一轮。
- **修复有预算。** 同一份图第三次渲染失败起，工具会让模型改用 Archify 的 `standard` 档，这一档不做
  展示级的精修检查（标签间距、走线通道和交叉、画布宽度），先把页面交出来；第八次起，让模型停下来，
  告诉你还剩什么问题。
- **渲染本身很快。** 校验不过大约一秒就返回，完整通过（含真实浏览器检查）大约三秒。

我们用 DeepSeek-V4.1-Flash 实测，都按 Archify 最严的 `showcase` 档交付（每种只跑了一次，数字仅供参考）：照描述
画架构图大约 25 秒（0.2.0 是 30 秒）。读一个真实仓库（Images 插件，7 个源文件、约 4000 行）的代码画架构图大约
100 秒，12 步、渲染一次就通过；0.2.0 要 150 秒、24 步、渲染三次，模型读的 token 也是现在的三倍。那份克隆的
origin 是一个本地文件夹，0.2.0 的模型为仓库身份失败了两次，这一项 0.3.0 已经由插件直接填好。此前测过：一页
讲解大约 20 秒，一张时序图大约 50 秒。

## 文件放在哪

每次请求在会话的工作目录里建一个文件夹：

```
.archify/<类型>-<名字>-<YYYYMMDD-HHMMSS>/
  candidate.json            图的内容（讲解页是 candidate.archify.md）
  candidate.layout.json     插件写进去的排版记录（架构图）
  <名字>.html               页面
  <名字>.*.json             Archify 的生成和检查回执
```

修复会覆盖同一个页面，新的请求用新的文件夹。面板的列表存在 `~/.dsh/cache/archify/gallery.json`，面板发起的
运行记在旁边的 `jobs.json`。从面板按描述画的图，画在 `~/.dsh/archify/workspace`（设置项 `workdir`）；面板打开的示例第一次用时渲染到
`~/.dsh/cache/archify/examples/`。

## 读什么、发什么

- 插件不调用任何模型。图由对话模型自己写：它从插件目录读 Archify 的参考文档；画你的代码时，照常读
  你的文件。
- 渲染在本机进行。Archify 的更新检查已关闭，这份副本跟着插件一起更新。Archify 只有在图里写了某个品牌
  logo 的网址时，才会联网去取那个 logo。
- 除了模型加载时的技能内容、工具结果，以及你从面板发起时的那条提示词，不往模型看到的内容里加任何东西。
- `archify_scan` 只读名字和结构：目录、清单、Compose / Docker / Kubernetes / Terraform 文件、工作流名字、
  README 开头，`.env.example` 这类文件只读变量 *名*。它从不打开 `.env`，不输出任何值，Git 远端地址里的凭据
  也会去掉。
- 面板里的 **改图** 和 **读代码点评** 是往画这张图的会话里发一条消息，跟你自己打字一样。
- 页面在沙箱里、以独立的源提供给 Harness 页面：查看器的脚本照常运行，但页面上的任何内容都碰不到
  Harness 本身和它的接口。这些接口只提供工具生成过的页面。

## 工具

| 工具 | 作用 |
| --- | --- |
| `archify_render` | 渲染、检查并交付页面，相当于 Archify 的 `finalize`。参数 `type`；新页面传 `spec`（JSON，讲解页传 `markdown`），改过的图重新渲染传 `candidate`（路径）。可选 `name`、`quality`（默认用草稿里的 `meta.quality_profile`）、`relayout`、`repoRoot`（图里引用了源码文件时，默认用工作目录所在的 Git 仓库根目录）、`output`。 |
| `archify_scan` | 画代码仓库时一次看清整个仓库，包括代码地图（见上文）。可选 `path`，扫描它所在的 Git 仓库根目录。 |
| `archify_review` | 保存一份架构点评：`candidate`、`basis`（`code` 或 `description`）、`software`、`verdict` 和 `findings`，每条都引用文件和行号（或组件）。依据核对不通过的结论会被拒收。 |
| `archify_cli` | 用内置运行时跑 Archify 的其他命令（`guide`、`brands`、`compare`、`patch`、`validate`、`visual-check`、`doctor` 等）。会起常驻服务的 `preview` 不执行。 |

## 内置的 Archify

`archify/` 是 Archify 3.2.0，取自 `main` 分支，具体提交记在
[`archify/UPSTREAM.json`](https://github.com/kadaliao/dsh-archify/blob/main/archify/UPSTREAM.json)。内容没有改动，只去掉了测试、预渲染的示例页面、生成脚本和
lockfile。[`skill/SKILL.md`](https://github.com/kadaliao/dsh-archify/blob/main/skill/SKILL.md) 是它的 `SKILL.md` 为 Harness 改写的版本：shell 命令换成插件的工具，
去掉更新检查和安装两节，第一次通过就交付。从 tt-a1i/archify 的本地仓库更新这份副本：

```bash
node scripts/sync-archify.mjs /path/to/archify
```

`assets/previews/` 是面板里每种图的示意图（浅色和深色），由 `python3 scripts/build-previews.py`（需要 Playwright
和 Pillow）从 Archify 自带的示例截取；更新内置副本后重新跑一次。

`vendor/elkjs/` 是 [elkjs](https://github.com/kieler/elkjs) 0.12.1 的 `lib/elk.bundled.js`（编译成
JavaScript 的 Eclipse Layout Kernel），没有改动。它只在排版进程里加载：插件每排一张架构图就单独起一个进程。

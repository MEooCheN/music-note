# 复调 · 曲式 · 标注

> A personal website for learning polyphony and musical form analysis.
> **It is a personal study notebook, not a tutorial** — the prose is draft-quality
> and may contain errors. See `LICENSE` and `docs/关于本站.html`.

## 这是什么

一个音乐理论学习站，专攻三件事：

- **严格对位**（文艺复兴五种对位）
- **曲式与功能分析**（以 Caplin 功能理论为核心）
- **音乐信息标注**（DCML 和声标注标准为主导）

前提假设：你已经掌握基础乐理、中西音乐史、中国民歌，和声基础较弱。
所以站内不再铺开讲这些，只做必要的"急救"和速查。

> **它是个人学习笔记，不是教程。** 讲解文字属草稿、可能有错；
> 对位规则的判定是机器可验的，DCML 标签用的是官方正则。
> 详见 `LICENSE` 与站内「关于本站」。

## 要改站点设置？只改一个文件

**`site.config.js`** 是全站唯一的"站点身份"来源：上线域名、站点名、标语、
分享卡片图、收录开关、访问统计、页脚链接，全都在这里。

改完之后跑两条命令：

```powershell
node tools\check-site-config.js      # 上线前自检：什么没配好、哪里不一致
node tools\apply-site-config.js      # 按配置生成 robots.txt / sitemap.xml / site.webmanifest
```

`check-site-config.js` 会核对 `index.html` 里那份**静态** meta 与配置是否一致
（那份是给不执行 JS 的爬虫兜底的），不一致就直接报错。

**只有一项是上线前必须填的：`siteUrl`。** 留空时站点照常跑（本地预览、
离线使用都不受影响），但 `canonical`、`og:image`、`sitemap` 都不会生成。

## 怎么打开

**双击 `index.html` 可以看内容，但看不到谱面、也听不到声音。**

原因是浏览器不允许 `file://` 页面读取同目录的文件（CORS），所以谱面 SVG 与 MP3
取不到——谱面区会显示一句说明。**要看到谱面和听到音频，跑一条静态服务**：

```powershell
cd D:\AgentGZQ\project1
python -m http.server 8000
#   或者： npx serve
```

然后访问 `http://localhost:8000/`。除此之外不需要任何东西：不用安装、不用构建、
不联网（只有点 IMSLP 之类的外部链接时才需要网）。

> 这里曾经有一个 `assets/scores/scores.js`，把 9 个谱面 SVG 内联成 981 KB 的 JS，
> 就是为了让"双击也能显示谱面"。代价是每次打开都要多下近 1 MB，
> 而 http 下本来就能直接读 SVG——所以删掉了。现在 `file://` 只牺牲谱面显示，
> 换来首屏少了 981 KB。

## 分工：谁负责什么

```
MuseScore   →  谱面与声音的唯一来源
               你在里面写谱、改谱、听、标注
     │
     │  tools\build-scores.ps1   （一条命令批量导出）
     ▼
assets\scores\  *.svg 矢量谱面（自动裁白边、跟随深浅色）
                *.mp3 音频
     │
     ▼
网站   →  内容编排、练习、进度记录
```

**关键点：改音乐要去 MuseScore 改，不要在网站里改谱。**
网站不渲染乐谱，也不用文字描述乐谱——这是刻意的设计。

谱面有两条来源，都要先变成 MusicXML 才交给 MuseScore（`scores\` 里放的就是它们）：

```
Fux 语料 scores\fux\*.krn ──kern-to-musicxml.js──┐
                                                ├─→ scores\*.musicxml ─→ build-scores.ps1 ─→ SVG + MP3
站内文字记谱（content/units 里的 'C5:4 | …'）──notes-to-musicxml.js──┘
```

## 日常使用流程

### 学习

1. 双击 `index.html`
2. 首页最上面「接着做这个」会指向你第一个未完成的单元
3. 单元里从上往下做：读 → 听 → 练 → 对清单

进度存在浏览器 localStorage 里，关掉再开还在。

### 导出谱面（每当你在 MuseScore 里改了谱）

```powershell
cd D:\AgentGZQ\project1
powershell -ExecutionPolicy Bypass -File tools\build-scores.ps1
```

脚本会：
- 扫描 `scores\` 里的所有 `.mscz` / `.musicxml`
- 逐个导出成 `assets\scores\` 下的 SVG（矢量）和 MP3

常用参数：

```powershell
... -File tools\build-scores.ps1 -Only "b1"     # 只处理文件名含 b1 的
... -File tools\build-scores.ps1 -NoAudio       # 不导出 MP3
... -File tools\build-scores.ps1 -Bitrate 96    # 音频更小
```

### 批改自己写的对位

这是本站最硬的功能。规则检查器 **21 条规则**逐条判定，报告里给出规则编号、
小节拍位、以及这条规则的判据说明。

```powershell
cd D:\AgentGZQ\project1
node tools\verify.js            # 检查全部谱例
node tools\verify.js sp1-good   # 只检查某一条
node tools\check-rules.js       # 规则覆盖闸门：每条规则是否真的能被触发
```

第三行是后加的，解决的是一个真问题：原先 `verify.js` 对反例的判定是
「只要**随便报一个**错就算检出」，于是规则实现静默失效时闸门仍然是绿的。
`check-rules.js` 要求每条规则**点名证一条能触发它的反例**，
报不出该编号就失败。详见本文件末的「关于准确性的诚实声明」。

退出码 0 = 全部合规，1 = 有不合规的。

**自己练习的写法**：打开 `theory/examples.js`，照着旁边的例子加一条：

```js
add({
  id: 'my-ex-1',
  title: '我的第一条第一类对位',
  species: 1, key: 'C', meter: '4/4',
  cfClef: 'treble', cpClef: 'bass',
  cf: 'C5:4 | D5:4 | E5:4 | F5:4 | C5:4',
  cp: 'C4:4 | B3:4 | C4:4 | D4:4 | C4:4'
});
```

然后 `node tools\verify.js my-ex-1` 看批改。
记谱写法见 `docs\记谱速查.md`。

### 用 Fux 的原文验证规则

```powershell
node tools\verify.js             # 检查本站全部谱例
node tools\validate-fux.js       # 用 Fux《Gradus》的解答交叉验证规则检查器
node tools\validate-fux3.js      # 三声部：检查三对声部之间的平行进行
node tools\kern-to-notes.js      # 把 .krn 语料转成站内记谱格式
```

**「Fux 的解答被判违规的条数」是检查器质量的核心指标，目标是 0。**
现在语料有 7 条（二声部图 5/33/55/73/82 覆盖五种对位，三声部图 101/154），全部通过。
往 `scores\fux\` 里丢新的 `.krn` 就会自动纳入验证。

> 曾经有一个 `tools\generate.js`（求解器：程序生成对位、检查器当裁判）已删除。
> 原因：这类素材 Fux 已经写好并且是公有领域，没有生成的必要；
> 而且生成出来的解规则合规但音乐上很呆。详见 `docs\检查器交接文档.md`。

## 验收内容质量

```powershell
node tools\check-content.js            # 按标准验收全部单元
node tools\check-content.js --verbose  # 附带每条提示
```

检查项：每个单元是否有 `flow`（承接/为什么/去向）、`goal` 是否可检验、
术语是否有展开讲解、`prose` 标题是否是结论而非"介绍/概述"。
标准全文见 `docs\内容写作标准.md`。

## 新增一个学习单元

1. 在 `content/units/` 里新建或打开一个 `.js` 文件
2. 照抄一个现成单元的结构，改内容：

```js
SITE.unit({
  id: 'B3', code: 'B3', track: 'counterpoint', order: 3, minutes: 200,
  title: '第三类：四音对一音',
  en: 'Third Species',
  goal: '……',
  sections: [
    { type: 'prose',  title: '……', html: '……' },
    { type: 'terms',  items: [['中文','english','判据'], ...] },
    { type: 'note',   html: '……' },
    { type: 'score',  svg: 'assets/scores/xxx.svg', mp3: 'assets/scores/xxx.mp3',
      mscz: 'scores/xxx.mscz', caption: '……' },
    { type: 'listen', title: '……', notes: 'C4:1 E4:1 G4:1', tempo: 72 },
    { type: 'drill',  drill: 'quiz',  options: [{ t:'…', ok:true, why:'…' }, ...] },
    { type: 'drill',  drill: 'spot',  cf:'…', cp:'…', species:1, options:[{t:'…',rule:'H01'}] },
    { type: 'drill',  drill: 'label', notes:'…', answers:['V7/V'], why:'…' },
    { type: 'checklist', items: ['…'] },
    { type: 'repertoire', items: [{ work:'…', bars:'…', task:'…', link:'…' }] }
  ]
});
```

3. 如果是新文件，在 `index.html` 底部加一行 `<script src="content/units/你的文件.js"></script>`
   （必须放在 `assets/js/app.js` 之前）

单元会自动出现在导航、首页列表和"接着做这个"里，进度也能记录。

## 可视化（五张图）

站内的图不是装饰，每一张都对应一个具体的判断难点。全部是内联 SVG + CSS 动画，
无第三方库、离线可用、深浅色自适应。

| 区块类型 | 图 | 解决什么问题 |
|---|---|---|
| `viz-voice` | **声部进行图 + 协和度色带** | 同向/反向/斜向/平行一眼可辨；色带把协和分布画出来；检查器违规处标红 |
| `viz-suspension` | **挂留生命周期** | 准备→挂留→解决 三阶段逐格播放，第四类对位的核心动作 |
| `viz-form` | **曲式时间轴** | 按小节等比例的功能段图 + 终止式旗标 + 和声行，可"走一遍结构" |
| `viz-journey` | **调性旅程图** | 纵轴是离主调的五度圈步数，看奏鸣曲式"离家与回家" |
| `viz-tonnetz` | **音网 Tonnetz** | 罗马数字背后的几何：相邻三角形共享两个音，解释为什么某些和弦进行更顺 |

用法（写在学习单元里）：

```js
{ type: 'viz-voice',
  title: '终止式的形状',
  voices: [
    { name: '上声部', notes: 'G4:4 | B4:4 | C5:4' },
    { name: '下声部', notes: 'E4:4 | D4:4 | C4:4' }
  ],
  cf: 'G4:4 | B4:4 | C5:4',    // 可选：给了这两行才会叠加检查器判定
  cp: 'E4:4 | D4:4 | C4:4',
  species: 1,                   // 可选：对位类别
  tempo: 60, height: 235,
  caption: '小3度 → 大6度 → 纯8度，两条线反向张开' }
```

```js
{ type: 'viz-form', title: '奏鸣曲式骨架',
  totalMeasures: 100,
  sections: [ { label:'主部 P', from:1, to:12, detail:'建立主调' }, ... ],
  harmony:  [ { at:1, label:'C: I' }, ... ],
  cadences: [ { at:44, type:'PAC', detail:'EEC' }, ... ] }
```

```js
{ type: 'viz-journey', totalMeasures: 100,
  keys: [ { at:1, key:'C' }, { at:27, key:'G' }, { at:77, key:'C' } ] }
```

```js
{ type: 'viz-suspension',
  phases: [ { cf:57, cp:65, label:'① 准备', sub:'协和（小6度）' },
            { cf:55, cp:65, label:'② 挂留', sub:'→ 不协和（小7度）' },
            { cf:55, cp:64, label:'③ 解决', sub:'→ 协和（大6度）' } ] }
```

```js
{ type: 'viz-tonnetz',
  progression: [ { label:'I', root:0, quality:'M' },
                 { label:'vi', root:9, quality:'m' } ] }   // root 是音级 0-11
```

**音网的一个真实局限**：它只表示大三与小三和弦。减三和弦、增三和弦、七和弦
在音网里没有对应的三角形——那是音网本身的定义决定的，不是实现问题。

**「播放并跟随」怎么对上的**：各声部**各自调度、共用一条音频时间轴**
（`SITE.audio.playVoices`），声部之间不合并——合并成一串和弦会让时值不再首尾相接，
后面的音整体后漂（`Audio.parse` 是按顺序累加时值定位音的），片段越长越偏；
游标则读**音频时钟**并减掉 `outputLatency`，不读墙钟。
这两条都由 `node tools\check-viz-sync.js` 逐帧守着（全站 9 张图，当前最大偏差 0.000 拍）。

**还没做 3D。** 上面五张图都是 2D，因为对位、曲式、和声功能本质上是 2D 关系。
真正值得上 3D 的只有音网/和弦空间那一个场景（和声的高维几何），
等做到晚期浪漫和声那一节再评估。

## 三种练习的判定方式

| 类型 | 怎么判 |
|---|---|
| `quiz` 选择题 | 对错写在选项里，配讲解 |
| `spot` 找错 | **不看你写了什么答案，现场跑规则检查器**；你选的规则编号出现在检查器报告里才算对 |
| `label` 标签填空 | 用 DCML v2.3.0 **官方正则**校验语法，再和参考答案比对，并逐字段解释标签含义 |

`spot` 的答案由检查器给出，所以它和 `theory/counterpoint.js` 的规则集永远一致——
改规则，练习的判定自动跟着变。

## 目录结构

```
index.html              入口
site.config.js          站点身份配置：上线域名、站点名、分享图、收录开关、页脚
404.html                深链接兜底（识别 /u/B1、/t/b 并转回 hash 地址）
_redirects              Cloudflare Pages / Netlify 的 SPA 回退规则
.nojekyll               GitHub Pages 用：关掉 Jekyll 处理
LICENSE                 授权：MIT（原创部分）+ CC0 等第三方说明 +免责声明
assets/css/site.css     样式
assets/js/site.js       核心：内容注册、音频、进度、路由、区块渲染
assets/js/scoremeta.js  把 site.config.js 应用成 head 里的标签
assets/js/drills.js     练习引擎（含 DCML 官方正则）
assets/js/viz.js        可视化：五张图（声部进行 / 挂留 / 曲式 / 调性 / 音网）
assets/js/app.js        启动
assets/scores/          MuseScore 导出的谱面与音频（构建脚本生成）
content/units/          学习内容，每个模块一个文件
docs/关于本站.html      给读者的：数据来源、授权、免责声明、已知限制
theory/core.js          音高、音程、模型
theory/counterpoint.js  21 条对位规则的检查器
theory/kern.js          Humdrum **kern 解析器（读 Fux 语料用）
theory/fux.js           Fux 语料的共享知识：哪个声部是固定旋律、调式 CF 表（tools/ 用）
theory/musicxml.js      MusicXML 写出器（时值切分、延音线、小节补齐）
theory/examples.js      手写谱例（含故意写错的反例）
theory/generated.js     早期用求解器生成的谱例（仅存档，站内已不引用）
scores/fux/             Fux《Gradus ad Parnassum》语料（CC0 公有领域）
tools/build-scores.ps1  批量导出谱面与音频
tools/kern-to-musicxml.js   Fux 语料 .krn → MusicXML（语料只有纯文本，缺这一步）
tools/notes-to-musicxml.js  站内文字记谱 → MusicXML（练习、听辨的谱面）
tools/verify.js         规则检查器（练习批改）与谱例闸门
tools/check-rules.js    规则覆盖闸门：每条规则点名一条必须被它触发的反例
tools/check-page-load.js 按 index.html 的真实顺序把脚本加载一遍（接白屏）
tools/validate-fux.js   用 Fux 原文交叉验证检查器
tools/kern-to-notes.js  .krn → 站内文字记谱（贴谱例时用）
tools/check-audio.js    音频解析回归测试
tools/check-musicxml.js 生成的谱面与源谱是否逐音一致 + 引用的谱面文件是否都在
tools/check-tonnetz.js  音网几何核对
tools/check-viz-data.js 可视化谱例数据核对
tools/check-viz-sync.js 音画对齐回归测试（多声部播放 + 游标时钟）
tools/check-content.js  按《内容写作标准》验收全部单元
tools/check-site-config.js  上线前自检（配置齐不齐、静态 meta 是否同步）
tools/apply-site-config.js  按 site.config.js 生成 robots/sitemap/webmanifest
tools/make-share-image.py   生成分享卡片图 assets/share.png（只要 Python 3）
tools/validate-fux3.js  三声部声部对检查（平行五八度、声部交错）
docs/记谱速查.md        文字记谱格式说明
docs/内容写作标准.md   单元内容的写作标准（术语展开、flow、判据写法）
docs/检查器交接文档.md  检查器的现状、验证方法与待办（交给下一轮用）
```

## 谱例从哪来

**现在一律用 Fux《Gradus ad Parnassum》原文**——不用生成的，也不用我手写的。

语料来自 [`github.com/MarkGotham/species`](https://github.com/MarkGotham/species)：
Fux 全部对位练习（二声部 46 条、三声部 44 条、四声部 32 条）**连同 Fux 本人的解答**，
Norton/Mann 1965 版图号，提供 `.krn`（纯文本）、`.mxl`、`.mscz` 三种格式。
**授权：渲染乐谱 CC0 公有领域**——`.mscz` 可以直接用你的 MuseScore 打开。

每条进课程的谱例都要过两道关（`tools/validate-fux.js`）：

1. **语料核对**：固定旋律必须与 Fux 为该调式规定的旋律逐音吻合；
2. **规则复检**：Fux 的解答喂给本站检查器，0 错误才收。

这个流程抓出了检查器自身的 4 个错误（详见 `docs/检查器交接文档.md`）。
**「Fux 的解答被判违规的条数」是检查器质量的核心指标，目标是 0。**

把新的 `.krn` 丢进 `scores/fux/`，重跑 `node tools/validate-fux.js` 就会自动验证。
想往单元里贴谱例，用 `node tools/kern-to-notes.js gap_073` 直接转成站内格式复制。

### 把谱例变成真五线谱

站内的文字记谱能算不能看，所以"看谱"区块里的谱面是这样来的：

```powershell
# ① Fux 语料 → MusicXML（全部，或只转某一条）
node tools\kern-to-musicxml.js
node tools\kern-to-musicxml.js gap_073

# ② 站内文字记谱 → MusicXML（PowerShell 里用单引号，否则 | 会被当成管道）
node tools\notes-to-musicxml.js --id b1-spot-1 --title 'B1 找错练习 1' `
  --cf 'C5:4 | D5:4 | E5:4 | F5:4 | C5:4' --cp 'F3:4 | G3:4 | A3:4 | Bb3:4 | C4:4' `
  --cfClef treble --cpClef bass

# ③ 批量导出 SVG + MP3（这一步需要 MuseScore）
powershell -ExecutionPolicy Bypass -File tools\build-scores.ps1
```

两个转换器都会：按音高排谱表顺序（语料里的声部顺序不是谱表顺序）、把跨小节线的音
拆开并写成延音线（第四、五类的挂留全靠它）、各声部小节数补齐。
写完用 `node tools/check-musicxml.js` 核对"生成的谱面与源谱是否逐音一致"。

## 关于准确性的诚实声明

本站的内容分三类，可靠性不同：

| 类别 | 可靠性 |
|---|---|
| 对位硬规则判定 | **机器可验**。21 条规则逐条可查、可改、可关；`node tools/verify.js` 与 `node tools/check-rules.js` 的结果就是结论 |
| DCML 标签语法 | **官方正则**，取自 DCMLab/standards v2.3.0，不是我的近似 |
| 讲解文字、文献分析结论 | **草稿**。可能出错，请以原教材和原谱为准 |

特别是：**规则集来自通行教学共识，不是逐字引用某本教材**——
教材 PDF 抓不到，所以我没有把任何一条当成"权威原文"。
所有规则都在 `theory/counterpoint.js` 顶部的 `RULES` 表里，
带编号、中英名、判据说明，你可以随时改成你跟的那套体系。

还有一条边界必须说清：**规则合规 ≠ 音乐好听。**
早期那个求解器（已删除）能产出 0 错误的解，但那些解可能非常呆板
（大量同音反复）。所以：用检查器当筛子，用真实文献当范本，用耳朵当最终裁判。

## 已知限制

- **DCML 官方教程要求 MuseScore 3.6.2 + `.mscx`**，你装的是 4.4.4。
  标注本身能做（添加 → 文本 → 罗马数字分析），但官方的 `ms3` 解析工具
  需要 Python 包，当前环境装不了（pip 走代理被拒）。应急方案是导出 MusicXML，
  用标准库解析——本站的标签检查器走的就是这条路。
- 真实文献的谱面需要你自己从 IMSLP 下载后导入 MuseScore。
  离线环境无法代你下载。
- 谱面在深色模式下靠把黑色替换成 `currentColor` 适配；
  如果导出的 SVG 用了别的颜色，可能不完美。
  **这条不再是"可能"了**：`node tools\check-musicxml.js` 的第 [5] 段会逐个扫描
  `assets/scores/*.svg`，只要出现纯黑之外的描边/填充色、或者颜色被改到 `<style>` 里
  （那样 `site.js` 的选择器命中不了），就直接失败。换 MuseScore 版本或改主题样式后
  它能立刻告诉你。当前 9 个谱面都是纯黑，另有 9 处 MuseScore 的白色纸底色
  铺在最底下——深色模式下会露出一块白，不影响读谱，所以只记一笔不判失败。

---

## 上传公网

### 需要什么环境

**几乎没有额外要求。** 这个项目零依赖、零构建：没有 npm、没有打包步骤、没有后端、
没有数据库、没有环境变量。托管方**不需要运行任何东西**，把文件发出去就行。

需要的只有两样：

1. **一个 Git 仓库**（这机器上 `git` 还没装进 PATH，要先装 Git for Windows）；
2. **一个静态托管**。推荐 **Cloudflare Pages**（免费、自动 HTTPS、`_redirects` 能做
   深链接回退）；**GitHub Pages** 也能用，但深链接回退只能用 `404.html`；
   Netlify / Vercel 同理。

站点总量约 5.0 MB（含 3.1 MB 音频），任何免费额度都远远够用。

### 深链接回退（**上线必配**，否则单元地址分享出去打不开）

本站是 hash 路由的单页应用，单元地址形如 `/#/u/B1`。真实的 `/u/B1` 在服务器上
不存在，所以**刷新和分享都会 404**。

**仓库根已经放好 `_redirects`**，Cloudflare Pages 与 Netlify 会直接读它，
什么都不用做。Vercel 和 GitHub Pages 不读这个文件：

```
# Vercel → 新建 vercel.json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

GitHub Pages 没有 rewrite 机制，用根目录的 `404.html` 兜底（已备好，
会识别 `/u/B1`、`/t/b` 再转回对应的 hash 地址；代价是刷新时会闪一下）。

### 上线步骤

```powershell
# 1. 填 site.config.js 里的 siteUrl（这是唯一必须改的一项）
# 2. 自检 + 生成机器可读文件
node tools\check-site-config.js --online
node tools\apply-site-config.js
# 3. 全量检查，确认没有回归
node tools\verify.js
node tools\check-rules.js
node tools\check-page-load.js
node tools\check-content.js
node tools\check-musicxml.js
# 4. 推上去（需要先装 Git for Windows）
git init && git add -A && git commit -m "上线"
```

Vercel 用户记得再补一个 `vercel.json`（见上）。

### 上线前还差的一件东西

- **`og:image`（分享卡片图）还没有。** 在 `site.config.js` 里把 `shareImage`
  填成一个 1200×630 的图片路径（例如 `assets/share.png`）即可，绝对地址由
  `scoremeta.js` 自动拼好。没有它，分享出去只有纯文字卡片——
  这是目前唯一影响观感的缺口，`check-site-config.js` 会一直提醒你。

`canonical` 与 `og:url` 不用管：填了 `siteUrl` 之后 `scoremeta.js` 会自动写入，
而且只有知道正式域名时才写（指向 localhost 的 canonical 会让搜索引擎直接不收录，
比不写更糟）。

### 上线后的三条可选优化

1. **首屏还是偏重**：全部 14 个脚本是同步加载，其中 `content/units/*.js` 有 598 KB，
   而你一次只看一个单元。改成按需加载能砍掉大半，但要给 `file://` 留退路，
   改动不小。
2. **音频可压缩**：7 个 `fux-fig-*.mp3` 每个恰好 391.8 KB（同一套导出参数），
   9 个共 3.1 MB。单声部范例用 64–96 kbps 能砍掉三分之二以上。
3. **接 CI**：把 `tools/` 下的检查器接进托管方的构建步骤，每次 push 自动跑。
   这套闸门**都验证过"确实会失败"**，是防止"改内容把首页打崩"的有效防线。

### 内容层面的风险（比技术风险大）

- 站内讲解文字是**草稿**。公开前请认真考虑：这会被当成一份以权威口吻讲严格对位与
  Caplin 曲式的资料。`LICENSE` 与 `docs/关于本站.html` 都已明确写明
  "个人笔记、不保证全对"，但**声明不能替代校对**。
- 公开后建议把 `docs/检查器交接文档.md` 从站点里撤掉或改写——它是写给开发者的
  （里面甚至有"给接手的那一轮"这种话），公网访客看了会困惑。目前首页与页脚
  都不再链接它，但它仍在仓库里、URL 可直接访问。

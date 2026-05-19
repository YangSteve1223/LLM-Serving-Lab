
# PPTX2MD

一个面向 **AI 阅读与后续处理** 的 `PPTX -> Markdown` CLI 工具。

它的目标不是还原 PPT 的视觉排版，而是尽可能把 PPT 中**可稳定提取的结构化信息**整理成适合 AI 理解的 Markdown 与 metadata，包括：

- 文本
- 标题
- 表格
- Notes
- 普通图片
- GIF
- 视频
- 页级摘要
- 文档级 metadata

---

## 1. 项目目标

很多 PPT 转文本工具只能得到“散乱文本”或“截图 OCR 结果”，不适合后续做：

- LLM 阅读
- RAG / chunking
- slide-level 摘要
- metadata 治理
- 多媒体内容整理

本项目采用 **结构优先** 的思路：

- 输入：`.pptx`
- 输出：
  - `out.md`
  - `metadata.json`
  - `slide_summaries.md`
  - `debug/*.json`
  - `assets/`（导出的图片 / GIF / 视频 / poster）

---

## 2. 当前能力

当前版本已经支持：

### 文本与结构
- 提取标题与正文文本
- 保留基本列表层级
- 识别 slide title
- 过滤明显噪声块（如页码占位符）

### 媒体
- 提取普通图片
- 提取 GIF
- 提取嵌入视频
- 为视频导出 poster（若存在）
- 在 Markdown 中插入图片 / GIF / 视频链接

### 其他内容
- 提取 speaker notes
- 提取表格
- 预留图表抽取结构

### 输出治理
- 生成符合公共 schema 的 `metadata.json`
- 自动执行 metadata schema 校验
- 生成：
  - `slide_summaries.md`
  - `debug/slide_structure.json`
  - `debug/warnings.json`
  - `debug/slide_summaries.json`

### 批处理
- 支持目录级批量转换
- 自动生成：
  - `batch_manifest.json`
  - `batch_report.md`

---

## 3. 当前不追求的事情

本项目**不是**视觉还原工具，因此当前不追求：

- PPT 像素级版面复原
- OCR
- 图片语义理解
- 视频语音转写
- SmartArt 完整关系恢复
- 动画与过渡效果恢复
- `.ppt` 老格式直接解析

如果你的目标是“给 AI 看懂 PPT 内容”，这个工具是合适的。  
如果你的目标是“把 PPT 视觉上 1:1 变成网页”，这不是当前项目的定位。

---

## 4. 项目结构

```text
pptx2md/
  README.md
  requirements.txt
  spec/
    metadata_spec.md
    metadata.schema.json
    metadata.example.json

  src/
    pptx2md/
      __init__.py
      cli.py

      models/
      extractors/
      normalizers/
      renderers/
      stats/
      validators/

  tests/
    samples/
    test_smoke.py
    test_media_consistency.py
    test_batch_convert.py
````

---

## 5. 环境与安装

推荐环境：

* Windows 10 / 11
* Anaconda / Miniconda
* Python 3.11

### 5.1 创建环境

```bash
conda create -n pptx2md python=3.11 -y
conda activate pptx2md
```

### 5.2 安装依赖

```bash
pip install python-pptx lxml typer pydantic orjson pytest rich jsonschema
```

或者使用：

```bash
pip install -r requirements.txt
```

### 5.3 设置 `PYTHONPATH`

如果你使用的是 `src/` 布局，Windows CMD / Anaconda Prompt 下可运行：

```bat
set PYTHONPATH=%CD%\src
```

---

## 6. 快速开始

---

### 6.1 单文件转换

```bat
python -m pptx2md.cli convert tests/samples/simple_title_body.pptx -o output
python -m pptx2md.cli convert "D:\graduate_project\ai_learning\pptx2md\tests\samples\simple_title_body.pptx" -o output

```

执行成功后，你会看到类似输出：

```text
Metadata schema validation: PASSED
转换完成（版本 0.1.0）
Slides parsed: 5
Markdown: output\out.md
Metadata: output\metadata.json
Slide summaries markdown: output\slide_summaries.md
Assets dir: output\assets
Debug slide structure: output\debug\slide_structure.json
Debug warnings: output\debug\warnings.json
Debug slide summaries: output\debug\slide_summaries.json
```

---

### 6.2 校验 metadata

```bat
python -m pptx2md.cli validate output/metadata.json
```

如果通过，会看到：

```text
Metadata schema validation: PASSED
```

---

### 6.3 目录批量转换

```bat
python -m pptx2md.cli convert-dir tests/samples -o batch_output
python -m pptx2md.cli convert-dir "D:\graduate_project\ai_learning\pptx2md\tests\samples" -o batch_output

```

执行后会生成：

* `batch_output/batch_manifest.json`
* `batch_output/batch_report.md`

---

### 6.4 运行测试

```bat
pytest -q
```

---

## 7. 输出结构

单文件转换后的输出目录大致如下：

```text
output/
  out.md
  metadata.json
  slide_summaries.md
  assets/
    ...
  debug/
    slide_structure.json
    warnings.json
    slide_summaries.json
```

---

## 8. 各输出文件说明

### 8.1 `out.md`

主输出文件。
面向 AI 阅读，包含：

* 每页标题
* 正文
* 图片 / GIF
* 视频 poster 与视频链接
* 表格
* Notes

### 8.2 `metadata.json`

文档级元数据，包含：

* 文档标识
* 输入来源
* 输出路径
* 内容画像
* downstream 信息

### 8.3 `slide_summaries.md`

为每页生成紧凑摘要，适合快速浏览和后续给 AI 做页级理解。

### 8.4 `assets/`

导出的媒体资源目录，包括：

* 图片
* GIF
* 视频
* 视频 poster

### 8.5 `debug/slide_structure.json`

最重要的调试文件之一，包含：

* 每页 block 结构
* block 坐标
* shape 信息
* block 类型
* filter 标记
* extra 信息

### 8.6 `debug/warnings.json`

记录提取过程中的信息与警告，例如：

* `FILTERED_BLOCK`
* `IMAGE_EXTRACTED`
* `GIF_EXTRACTED`
* `VIDEO_EXTRACTED`
* `DENSE_MEDIA_SLIDE`

### 8.7 `debug/slide_summaries.json`

页级摘要的结构化 JSON 版本，便于程序继续处理。

---

## 9. 当前支持的内容类型

| 类型       | 当前状态      |
| -------- | --------- |
| 文本       | 已支持       |
| 标题识别     | 已支持       |
| Notes    | 已支持       |
| 表格       | 已支持       |
| 图片       | 已支持       |
| GIF      | 已支持       |
| 视频       | 已支持       |
| 图表       | 初步支持 / 预留 |
| SmartArt | 暂未完整支持    |
| 动画 / 过渡  | 暂不支持      |
| OCR      | 暂不支持      |

---

## 10. Markdown 组织策略

当前 Markdown 采用“结构优先”的组织方式，而不是追求视觉还原。

典型结构如下：

```md
## Slide 1

### Title
...

### Main Content
...

### Media
...

### Tables
...

### Charts
...

### Notes
...
```

对于**信息密集页**（文本很多、媒体很多），当前会自动改成：

* `Main Content`
* `Media`

分区组织，以便 AI 阅读时更清晰。

---

## 11. metadata 设计说明

本项目遵循公共 metadata 主干规范，当前输出的 `metadata.json` 包括：

* `metadata_version`
* `document_id`
* `task_id`
* `source`
* `output`
* `content_profile`
* `downstream`

其中 `source.details` 会补充 PPT 特有字段，例如：

* `slide_count`
* `has_speaker_notes`
* `embedded_media_count`
* `image_shape_count`
* `gif_image_count`
* `video_shape_count`
* `external_video_count`
* `chart_shape_count`

---

## 12. 当前样例的实际结果（示例）

以当前样例 `simple_title_body.pptx` 为例，项目已经成功提取出：

* 5 页
* 12 个图片型媒体
* 5 个 GIF
* 2 个视频
* 存在 speaker notes
* metadata schema 校验通过

这说明当前版本已经具备实际可用性。

---

## 13. 已知限制

当前版本仍有这些限制：

1. 不支持 `.ppt` 老格式直接解析
2. 不保证视觉排版的像素级还原
3. 图文混排页面仍主要按启发式排序
4. 图表提取仍偏基础
5. SmartArt / 时间轴 / 信息图页的结构优化仍有提升空间
6. 视频当前只做导出与链接，不做时长、抽帧、转写

---

## 14. 适合的使用场景

本工具适合：

* 将 PPT 转成 AI 可读 Markdown
* 做 slide-based chunking
* 做页级摘要
* 作为 RAG 前处理步骤
* 做文档治理 / metadata 管道
* 做多媒体增强的 PPT 文本化

---

## 15. 后续可继续迭代的方向

建议优先考虑：

1. 更强的 `language_distribution`
2. 更强的图表提取
3. 更强的信息密集页重组
4. 媒体专项测试样例
5. 更细的 warning / quality 体系
6. `.ppt` 支持策略
7. 批处理失败容错与日志增强

---

## 16. 开发建议

如果你继续开发，推荐顺序：

1. 先增加测试样例
2. 再做新能力接入
3. 最后再调 Markdown 呈现样式

也就是说：

**先保证抽取得到，后优化展示质量。**

---

## 17. 许可证与说明

当前 README 为项目开发阶段版本。
如后续对外发布，建议补充：

* License
* Versioning policy
* Changelog
* Contribution guide

---

## 18. 一句话总结

**PPTX2MD 是一个面向 AI 阅读的 PPTX -> Markdown CLI 工具，支持文本、Notes、图片、GIF、视频、metadata、slide summaries 与目录批处理。**


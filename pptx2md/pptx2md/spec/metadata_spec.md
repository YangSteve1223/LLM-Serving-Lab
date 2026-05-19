# metadata_spec.md

## 1. 文档目的

本规范用于描述“多来源、多格式内容转 Markdown”后的统一元数据结构。  

适用来源包括：

- PDF
- PPTX
- DOCX
- 网页 / HTML / 公众号
- 音频
- 视频
- 图片
- 表格
- 其他可转 Markdown 的来源

---

## 2. 设计原则

### 2.1 统一主干，来源细节分层
统一字段放在顶层与 `source`、`output`、`content_profile` 中；不同来源的个性字段统一放入 `source.details`。

### 2.2 先满足最小可用，再逐步扩展
本版聚焦以下能力：

- 标识文档与任务
- 追溯原始来源
- 描述 Markdown 输出
- 描述内容结构画像
- 为后续知识库处理预留下游字段

### 2.3 时间统一使用 ISO 8601
例如：

```text
2026-04-20T20:03:00+08:00
```

### 2.4 文件指纹建议统一用 sha256
用于去重、版本追踪、重复处理判断。

---

## 3. 顶层字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `metadata_version` | string | 是 | 元数据规范版本，建议使用语义化版本，如 `1.0.0` |
| `document_id` | string | 是 | 文档级唯一标识，表示逻辑文档对象 |
| `task_id` | string | 是 | 本次转换任务的唯一标识 |
| `batch_id` | string | 否 | 批处理任务标识 |
| `parent_document_id` | string / null | 否 | 上游文档 ID，用于派生文档或修订版 |
| `created_at` | string(date-time) | 是 | 元数据创建时间 |
| `updated_at` | string(date-time) | 是 | 元数据更新时间 |
| `status` | enum | 是 | 当前状态，取值见下文 |
| `source` | object | 是 | 原始来源信息 |
| `output` | object | 是 | Markdown 输出信息 |
| `content_profile` | object | 是 | 内容结构画像 |
| `downstream` | object | 否 | 面向知识库 / 下游处理的预留字段 |

### `status` 允许值

- `pending`
- `processing`
- `completed`
- `failed`
- `partial`

---

## 4. `source` 字段说明

`source` 用于描述原始输入对象。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `source_type` | enum | 是 | 来源类型 |
| `source_name` | string | 是 | 来源名称，通常是文件名或资源名 |
| `source_uri` | string | 是 | 来源地址，可以是文件路径、URL、对象存储路径等 |
| `source_id` | string / null | 否 | 来源系统中的内部 ID |
| `mime_type` | string | 是 | 实际媒体类型，如 `application/pdf` |
| `file_size_bytes` | integer | 否 | 文件大小，单位字节 |
| `checksum` | object | 是 | 原始文件内容指纹 |
| `language` | string[] | 是 | 文档包含的语言列表 |
| `title` | string | 否 | 文档标题 |
| `authors` | string[] | 否 | 作者列表 |
| `published_at` | string(date-time) / null | 否 | 发布时间 |
| `collected_at` | string(date-time) | 是 | 采集时间 |
| `access_method` | enum | 是 | 获取方式 |
| `details` | object | 是 | 来源类型专属扩展字段 |

### `source_type` 允许值

- `pdf`
- `pptx`
- `docx`
- `html`
- `webpage`
- `wechat_article`
- `audio`
- `video`
- `image`
- `spreadsheet`
- `other`

### `access_method` 允许值

- `upload`
- `url_fetch`
- `api`
- `crawler`
- `manual_import`
- `bot_forward`
- `local_file`

### `checksum` 子结构

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `algorithm` | enum | 是 | 哈希算法 |
| `value` | string | 是 | 哈希值 |

`algorithm` 建议优先使用：

- `sha256`

其他允许值：

- `sha1`
- `md5`
- `blake3`
- `other`

### `source.details` 建议写法

`source.details` 是来源特定字段承载区，建议按来源类型写入。

#### PDF 示例

```json
{
  "page_count": 14,
  "is_scanned": false,
  "has_ocr": false,
  "pdf_version": "1.7",
  "bookmarks_detected": true
}
```

#### PPTX 示例

```json
{
  "slide_count": 35,
  "has_speaker_notes": true,
  "embedded_media_count": 3
}
```

#### 网页 / 公众号 示例

```json
{
  "url": "https://example.com/article",
  "domain": "example.com",
  "site_name": "Example",
  "http_status": 200
}
```

#### 音视频 示例

```json
{
  "platform": "bilibili",
  "duration_seconds": 1832,
  "subtitle_available": true
}
```

---

## 5. `output` 字段说明

`output` 用于描述最终 Markdown 产物。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `format` | const string | 是 | 固定为 `markdown` |
| `markdown_file` | string | 是 | Markdown 主文件路径 |
| `assets_dir` | string | 是 | 资源目录，如图片、附件等 |
| `image_reference_mode` | enum | 是 | 图片引用方式 |
| `markdown_encoding` | string | 否 | Markdown 编码，建议 `utf-8` |
| `markdown_dialect` | string | 否 | Markdown 方言，如 `commonmark` |
| `has_front_matter` | boolean | 否 | 是否包含 front matter |

### `image_reference_mode` 允许值

- `relative_path`
- `absolute_path`
- `url`
- `embedded_base64`
- `none`

---

## 6. `content_profile` 字段说明

`content_profile` 用于描述 Markdown 内容的结构特征，方便后续分析、质检、切块、入库。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `char_count` | integer | 是 | 字符数 |
| `word_count` | integer | 否 | 单词数 |
| `line_count` | integer | 否 | 行数 |
| `heading_count` | integer | 是 | 标题数量 |
| `paragraph_count` | integer | 否 | 段落数量 |
| `image_count` | integer | 是 | 图片数量 |
| `table_count` | integer | 是 | 表格数量 |
| `formula_count` | integer | 是 | 公式数量 |
| `code_block_count` | integer | 否 | 代码块数量 |
| `list_count` | integer | 否 | 列表数量 |
| `quote_block_count` | integer | 否 | 引用块数量 |
| `link_count` | integer | 是 | 链接数量 |
| `footnote_count` | integer | 否 | 脚注数量 |
| `structure_level_max` | integer | 否 | 最大标题层级 |
| `segment_count` | integer | 否 | 分段数，适合转写类内容 |
| `speaker_count` | integer | 否 | 说话人数量，适合音视频转写 |
| `timestamped` | boolean | 否 | 是否带时间戳 |
| `language_distribution` | object | 是 | 语言占比分布 |

### `language_distribution` 示例

```json
{
  "zh": 0.8,
  "en": 0.2
}
```

说明：

- key 为语言代码
- value 为占比，范围 `0 ~ 1`
- 建议总和接近 `1.0`

---

## 7. `downstream` 字段说明

`downstream` 为可选字段，用于支持知识库、RAG、切块与嵌入等下游处理。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `chunking_ready` | boolean | 否 | 是否已适合切块 |
| `recommended_chunk_strategy` | enum | 否 | 推荐切块策略 |
| `sensitive_level` | enum | 否 | 敏感级别 |
| `license` | string | 否 | 使用许可说明 |
| `dedup_key` | string | 否 | 去重键 |
| `embedding_status` | enum | 否 | 向量化状态 |

### `recommended_chunk_strategy` 允许值

- `heading_based`
- `page_based`
- `slide_based`
- `time_based`
- `paragraph_based`
- `custom`

### `sensitive_level` 允许值

- `normal`
- `internal`
- `confidential`
- `restricted`

### `embedding_status` 允许值

- `pending`
- `completed`
- `failed`
- `skipped`

---

## 8. 必填字段最小集

如果只实现最小可用落地版本，建议至少保证以下字段可用：

- `metadata_version`
- `document_id`
- `task_id`
- `created_at`
- `updated_at`
- `status`
- `source.source_type`
- `source.source_name`
- `source.source_uri`
- `source.mime_type`
- `source.checksum`
- `source.language`
- `source.collected_at`
- `source.access_method`
- `source.details`
- `output.format`
- `output.markdown_file`
- `output.assets_dir`
- `output.image_reference_mode`
- `content_profile.char_count`
- `content_profile.heading_count`
- `content_profile.image_count`
- `content_profile.table_count`
- `content_profile.formula_count`
- `content_profile.link_count`
- `content_profile.language_distribution`

---

## 9. ID 与命名建议

建议统一规则：

- `document_id`: `doc_{date}_{hash8}`
- `task_id`: `task_{date}_{serial}`
- `batch_id`: `batch_{date}_{group}`

示例：

```text
document_id = doc_20260420_a1b2c3d4
task_id = task_20260420_013
batch_id = batch_20260420_teamA
```

---

## 10. 示例文件说明

配套示例文件 `metadata.example.json` 展示了一份 PDF 论文转 Markdown 的元数据实例，包含：

- 来源文件信息
- Markdown 输出位置
- 内容结构画像
- 下游知识库预留信息

该示例可直接作为联调、测试、文档演示的起始样例。

---

## 11. 后续扩展建议

后续如果系统逐步成熟，建议再补回以下模块：

- `processing`：记录转换工具链与步骤
- `quality`：记录质量评估、异常与审核需求
- `provenance`：记录项目、责任人、团队归属
- `custom`：承载业务定制字段

这样可以从“最小可用版本”平滑升级到“完整治理版本”。

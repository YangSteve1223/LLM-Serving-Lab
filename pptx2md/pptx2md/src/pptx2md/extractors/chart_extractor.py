from __future__ import annotations

from pptx.shapes.base import BaseShape

from pptx2md.models.block import BlockModel
from pptx2md.normalizers.text_cleaner import normalize_ppt_text


class ChartExtractor:
    """
    Extract chart information from a shape if it contains a chart.

    V1 goals:
    - chart type
    - chart title
    - categories (if available)
    - series names and values
    """

    def extract(self, shape: BaseShape, block_index: int) -> BlockModel | None:
        if not getattr(shape, "has_chart", False):
            return None

        try:
            chart = shape.chart
        except Exception:
            return None

        chart_type = None
        try:
            chart_type = str(chart.chart_type)
        except Exception:
            chart_type = None

        chart_title = None
        try:
            if chart.has_title:
                chart_title = normalize_ppt_text(chart.chart_title.text_frame.text)
        except Exception:
            chart_title = None

        categories: list[str] = []
        try:
            plot = chart.plots[0]
            for cat in plot.categories:
                label = getattr(cat, "label", None)
                if label is not None:
                    categories.append(str(label))
                else:
                    categories.append(str(cat))
        except Exception:
            categories = []

        series_data: list[dict] = []
        try:
            for ser in chart.series:
                try:
                    name = normalize_ppt_text(getattr(ser, "name", "") or "")
                except Exception:
                    name = ""

                try:
                    values = list(ser.values)
                except Exception:
                    values = []

                series_data.append({
                    "name": name,
                    "values": values
                })
        except Exception:
            series_data = []

        summary_lines: list[str] = []
        if chart_type:
            summary_lines.append(f"chart_type: {chart_type}")
        if chart_title:
            summary_lines.append(f"title: {chart_title}")
        if categories:
            summary_lines.append("categories: " + ", ".join(categories))
        if series_data:
            summary_lines.append("series_count: " + str(len(series_data)))

        summary_text = "\n".join(summary_lines) if summary_lines else None

        placeholder_type = None
        if getattr(shape, "is_placeholder", False):
            try:
                placeholder_type = str(shape.placeholder_format.type)
            except Exception:
                placeholder_type = None

        return BlockModel(
            block_id=f"block_{block_index}",
            block_type="chart",
            role_hint="chart",
            shape_id=getattr(shape, "shape_id", None),
            shape_name=getattr(shape, "name", None),
            shape_type=str(getattr(shape, "shape_type", None)),
            placeholder_type=placeholder_type,
            left=getattr(shape, "left", None),
            top=getattr(shape, "top", None),
            width=getattr(shape, "width", None),
            height=getattr(shape, "height", None),
            z_order=block_index,
            text=summary_text,
            is_filtered=False,
            filter_reason=None,
            extra={
                "chart_type": chart_type,
                "chart_title": chart_title,
                "categories": categories,
                "series": series_data
            }
        )
from __future__ import annotations

from pathlib import Path
import json

from jsonschema import Draft202012Validator


class MetadataValidator:
    """
    Validate metadata.json against a JSON schema file.
    """

    def validate(self, metadata_path: Path, schema_path: Path) -> tuple[bool, list[str]]:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        schema = json.loads(schema_path.read_text(encoding="utf-8"))

        validator = Draft202012Validator(schema)
        errors = sorted(validator.iter_errors(metadata), key=lambda e: list(e.path))

        if not errors:
            return True, []

        messages: list[str] = []
        for err in errors:
            path_str = ".".join(str(x) for x in err.path) if err.path else "(root)"
            messages.append(f"{path_str}: {err.message}")

        return False, messages
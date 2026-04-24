import argparse
import json
import os
from pathlib import Path


INDEX_HTML = """<!doctype html>
<html lang=\"en\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>TRAC API Documentation</title>
    <style>
      body { margin: 0; padding: 0; }
      redoc { display: block; min-height: 100vh; }
    </style>
  </head>
  <body>
    <redoc spec-url=\"openapi.json\"></redoc>
    <script src=\"https://cdn.jsdelivr.net/npm/redoc@next/bundles/redoc.standalone.js\"></script>
  </body>
</html>
"""


def _set_default_env() -> None:
    # Defaults used only for static OpenAPI generation in CI.
    os.environ.setdefault("TUD_DATABASE_URL", "sqlite:///:memory:")
    os.environ.setdefault("TUD_ALLOWED_ORIGINS", '["http://localhost:3000"]')
    os.environ.setdefault("TUD_API_ADMIN_USERNAME", "release_docs_admin")
    os.environ.setdefault("TUD_API_ADMIN_PASSWORD", "release_docs_password")


def generate_docs(output_dir: Path) -> None:
    _set_default_env()

    from o_timeusediary_backend.api import app

    output_dir.mkdir(parents=True, exist_ok=True)

    openapi_data = app.openapi()
    openapi_path = output_dir / "openapi.json"
    openapi_path.write_text(
        json.dumps(openapi_data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    index_path = output_dir / "index.html"
    index_path.write_text(INDEX_HTML, encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate static API docs files for a release."
    )
    parser.add_argument(
        "--output-dir",
        default="release-api-docs",
        help="Directory where openapi.json and index.html are written.",
    )
    args = parser.parse_args()
    generate_docs(Path(args.output_dir).resolve())

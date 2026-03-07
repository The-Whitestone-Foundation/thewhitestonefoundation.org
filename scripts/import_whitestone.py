import os
import re
from datetime import datetime

SITE_ROOT = "/Users/abrett76/github/thewhitestonefoundation-content/thewhitestonefoundation.org"
OUT_ROOT = "/Users/abrett76/github/thewhitestonefoundation-content"

POSTS_DIR = os.path.join(OUT_ROOT, "content", "posts")
PAGES_DIR = os.path.join(OUT_ROOT, "content", "pages")

SKIP_DIRS = {
    "wp-content",
    "wp-includes",
    "wp-json",
    "category",
    "tag",
    "author",
    "comments",
    "feed",
}


def extract_title(html):
    m = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.S | re.I)
    if m:
        return re.sub(r"<[^>]+>", "", m.group(1)).strip()
    m = re.search(r"<title>(.*?)</title>", html, re.S | re.I)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else "Untitled"


def extract_description(html):
    m = re.search(r"<meta[^>]+name=\"description\"[^>]+content=\"([^\"]+)\"", html, re.I)
    if m:
        return m.group(1).strip()
    m = re.search(r"<meta[^>]+property=\"og:description\"[^>]+content=\"([^\"]+)\"", html, re.I)
    return m.group(1).strip() if m else ""


def extract_date(html):
    m = re.search(r"<time[^>]+class=\"entry-date[^\"]*\"[^>]+datetime=\"([^\"]+)\"", html, re.I)
    if m:
        return m.group(1).strip()
    return ""


def extract_author(html):
    m = re.search(r"class=\"author[^\"]*\"[^>]*>\s*<a[^>]*>(.*?)</a>", html, re.S | re.I)
    if m:
        return re.sub(r"<[^>]+>", "", m.group(1)).strip()
    return ""


def extract_taxonomy(html):
    categories = []
    tags = []
    m = re.search(r"<article[^>]+class=\"([^\"]+)\"", html, re.I)
    if m:
        classes = m.group(1)
        categories = re.findall(r"category-([a-z0-9-]+)", classes, re.I)
        tags = re.findall(r"tag-([a-z0-9-]+)", classes, re.I)
    return categories, tags


def extract_image(html):
    m = re.search(r"<meta[^>]+property=\"og:image\"[^>]+content=\"([^\"]+)\"", html, re.I)
    if m:
        return m.group(1).strip()
    m = re.search(r"<img[^>]+src=\"([^\"]+wp-content/uploads/[^\"]+)\"", html, re.I)
    return m.group(1).strip() if m else ""


def extract_content(html):
    m = re.search(r"<div class=\"entry-content\"[^>]*>([\s\S]*?)</div>\s*<!-- \.entry-content -->", html, re.I)
    if not m:
        return ""
    body = m.group(1).strip()
    # remove comment form or navigation if present
    body = re.sub(r"<div id=\"comments\"[\s\S]*", "", body, flags=re.I)
    # normalize asset paths
    body = re.sub(r"(?:(?:\.\./)+|/)?wp-content/uploads/", "/images/wp-content/uploads/", body)
    return body.strip()


def normalize_image(url):
    if not url:
        return ""
    url = re.sub(r"(?:(?:\.\./)+|/)?wp-content/uploads/", "/images/wp-content/uploads/", url)
    url = re.sub(r"^https?://thewhitestonefoundation\.org/", "/", url)
    return url


def write_file(out_path, front_matter, body):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("---\n")
        for key, val in front_matter.items():
            if val is None or val == "":
                continue
            if isinstance(val, list):
                f.write(f"{key}:\n")
                for item in val:
                    f.write(f"  - {item}\n")
            else:
                f.write(f"{key}: {val}\n")
        f.write("---\n\n")
        f.write(body)
        f.write("\n")


def is_post(html):
    return "type-post" in html


def slug_from_path(path):
    rel = os.path.relpath(path, SITE_ROOT)
    rel = rel.replace("index.html", "").strip("/")
    return rel


for dirpath, _, filenames in os.walk(SITE_ROOT):
    if any(part in SKIP_DIRS for part in dirpath.split(os.sep)):
        continue
    if "index.html" not in filenames:
        continue

    src = os.path.join(dirpath, "index.html")
    with open(src, "r", encoding="utf-8", errors="ignore") as f:
        html = f.read()

    rel_slug = slug_from_path(src)
    if rel_slug == "":
        permalink = "/"
    else:
        permalink = f"/{rel_slug}/"

    title = extract_title(html)
    description = extract_description(html)
    date = extract_date(html)
    author = extract_author(html)
    categories, tags = extract_taxonomy(html)
    image = normalize_image(extract_image(html))
    body = extract_content(html)

    front_matter = {
        "title": f"\"{title}\"",
        "description": f"\"{description}\"" if description else "",
        "date": date if date else "",
        "author": author if author else "",
        "categories": categories,
        "tags": tags,
        "image": image if image else "",
        "permalink": permalink,
    }

    if is_post(html):
        out_path = os.path.join(POSTS_DIR, rel_slug.replace("/", "-") + ".md")
    else:
        name = rel_slug if rel_slug else "index"
        out_path = os.path.join(PAGES_DIR, name.replace("/", "-") + ".md")

    write_file(out_path, front_matter, body)

print("Import complete")

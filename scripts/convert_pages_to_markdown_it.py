import os
import re
import html
from html.parser import HTMLParser

ROOT = "/Users/abrett76/github/thewhitestonefoundation-content"
PAGES_DIR = os.path.join(ROOT, "content", "pages")

BLOCK_TAGS = {"p", "div", "section", "article"}

class MDParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.out = []
        self.stack = []
        self.list_stack = []
        self.current_href = None
        self.in_blockquote = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.stack.append(tag)
        if tag in BLOCK_TAGS:
            self._ensure_blank_line()
        elif tag in {"br"}:
            self.out.append("\n")
        elif tag in {"em", "i"}:
            self.out.append("*")
        elif tag in {"strong", "b"}:
            self.out.append("**")
        elif tag == "a":
            self.current_href = attrs.get("href", "")
            self.out.append("[")
        elif tag == "img":
            src = attrs.get("src", "")
            alt = attrs.get("alt", "")
            if src:
                self._ensure_blank_line()
                self.out.append(f"![{alt}]({src})\n")
        elif tag in {"ul", "ol"}:
            self.list_stack.append(tag)
            self._ensure_blank_line()
        elif tag == "li":
            self._ensure_blank_line()
            bullet = "- " if (self.list_stack and self.list_stack[-1] == "ul") else "1. "
            self.out.append(bullet)
        elif tag in {"h1","h2","h3","h4","h5","h6"}:
            self._ensure_blank_line()
            level = int(tag[1])
            self.out.append("#" * level + " ")
        elif tag == "blockquote":
            self._ensure_blank_line()
            self.in_blockquote = True
        elif tag == "iframe":
            src = attrs.get("src", "")
            title = attrs.get("title", "Video")
            if src:
                self._ensure_blank_line()
                self.out.append(f"[{title}]({src})\n")
        elif tag == "video":
            self._ensure_blank_line()
        elif tag == "source":
            src = attrs.get("src", "")
            if src:
                self.out.append(f"[Video]({src})\n")

    def handle_endtag(self, tag):
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        if tag in {"em", "i"}:
            self.out.append("*")
        elif tag in {"strong", "b"}:
            self.out.append("**")
        elif tag == "a":
            href = self.current_href or ""
            self.out.append(f"]({href})")
            self.current_href = None
        elif tag in BLOCK_TAGS:
            self._ensure_blank_line()
        elif tag in {"ul", "ol"}:
            if self.list_stack:
                self.list_stack.pop()
            self._ensure_blank_line()
        elif tag == "li":
            self.out.append("\n")
        elif tag in {"h1","h2","h3","h4","h5","h6"}:
            self._ensure_blank_line()
        elif tag == "blockquote":
            self.in_blockquote = False
            self._ensure_blank_line()

    def handle_data(self, data):
        text = html.unescape(data)
        if not text.strip():
            return
        if self.in_blockquote:
            lines = text.splitlines()
            for line in lines:
                if line.strip():
                    self.out.append("> " + line.strip() + "\n")
        else:
            self.out.append(text)

    def _ensure_blank_line(self):
        if not self.out:
            return
        if not self.out[-1].endswith("\n\n"):
            if not self.out[-1].endswith("\n"):
                self.out.append("\n")
            self.out.append("\n")

    def get_markdown(self):
        md = "".join(self.out)
        md = re.sub(r"\n{3,}", "\n\n", md)
        return md.strip() + "\n"


def split_front_matter(text):
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            return "---" + parts[1] + "---\n\n", parts[2]
    return "", text


def convert_html_to_md(html_text):
    parser = MDParser()
    parser.feed(html_text)
    return parser.get_markdown()


for dirpath, _, filenames in os.walk(PAGES_DIR):
    for fn in filenames:
        if not fn.endswith(".md"):
            continue
        path = os.path.join(dirpath, fn)
        raw = open(path, "r", encoding="utf-8").read()
        fm, body = split_front_matter(raw)
        body = body.strip()
        if not body:
            continue
        if "<" not in body or ">" not in body:
            continue
        md = convert_html_to_md(body)
        with open(path, "w", encoding="utf-8") as f:
            f.write(fm)
            f.write(md)

print("Converted pages with HTML bodies")

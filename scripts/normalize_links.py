import os
import re

ROOT = "/Users/abrett76/github/thewhitestonefoundation-content"
TARGET_DIRS = [os.path.join(ROOT, "content", "posts"), os.path.join(ROOT, "content", "pages")]

# patterns
href_index = re.compile(r'href="(?:\.\./)+([^"#?]*?)index\.html"')
md_index = re.compile(r'\]\((?:\.\./)+([^\)#?]*?)index\.html\)')
src_index = re.compile(r'src="(?:\.\./)+([^"#?]*?)index\.html"')

wp_uploads = re.compile(r'(?:\.\./)+wp-content/uploads/')

sitesucker_mp4 = re.compile(r'\.{2}/\.{2}/sitesucker\.googlevideo\.com/([A-Za-z0-9_-]+)\.mp4')


def normalize(text: str) -> str:
    # relative index.html to pretty URL
    text = href_index.sub(r'href="/\1"', text)
    text = src_index.sub(r'src="/\1"', text)
    text = md_index.sub(r'](/\1)', text)

    # wp uploads to /images
    text = wp_uploads.sub('/images/wp-content/uploads/', text)

    # sitesucker mp4 to youtube embed
    text = sitesucker_mp4.sub(r'https://www.youtube.com/embed/\1', text)

    return text


for base in TARGET_DIRS:
    for dirpath, _, filenames in os.walk(base):
        for fn in filenames:
            if not fn.endswith('.md'):
                continue
            path = os.path.join(dirpath, fn)
            with open(path, 'r', encoding='utf-8') as f:
                raw = f.read()
            updated = normalize(raw)
            if updated != raw:
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(updated)

print("normalized")

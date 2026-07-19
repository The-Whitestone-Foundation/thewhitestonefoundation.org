[![Netlify Status](https://api.netlify.com/api/v1/badges/ef345c83-b57e-4f35-8cf2-083badc51feb/deploy-status)](https://app.netlify.com/projects/thewhitestonefoundation/deploys)
# The Whitestone Foundation Website

This repository contains the source code for The Whitestone Foundation website, built with Eleventy (11ty) and managed via [Pages CMS](https://pagescms.org/).

A project develop by [Adam Dj Brett](https://adamdjbrett.com)

## Embedded publication releases

The site includes [`knowledge-as-infrastructure`](https://github.com/The-Whitestone-Foundation/knowledge-as-infrastructure) as a pinned Git submodule and publishes it at `/publications/okf-knowledge-context/`.

Clone the complete site with `git clone --recurse-submodules`, or initialize an existing clone with `git submodule update --init --recursive`.

To release a publication update:

1. Merge and push the publication changes to its `main` branch.
2. In this repository, run `git submodule update --remote vendor/knowledge-as-infrastructure` and commit the updated submodule pointer.
3. Push the foundation branch, verify the Netlify deploy preview, and merge it.

### Project and Help

Need help or have project ?? Contact Me
+ https://adamdjbrett.com
+ info@adamdjbrett.com

---

## 🛠 Project Structure

### Page Configurations
All list-page settings (index, authors list, archive titles, and descriptions) are managed through:
- **Location**: `content/page-setup/`
- **File Types**: `.njk` or `.md`
- **Purpose**: Controlling list layouts, SEO titles, and page-specific metadata.

### Content & Data
Dynamic content and global site data are managed through Pages CMS using `.pages.yml`:
- **Blog Posts**: Managed in `content/posts/`
- **Author Profiles**: Managed in `content/authors/`
- **Site Metadata**: Managed in `_data/metadata.yaml`
- **Panelists & Team**: Managed in `_data/panelists.yaml` and `_data/team.yaml`
- **Videos**: Managed in `_data/videos.yaml`

---

## 🖼 Image Credits

- Homepage hero image (`/images/getty-images-ZBuxbdFzh2c-unsplash.webp`): photo by [Getty Images](https://unsplash.com/@gettyimages) on [Unsplash](https://unsplash.com/). Licensed under the Unsplash+ License.
- Explore Wild Globalization card image (`/images/getty-images-NANjlLsEuXo-unsplash0web.webp`): photo by [Getty Images](https://unsplash.com/@gettyimages) on [Unsplash](https://unsplash.com/). Licensed under the Unsplash+ License.
- Full image credits for the site are published at [thewhitestonefoundation.org/credits.txt](https://thewhitestonefoundation.org/credits.txt).

---

### Project and Help

Need help or have project ?? Contact Me
+ https://adamdjbrett.com
+ info@adamdjbrett.com

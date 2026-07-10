import markdownIt from 'markdown-it';
import yaml from 'js-yaml';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';

const md = markdownIt({ html: true, breaks: true, linkify: true, typographer: true });
const metadataData = yaml.load(readFileSync('./src/_data/metadata.yaml', 'utf8'));
const metadata = {
  ...metadataData,
  url: process.env.URL || metadataData.url || 'http://localhost:8080/'
};

const slugify = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const stripHtml = (value) =>
  String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const containsAny = (value, needles = []) =>
  needles.some((needle) => String(value || '').includes(String(needle || '')));

const titleCaseTerm = (value) =>
  String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const sortByLabel = (items = []) =>
  [...items].sort((a, b) => String(a?.label || '').localeCompare(String(b?.label || '')));

const firstName = (value) => String(value || '').trim().split(/\s+/)[0] || '';

const base64 = (value) => Buffer.from(String(value || ''), 'utf8').toString('base64');

const orcidUrl = (value) => {
  const orcid = String(value || '').trim();
  if (!orcid) return '';
  return /^https?:\/\//i.test(orcid) ? orcid : `https://orcid.org/${orcid}`;
};

const orcidId = (value) => String(value || '').trim().replace(/^https?:\/\/orcid\.org\//i, '');

const markExternalLinks = (value, base = metadata.url) =>
  String(value || '').replace(/<a\b([^>]*)href=(["'])([^"']+)\2([^>]*)>([\s\S]*?)<\/a>/gi, (match, before, quote, href, after, label) => {
    if (/^(#|\/|mailto:|tel:)/i.test(href)) return match;

    try {
      if (new URL(href, base).origin === new URL(base).origin) return match;
    } catch {
      return match;
    }

    const attrs = `${before}href=${quote}${href}${quote}${after}`;
    const withTarget = /\btarget=/i.test(attrs) ? attrs : `${attrs} target="_blank"`;
    const withRel = /\brel=/i.test(withTarget) ? withTarget : `${withTarget} rel="noopener noreferrer"`;
    const arrow = metadata.symbols?.external || '↗';
    return `<a${withRel}>${label} <span aria-hidden="true">${arrow}</span></a>`;
  });

const countTerms = (items, field) => {
  const counts = new Map();

  for (const item of items) {
    const value = item.data?.[field];
    const terms = Array.isArray(value) ? value : value ? [value] : [];

    for (const term of terms) {
      const name = String(term || '').trim();
      if (!name) continue;
      const slug = slugify(name);
      const current = counts.get(slug) || { name, slug, count: 0 };
      current.count += 1;
      counts.set(slug, current);
    }
  }

  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name));
};

const activeTeamOrder = ['Victor Taylor', 'Carl Raschke', 'Gary Bedford', 'Adam DJ Brett', 'Kev Grane'];
const alumniOrder = ['Dianna Able', 'Alyssa Putzer', 'Olesia Stockhold'];
const byConfiguredOrder = (order) => (a, b) => {
  const aIndex = order.indexOf(a.data.name);
  const bIndex = order.indexOf(b.data.name);
  if (aIndex !== -1 || bIndex !== -1) {
    return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
  }
  return String(a.data.name || '').localeCompare(String(b.data.name || ''));
};

export default async function (eleventyConfig) {
  eleventyConfig.setLibrary('md', md);
  eleventyConfig.addPassthroughCopy({ 'src/static': '/' });
  // Copy the Atom feed stylesheet to the path the feeds reference (/feed/…),
  // rather than letting it template-build to /content/feed/… (404 → blank feed).
  eleventyConfig.addPassthroughCopy({ 'src/content/feed/pretty-atom-feed.xsl': 'feed/pretty-atom-feed.xsl' });

  eleventyConfig.addPreprocessor('drafts', '*', (data) => {
    if (data.draft && process.env.ELEVENTY_RUN_MODE === 'build') return false;
  });

  eleventyConfig.addCollection('posts', (collectionApi) =>
    collectionApi
      .getFilteredByGlob('src/content/posts/**/*.md')
      .sort((a, b) => (a.date || 0) - (b.date || 0))
  );
  eleventyConfig.addCollection('postCategories', (collectionApi) =>
    countTerms(collectionApi.getFilteredByGlob('src/content/posts/**/*.md'), 'categories')
  );
  eleventyConfig.addCollection('postTags', (collectionApi) =>
    // "posts" is a collection-membership tag from posts.11tydata.js, not a content tag.
    countTerms(collectionApi.getFilteredByGlob('src/content/posts/**/*.md'), 'tags').filter((t) => t.slug !== 'posts')
  );
  eleventyConfig.addCollection('postAuthors', (collectionApi) =>
    countTerms(collectionApi.getFilteredByGlob('src/content/posts/**/*.md'), 'author')
  );
  eleventyConfig.addCollection('teamActive', (collectionApi) =>
    collectionApi.getFilteredByGlob('src/content/team/*.md').sort(byConfiguredOrder(activeTeamOrder))
  );
  eleventyConfig.addCollection('teamAlumni', (collectionApi) =>
    collectionApi.getFilteredByGlob('src/content/team/alumni/*.md').sort(byConfiguredOrder(alumniOrder))
  );
  eleventyConfig.addCollection('teamProfiles', (collectionApi) => [
    ...collectionApi.getFilteredByGlob('src/content/team/*.md').sort(byConfiguredOrder(activeTeamOrder)),
    ...collectionApi.getFilteredByGlob('src/content/team/alumni/*.md').sort(byConfiguredOrder(alumniOrder))
  ]);

  eleventyConfig.addDataExtension('yml,yaml', (contents) => yaml.load(contents));
  eleventyConfig.addFilter('slugify', slugify);
  eleventyConfig.addFilter('postsWithTerm', (posts, field, slug) =>
    (posts || []).filter((post) => {
      const value = post.data?.[field];
      const terms = Array.isArray(value) ? value : value ? [value] : [];
      return terms.some((term) => slugify(term) === slug);
    })
  );
  eleventyConfig.addFilter('md', (value) => md.render(String(value || '')));
  eleventyConfig.addFilter('markdownify', (value) => md.render(String(value || '')));
  eleventyConfig.addFilter('titleCaseTerm', titleCaseTerm);
  // Resolve a post's `author` key to its team profile, so bylines carry the person's real
  // name and link to /team/<slug>/. titleCaseTerm alone mangles names like "adam-dj-brett".
  eleventyConfig.addFilter('teamProfile', (profiles, authorKey) => {
    if (!profiles || !authorKey) return null;
    const key = slugify(authorKey);
    return profiles.find((profile) => slugify(profile.data?.name || profile.fileSlug) === key) || null;
  });
  eleventyConfig.addFilter('sortByLabel', sortByLabel);
  eleventyConfig.addFilter('firstName', firstName);
  eleventyConfig.addFilter('base64', base64);
  eleventyConfig.addFilter('orcidUrl', orcidUrl);
  eleventyConfig.addFilter('orcidId', orcidId);
  eleventyConfig.addFilter('lineBreaks', (value) =>
    String(value || '')
      .trim()
      .replace(/\s*\r?\n\s*/g, '<br>')
  );
  eleventyConfig.addFilter('stripHtml', stripHtml);
  eleventyConfig.addFilter('containsAny', containsAny);
  eleventyConfig.addFilter('markExternalLinks', markExternalLinks);
  eleventyConfig.addFilter('jsonLd', (value) =>
    JSON.stringify(value).replace(/</g, '\\u003c')
  );
  eleventyConfig.addFilter('truncate', (value, count = 150) => {
    const text = stripHtml(value);
    return text.length > count ? `${text.slice(0, count).trim()}...` : text;
  });
  eleventyConfig.addFilter('readableDate', (dateObj) =>
    dateObj
      ? new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(dateObj)
      : ''
  );
  eleventyConfig.addFilter('htmlDateString', (dateObj) =>
    dateObj ? dateObj.toISOString().slice(0, 10) : ''
  );
  eleventyConfig.addFilter('isoDate', (dateObj) => (dateObj ? dateObj.toISOString() : ''));
  eleventyConfig.addFilter('baseUrl', function (url) {
    const siteUrl = process.env.URL || this?.ctx?.metadata?.url || this?.context?.metadata?.url || metadata.url || 'http://localhost:8080/';
    if (!url || url === '/') return siteUrl.replace(/\/$/, '');
    const cleanBase = siteUrl.replace(/\/$/, '');
    return String(url).startsWith('/') ? `${cleanBase}${url}` : url;
  });
  eleventyConfig.addFilter('absUrl', (path, base = metadata.url) => {
    try {
      return new URL(path, base).toString();
    } catch {
      return path;
    }
  });
  eleventyConfig.addFilter('headTitle', (data = {}) => {
    const siteTitle = data.metadata?.title || metadata.title;
    const pageTitle = data.title || data.metadata?.tagline || metadata.tagline;
    return pageTitle === siteTitle ? siteTitle : `${pageTitle} | ${siteTitle}`;
  });
  eleventyConfig.addFilter('headDescription', (data = {}) =>
    data.description || data.metadata?.description || data.metadata?.tagline || metadata.description || metadata.tagline || ''
  );
  eleventyConfig.addFilter('headImage', (data = {}) =>
    data.image || data.metadata?.image || data.metadata?.seo?.ogImage?.url || metadata.image || metadata.seo?.ogImage?.url || '/images/whitestone-logo.webp'
  );
  eleventyConfig.addFilter('canonicalUrl', (data = {}) => {
    const base = process.env.URL || data.metadata?.url || metadata.url;
    // `canonical_url` front matter points syndicated posts back at the original publisher.
    const override = String(data.canonical_url || '').trim();
    if (override) return new URL(override, base).toString();
    return new URL(data.page?.url || '/', base).toString();
  });

  eleventyConfig.addShortcode('year', () => new Date().getFullYear());
  eleventyConfig.addPairedShortcode('logoContainer', (content) => `<div class="logo-container">${content}</div>`);
  eleventyConfig.addShortcode(
    'logoItem',
    (url, image, alt) => `<a class="logo-item" href="${url}"><img src="${image}" alt="${alt}" loading="lazy"></a>`
  );

  return {
    dir: {
      input: 'src',
      output: '_site',
      data: '_data',
      includes: '_includes'
    },
    htmlTemplateEngine: 'njk',
    markdownTemplateEngine: 'njk',
    templateFormats: ['html', 'njk', 'md', 'txt', 'xml']
  };
}

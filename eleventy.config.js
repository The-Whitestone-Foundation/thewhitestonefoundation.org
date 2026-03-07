import { EleventyRenderPlugin } from "@11ty/eleventy";
import pluginBundle from "@11ty/eleventy-plugin-bundle";
import pluginNavigation from "@11ty/eleventy-navigation";
import pluginSyntaxHighlight from "@11ty/eleventy-plugin-syntaxhighlight";
import markdownIt from "markdown-it";
import markdownItFootnote from "markdown-it-footnote";
import markdownItAnchor from "markdown-it-anchor";
import markdownItAttrs from "markdown-it-attrs";
import toc from "eleventy-plugin-toc";
import { DateTime } from "luxon";
import yaml from "js-yaml";
import { registerShortcodes } from "./utils/shortcodes.js";
import { registerFilters } from "./utils/filter.js";

export default function (eleventyConfig) {
  registerShortcodes(eleventyConfig);
  registerFilters(eleventyConfig);
  eleventyConfig.addPassthroughCopy({ "public": "/" });
  eleventyConfig.addPlugin(pluginBundle, {
    bundles: ["css", "js"]
  });
  const slugifyString = (str) =>
    String(str)
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w\-]+/g, "")
      .replace(/\-\-+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "");

  const mdLib = markdownIt({
    html: true,
    breaks: true,
    linkify: true,
    typographer: true
  })
  .use(markdownItFootnote)
  .use(markdownItAttrs)
  .use(markdownItAnchor, {
    slugify: slugifyString,
    permalink: markdownItAnchor.permalink.ariaHidden({
      placement: "after",
      class: "header-anchor",
      symbol: ""
    }),
    level: [2, 3, 4] 
  });

  eleventyConfig.setLibrary("md", mdLib);

  eleventyConfig.addCollection("posts", (collectionApi) => {
    return collectionApi.getFilteredByGlob("content/posts/**/*.md").sort((a, b) => {
      return (a.date || 0) - (b.date || 0);
    });
  });

  eleventyConfig.addCollection("higherEd", (collectionApi) => {
    return collectionApi.getFilteredByGlob("content/posts/**/*.md").filter((post) => {
      const categories = post.data?.categories || [];
      return categories.includes("higher-ed");
    });
  });

  eleventyConfig.addPlugin(toc, {
    tags: ['h2', 'h3', 'h4', 'h5'],
    wrapper: 'div',
    wrapperClass: 'list-group'
  });

  eleventyConfig.addPlugin(pluginSyntaxHighlight, { preAttributes: { tabindex: 0 } });
  eleventyConfig.addPlugin(pluginNavigation);

  eleventyConfig.addDataExtension("yaml", (contents) => yaml.load(contents));

  eleventyConfig.addFilter("getPrevPost", (collection, page) => {
    if (!collection || !page) return null;
    const index = collection.findIndex((item) => item.url === page.url);
    return index > 0 ? collection[index - 1] : null;
  });

  eleventyConfig.addFilter("getNextPost", (collection, page) => {
    if (!collection || !page) return null;
    const index = collection.findIndex((item) => item.url === page.url);
    return index >= 0 && index < collection.length - 1 ? collection[index + 1] : null;
  });

  eleventyConfig.addFilter("readableDate", (dateObj) => {
    if (!dateObj) return "";
    return DateTime.fromJSDate(dateObj).toFormat("LLLL d, yyyy");
  });

  eleventyConfig.addFilter("dateFilter", (dateObj, format) => {
    if (!dateObj) return "";
    return DateTime.fromJSDate(dateObj).toFormat(format);
  });

  eleventyConfig.addFilter("htmlDateString", (dateObj) => {
    if (!dateObj) return "";
    return DateTime.fromJSDate(dateObj).toFormat("yyyy-LL-dd");
  });

  eleventyConfig.addFilter("isoDate", (dateObj) => {
    if (!dateObj) return "";
    return DateTime.fromJSDate(dateObj).toISO();
  });

  eleventyConfig.addFilter("baseUrl", function(url) {
    const metadata = this.ctx.metadata || this.context.metadata;
    const siteUrl = metadata?.url || "http://localhost:8080";
    if (!url || url === "/") return siteUrl;
    const cleanBase = siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
    return url.startsWith("/") ? `${cleanBase}${url}` : url;
  });

  eleventyConfig.addFilter("absUrl", (path, base) => {
    try {
      return new URL(path, base).toString();
    } catch {
      return path;
    }
  });

  eleventyConfig.addFilter("stripHtml", (value) => {
    if (!value) return "";
    return value.toString().replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  });

  eleventyConfig.addFilter("firstWords", (value, count = 200) => {
    if (!value) return "";
    const words = value.toString().split(/\s+/).filter(Boolean);
    return words.slice(0, count).join(" ");
  });

  return {
    dir: {
      input: "content",
      includes: "../_includes",
      data: "../_data",
      output: "_site"
    },
    pathPrefix: "/"
  };
}
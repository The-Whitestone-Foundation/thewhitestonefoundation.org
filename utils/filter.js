import markdownIt from "markdown-it";

export function registerFilters(eleventyConfig) {
const md = markdownIt({
    html: true,
    breaks: true,
    linkify: true
  });
  
  eleventyConfig.addFilter("limit", (array, n) => {
    if (!Array.isArray(array)) return [];
    return array.slice(0, n);
  });
 
  eleventyConfig.addFilter("getKeys", (obj) => {
    return Object.keys(obj);
  });

  eleventyConfig.addFilter("filterTagList", (tags) => {
    const internalTags = ["all", "posts", "higherEd", "authors", "archivesIndex"];
    return (tags || []).filter(tag => !internalTags.includes(tag));
  });

  eleventyConfig.addFilter("getAllCategories", (collection) => {
    let categorySet = new Set();
    for (let item of collection) {
      (item.data.categories || []).forEach(cat => categorySet.add(cat));
    }
    return Array.from(categorySet).sort();
  });

  eleventyConfig.addCollection("authors", (collectionApi) => {
  return collectionApi.getFilteredByGlob("content/authors/*.md");
});

eleventyConfig.addFilter("isSameAuthor", (postAuthor, currentAuthor) => {
  if (!postAuthor || !currentAuthor) return false;
  return postAuthor.toLowerCase().trim() === currentAuthor.toLowerCase().trim();
});
  
  eleventyConfig.addFilter("md", (content) => {
    if (!content) return "";
    return md.render(content);
  });


}
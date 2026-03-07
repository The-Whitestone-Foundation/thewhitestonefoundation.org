export function registerShortcodes(eleventyConfig) {
  
  eleventyConfig.addPairedShortcode("logoContainer", (content) => {
    return `<div class="row mt-3 g-4 justify-content-center align-items-stretch">${content}</div>`;
  });

  
  eleventyConfig.addShortcode("logoItem", (url, img, label) => {
    if (!img) return ""; 

    return `
      <div class="col-6 col-md-3 d-flex">
        <a href="${url}" class="logo-card" target="_blank" rel="noopener">
          <div class="logo-box">
            <img src="${img}"  alt="${label}" loading="lazy">
          </div>
          <span class="logo-text">${label}</span>
        </a>
      </div>`.trim();
  });
}
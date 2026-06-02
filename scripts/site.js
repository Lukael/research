(function () {
  var owner = "Lukael";
  var repo = "research";
  var branch = "main";
  var grid = document.getElementById("report-grid");
  var status = document.getElementById("report-status");

  if (!grid) {
    return;
  }

  function textFrom(documentLike, selector) {
    var node = documentLike.querySelector(selector);
    return node ? node.textContent.trim() : "";
  }

  function attrFrom(documentLike, selector, attribute) {
    var node = documentLike.querySelector(selector);
    return node ? node.getAttribute(attribute) || "" : "";
  }

  function titleFromSlug(slug) {
    return slug
      .split("-")
      .filter(Boolean)
      .map(function (part) {
        return part.slice(0, 1).toUpperCase() + part.slice(1);
      })
      .join("-");
  }

  function sameOriginPath(path) {
    return new URL(path, window.location.href).toString();
  }

  function fetchText(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) {
        throw new Error("Unable to load " + url);
      }
      return response.text();
    });
  }

  function discoverFromGitHub() {
    var url = "https://api.github.com/repos/" + owner + "/" + repo + "/contents/projects?ref=" + branch;

    return fetch(url)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Unable to discover projects from GitHub");
        }
        return response.json();
      })
      .then(function (items) {
        return items
          .filter(function (item) {
            return item.type === "dir";
          })
          .map(function (item) {
            return item.name;
          });
      });
  }

  function discoverFromDirectoryListing() {
    return fetchText("projects/").then(function (html) {
      var parser = new DOMParser();
      var doc = parser.parseFromString(html, "text/html");

      return Array.from(doc.querySelectorAll("a"))
        .map(function (link) {
          return link.getAttribute("href") || "";
        })
        .filter(function (href) {
          return href && href !== "../" && href.slice(-1) === "/";
        })
        .map(function (href) {
          return href.replace(/\/$/, "");
        });
    });
  }

  function discoverProjects() {
    return discoverFromGitHub()
      .catch(discoverFromDirectoryListing)
      .then(function (slugs) {
        return Array.from(new Set(slugs)).sort();
      });
  }

  function thumbnailFor(slug, doc) {
    var thumbnail = "projects/" + slug + "/assets/thumbnail.png";
    var firstImage = attrFrom(doc, "img", "src");

    return {
      src: sameOriginPath(thumbnail),
      fallback: firstImage,
    };
  }

  function readProject(slug) {
    var path = "projects/" + slug + "/";

    return fetchText(path + "index.html")
      .then(function (html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, "text/html");
        var title = textFrom(doc, "h1") || textFrom(doc, "title") || titleFromSlug(slug);
        var description = attrFrom(doc, "meta[name='description']", "content") || textFrom(doc, ".subtitle") || "";
        var thumbnail = thumbnailFor(slug, doc);

        return {
          slug: slug,
          title: title,
          description: description,
          href: path,
          thumbnail: thumbnail,
        };
      });
  }

  function createCard(project) {
    var article = document.createElement("article");
    var image = document.createElement("img");
    var topline = document.createElement("div");
    var statusLabel = document.createElement("span");
    var slugLabel = document.createElement("span");
    var title = document.createElement("h3");
    var description = document.createElement("p");
    var link = document.createElement("a");

    article.className = "report-card";

    image.src = project.thumbnail.src;
    image.alt = project.title + " preview";
    image.loading = "lazy";
    image.onerror = function () {
      if (project.thumbnail.fallback && image.src !== project.thumbnail.fallback) {
        image.src = project.thumbnail.fallback;
      } else {
        image.remove();
      }
    };

    topline.className = "card-topline";
    statusLabel.className = "status status-complete";
    statusLabel.textContent = "Published";
    slugLabel.textContent = project.slug.toUpperCase();

    title.textContent = project.title;
    description.textContent = project.description;

    link.className = "card-link";
    link.href = project.href;
    link.textContent = "보고서 열기";

    topline.append(statusLabel, slugLabel);
    article.append(image, topline, title);

    if (project.description) {
      article.append(description);
    }

    article.append(link);

    return article;
  }

  function render(projects) {
    grid.innerHTML = "";

    if (!projects.length) {
      grid.innerHTML = '<p class="empty-state">아직 공개된 보고서가 없습니다.</p>';
      return;
    }

    projects.forEach(function (project) {
      grid.appendChild(createCard(project));
    });
  }

  discoverProjects()
    .then(function (slugs) {
      return Promise.all(slugs.map(readProject));
    })
    .then(render)
    .catch(function () {
      if (status) {
        status.textContent = "보고서를 불러오지 못했습니다.";
      }
    });
})();

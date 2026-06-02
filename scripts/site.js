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

  function titleFromSlug(slug) {
    return slug
      .split("-")
      .filter(Boolean)
      .map(function (part) {
        return part.slice(0, 1).toUpperCase() + part.slice(1);
      })
      .join("-");
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

  function commitUrlFor(slug) {
    var path = encodeURIComponent("projects/" + slug);

    return (
      "https://api.github.com/repos/" +
      owner +
      "/" +
      repo +
      "/commits?sha=" +
      branch +
      "&path=" +
      path +
      "&per_page=1"
    );
  }

  function readLastCommit(slug) {
    return fetch(commitUrlFor(slug))
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Unable to load commit metadata");
        }
        return response.json();
      })
      .then(function (items) {
        var commit = items && items[0];
        var date =
          commit &&
          commit.commit &&
          commit.commit.committer &&
          commit.commit.committer.date;

        return date
          ? {
              date: date,
              sha: commit.sha || "",
            }
          : null;
      })
      .catch(function () {
        return null;
      });
  }

  function formatCommitDate(value) {
    if (!value) {
      return "Unavailable";
    }

    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Seoul",
      timeZoneName: "short",
    }).format(new Date(value));
  }

  function readProject(slug) {
    var path = "projects/" + slug + "/";

    return Promise.all([fetchText(path + "index.html"), readLastCommit(slug)])
      .then(function (results) {
        var html = results[0];
        var lastCommit = results[1];
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, "text/html");
        var title = textFrom(doc, "h1") || textFrom(doc, "title") || titleFromSlug(slug);

        return {
          slug: slug,
          title: title,
          href: path,
          lastCommit: lastCommit,
        };
      });
  }

  function createCard(project) {
    var article = document.createElement("article");
    var topline = document.createElement("div");
    var statusLabel = document.createElement("span");
    var slugLabel = document.createElement("span");
    var title = document.createElement("h3");
    var commitMeta = document.createElement("p");
    var commitTime = document.createElement("time");
    var link = document.createElement("a");

    article.className = "report-card";

    topline.className = "card-topline";
    statusLabel.className = "status status-complete";
    statusLabel.textContent = "Published";
    slugLabel.textContent = project.slug.toUpperCase();

    title.textContent = project.title;
    commitMeta.className = "commit-meta";
    commitTime.textContent = formatCommitDate(project.lastCommit && project.lastCommit.date);

    if (project.lastCommit && project.lastCommit.date) {
      commitTime.dateTime = project.lastCommit.date;
    }

    link.className = "card-link";
    link.href = project.href;
    link.textContent = "Open report";

    commitMeta.append("Last commit ", commitTime);
    topline.append(statusLabel, slugLabel);
    article.append(topline, title, commitMeta, link);

    return article;
  }

  function render(projects) {
    grid.innerHTML = "";

    if (!projects.length) {
      grid.innerHTML = '<p class="empty-state">No project reports are available yet.</p>';
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
        status.textContent = "Unable to load project reports.";
      }
    });
})();

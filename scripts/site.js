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

  function linksFromDirectoryListing(html) {
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
  }

  function discoverFromDirectoryListing() {
    return fetchText("projects/").then(function (html) {
      return linksFromDirectoryListing(html);
    });
  }

  function discoverProjects() {
    return discoverFromGitHub()
      .catch(discoverFromDirectoryListing)
      .then(function (slugs) {
        return Array.from(new Set(slugs)).sort();
      });
  }

  function contentsUrlFor(path) {
    return (
      "https://api.github.com/repos/" +
      owner +
      "/" +
      repo +
      "/contents/" +
      path +
      "?ref=" +
      branch
    );
  }

  function commitUrlFor(path) {
    return (
      "https://api.github.com/repos/" +
      owner +
      "/" +
      repo +
      "/commits?sha=" +
      branch +
      "&path=" +
      encodeURIComponent(path) +
      "&per_page=1"
    );
  }

  function readLastCommitForPath(path) {
    return fetch(commitUrlFor(path))
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

  function discoverProjectReportsFromGitHub(slug) {
    return fetch(contentsUrlFor("projects/" + encodeURIComponent(slug) + "/reports"))
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Unable to discover project reports from GitHub");
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

  function discoverProjectReportsFromDirectoryListing(slug) {
    return fetchText("projects/" + slug + "/reports/")
      .then(linksFromDirectoryListing)
      .catch(function () {
        return [];
      });
  }

  function discoverProjectReports(slug) {
    return discoverProjectReportsFromGitHub(slug)
      .catch(function () {
        return discoverProjectReportsFromDirectoryListing(slug);
      })
      .then(function (reportSlugs) {
        return Array.from(new Set(reportSlugs)).sort();
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

  function readReport(slug, reportSlug, fallbackTitle) {
    var path = reportSlug ? "projects/" + slug + "/reports/" + reportSlug + "/" : "projects/" + slug + "/";
    var commitPath = reportSlug ? "projects/" + slug + "/reports/" + reportSlug : "projects/" + slug + "/report.enc";

    return Promise.all([fetchText(path + "index.html"), readLastCommitForPath(commitPath)])
      .then(function (results) {
        var html = results[0];
        var lastCommit = results[1];
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, "text/html");
        var title =
          textFrom(doc, "h1") ||
          textFrom(doc, "title") ||
          fallbackTitle ||
          titleFromSlug(reportSlug || slug);

        return {
          reportSlug: reportSlug || "main",
          title: title,
          href: path + "index.html",
          lastCommit: lastCommit,
        };
      });
  }

  function latestCommit(reports) {
    return reports.reduce(function (latest, report) {
      var parsedTimestamp = latest && latest.date ? Date.parse(latest.date) : 0;
      var latestTimestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0;

      if (!latest || commitTimestamp(report) > latestTimestamp) {
        return report.lastCommit;
      }

      return latest;
    }, null);
  }

  function readProject(slug) {
    return Promise.all([readReport(slug, "", titleFromSlug(slug)), discoverProjectReports(slug)])
      .then(function (results) {
        var mainReport = results[0];
        var reportSlugs = results[1];

        return Promise.all(
          reportSlugs.map(function (reportSlug) {
            return readReport(slug, reportSlug, titleFromSlug(reportSlug));
          })
        ).then(function (extraReports) {
          var reports = sortByLastCommit([mainReport].concat(extraReports));

          return {
            slug: slug,
            title: mainReport.title,
            href: mainReport.href,
            reports: reports,
            lastCommit: latestCommit(reports),
          };
        });
      });
  }

  function commitTimestamp(item) {
    var date = item.lastCommit && item.lastCommit.date;
    var timestamp = date ? Date.parse(date) : 0;

    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function sortByLastCommit(projects) {
    return projects.slice().sort(function (left, right) {
      var dateDelta = commitTimestamp(right) - commitTimestamp(left);

      if (dateDelta) {
        return dateDelta;
      }

      return left.slug.localeCompare(right.slug);
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
    var reportList = document.createElement("div");

    article.className = "report-card";

    topline.className = "card-topline";
    statusLabel.className = "status status-complete";
    statusLabel.textContent = project.reports.length === 1 ? "1 report" : project.reports.length + " reports";
    slugLabel.textContent = project.slug.toUpperCase();

    title.textContent = project.title;
    commitMeta.className = "commit-meta";
    commitTime.textContent = formatCommitDate(project.lastCommit && project.lastCommit.date);

    if (project.lastCommit && project.lastCommit.date) {
      commitTime.dateTime = project.lastCommit.date;
    }

    reportList.className = "report-list";
    reportList.setAttribute("aria-label", project.title + " reports");

    project.reports.forEach(function (report) {
      var row = document.createElement("a");
      var reportTitle = document.createElement("span");
      var reportDate = document.createElement("time");

      row.className = "report-row";
      row.href = report.href;
      reportTitle.className = "report-link-title";
      reportTitle.textContent = report.title;
      reportDate.className = "report-link-date";
      reportDate.textContent = formatCommitDate(report.lastCommit && report.lastCommit.date);

      if (report.lastCommit && report.lastCommit.date) {
        reportDate.dateTime = report.lastCommit.date;
      }

      row.append(reportTitle, reportDate);
      reportList.appendChild(row);
    });

    commitMeta.append("Last commit ", commitTime);
    topline.append(statusLabel, slugLabel);
    article.append(topline, title, commitMeta, reportList);

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
    .then(sortByLastCommit)
    .then(render)
    .catch(function () {
      if (status) {
        status.textContent = "Unable to load project reports.";
      }
    });
})();

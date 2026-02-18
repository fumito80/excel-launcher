const uriBase = "http://localhost:8080";

const [$excels, $unfiltered] = document.getElementsByClassName("excels");
const [$folders] = document.getElementsByClassName("folders");
const [$past] = document.getElementsByClassName("past");
const [$filter] = document.getElementsByClassName("filter");

function filter(e) {
  const { value } = e.target;
  if (!value) {
    $excels.append(...$unfiltered.children);
    sort($excels);
    localStorage.setItem("filter", "");
    return;
  }
  const $allRows = Array.from($excels.children).concat(...$unfiltered.children);
  $allRows.forEach(($row) => {
    const $parent = $row.firstElementChild.textContent.toUpperCase().includes(value.toUpperCase()) ? $excels : $unfiltered;
    $parent.append($row);
  });
  sort($excels);
  sort($unfiltered);
  localStorage.setItem("filter", value);
}


function createElement(tagName, { ...props } = {}) {
  return Object.assign(document.createElement(tagName), { ...props });
}

function addChildren($parent, ...$children) {
  $parent.append(...$children);
  return $parent;
}

function setActivate(fullpath, dt = "", activatesIn = undefined) {
  const activates = activatesIn ?? JSON.parse(localStorage.getItem("activates") || "{}");
  localStorage.setItem("activates", JSON.stringify({ ...activates, [fullpath]: dt }));
}

function makeItemRow($parent, activates) {
  return (item) => {
    const $nameLink = createElement("a", {
      href: "javascript:void(0)",
      textContent: item.name,
      className: "fullpath",
    });
    const fullpath = `${item.path.replace("\\\\", "\\")}\\${item.name}`;
    $nameLink.setAttribute("data-hwnd", item.hwnd);
    $nameLink.setAttribute("data-path", fullpath);
    const $name = addChildren(createElement("td"), $nameLink);
    const [, path, parentFolder] = /^(.*\\)(.*)$/.exec(item.path) ?? ["", ""];
    const $parentFolder = createElement("a", {
      textContent: parentFolder,
      href: "javascript:void(0)",
      className: "parent-path",
    });
    $parentFolder.setAttribute("data-path", item.path);
    const $path = addChildren(createElement("td", { textContent: path, className: "path" }), $parentFolder);
    const dtSerial = activates[fullpath] ?? "";
    let textContent = "";
    let title = "";
    if (dtSerial) {
      const dt = new Date(dtSerial);
      textContent =
        dt.toLocaleDateString() === new Date().toLocaleDateString()
          ? dt.toLocaleTimeString()
          : dt.toLocaleDateString();
      title = dt.toLocaleString();
    }
    const $activate = createElement("td", {
      textContent,
      title,
      className: "activate",
    });
    $activate.setAttribute("data-dt", dtSerial);
    const $del = addChildren(createElement("td"), createElement("a", { textContent: "×", className: "del-activate" }));
    const $row = createElement("tr");
    $row.append($name, $path, $activate, $del);
    $parent.append($row);
    return { fullpath, dtSerial };
  };
}

function sort($parent) {
  const elements = $parent.children;
  if (!elements.length) {
    return;
  }
  Array.from($parent.children)
    .toSorted((trA, trB) => {
      const [nameA, pathA, dtA] = [...trA.children];
      const [nameB, pathB, dtB] = [...trB.children];
      if (dtB.dataset.dt === dtA.dataset.dt) {
        return pathA.firstElementChild.dataset.path === pathB.firstElementChild.dataset.path
          ? nameA.textContent.localeCompare(nameB.textContent)
          : pathA.firstElementChild.dataset.path.localeCompare(pathB.firstElementChild.dataset.path);
      }
      return (dtB.dataset.dt || 0) - (dtA.dataset.dt || 0);
    })
    .forEach((el) => {
      $parent.append(el);
    });
}

function setList(responseJson = {}) {
  const activates = JSON.parse(localStorage.getItem("activates") || "{}");
  const excels = responseJson.excels?.map(makeItemRow($excels, activates));
  sort($excels);
  const folders = responseJson.folders?.map(makeItemRow($folders, activates));
  sort($folders);
  const newItems = excels.concat(folders)
    .filter(({ dtSerial }) => !dtSerial)
    .reduce((acc, el) => Object.assign(acc, { [el.fullpath]: "" }), {});
  localStorage.setItem("activates", JSON.stringify({ ...activates, ...newItems }));
  return { activates, responseJson };
}

function setFilter({ activates, responseJson }) {
  const filter = localStorage.getItem("filter");
  $filter.value = filter;
  $filter.dispatchEvent(new Event("input"));
  if (filter) {
    document.forms[0].requestSubmit();
  }
  return { activates, responseJson };
}

function setPast({ activates, responseJson }) {
  Object.keys(activates)
    .filter(
      (targetPath) =>
        !responseJson.excels.concat(responseJson.folders).find((item) => {
          const fullpath = `${item.path.replace("\\\\", "\\")}\\${item.name}`;
          return fullpath === targetPath;
        }),
    )
    .map((targetPath) => {
      const [, path, name] = /^(.*)\\(.*)$/.exec(targetPath);
      return { name, path };
    })
    .forEach(makeItemRow($past, activates));
  sort($past);
}

function clickItem($target) {
  if (!($target instanceof HTMLAnchorElement)) {
    return;
  }
  const $parent = $target.closest("tr");
  if ($target.classList.contains("del-activate")) {
    const [$name] = $parent.getElementsByClassName("fullpath");
    const fullpath = $name.dataset.path;
    const { [fullpath]: _, ...activates } = JSON.parse(localStorage.getItem("activates") || "{}");
    if ($target.closest(".past")) {
      localStorage.setItem("activates", JSON.stringify({ ...activates }));
      $parent.remove();
      return;
    }
    setActivate(fullpath, "", activates);
    const [$activate] = $parent.getElementsByClassName("activate");
    $activate.removeAttribute("data-dt");
    $activate.textContent = "";
    sort($target.closest(".parent"));
    return;
  }
  const isPastItem = $target.closest(".past");
  const isFullpath = $target.classList.contains("fullpath");
  const { hwnd = "", path } = $target.dataset;
  const uri = `${uriBase}/activate?hwnd=${hwnd}&path=${encodeURIComponent(path)}`;
  fetch(uri)
    .then((res) => {
      if (!res.ok) {
        throw new Error("サーバーエラー");
      }
      return res.json();
    })
    .then((json) => {
      if (!json.success) {
        alert(`Path or File Not Found: ${path}`);
        return;
      }
      if (!isFullpath) {
        if (!json.hwnd) {
          document.location.reload();
        }
        return;
      }
      const hwnd = json.hwnd;
      $target.setAttribute("data-hwnd", hwnd ?? "");
      const dt = Date.now();
      setActivate($target.dataset.path, dt);
      if (isPastItem) {
        document.location.reload();
        return;
      }
      const [$activate] = $parent.getElementsByClassName("activate");
      $activate.setAttribute("data-dt", dt);
      $activate.textContent = new Date(dt).toLocaleTimeString();
      $activate.title = new Date(dt).toLocaleString();
      sort($target.closest(".parent"));

    })
    .catch(() => { });
  const filter = localStorage.getItem("filter");
  if (filter) {
    document.forms[0].requestSubmit();
  }
}

fetch(`${uriBase}/list`)
  .then((res) => {
    if (!res.ok) {
      throw new Error("サーバーエラー");
    }
    return res.json();
  })
  .then(setList)
  .then(setFilter)
  .then(setPast);

document.addEventListener("click", (e) => clickItem(e.target));

$filter.addEventListener("input", filter);

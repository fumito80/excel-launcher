const uriBase = "http://localhost:8080";

const [$excels, $unfiltered] = document.getElementsByClassName("excels");
const [$folders] = document.getElementsByClassName("folders");
const [$past] = document.getElementsByClassName("past");
const [$filter] = document.getElementsByClassName("filter");

function filter() {
  const { length } = getComputedStyle($excels).gridTemplateColumns.split(" ");
  const cols = Array.from({ length });
  return (e) => {
    const { value } = e.target;
    if (!value) {
      $excels.append(...$unfiltered.children);
      sort($excels);
      localStorage.setItem("filter", "");
      return;
    }
    const $all = Array.from($excels.children).concat(...$unfiltered.children);
    Array.from({ length: $all.length / length }).forEach((_, i) => {
      const $excel = $all[i * length];
      const $parent = $excel.textContent.toUpperCase().includes(value.toUpperCase()) ? $excels : $unfiltered;
      $parent.append(...cols.map((_, j) => $all[i * length + j]));
    });
    sort($excels);
    sort($unfiltered);
    localStorage.setItem("filter", value);
  }
}

function createElement(tagName, { ...props } = {}) {
  return Object.assign(document.createElement(tagName), { ...props });
}

function setActivate(fullpath, dt = "", activatesIn = undefined) {
  const activates = activatesIn ?? JSON.parse(localStorage.getItem("activates") || "{}");
  localStorage.setItem("activates", JSON.stringify({ ...activates, [fullpath]: dt }));
}

function makeItemRow($parent, activates) {
  return (item) => {
    const $name = createElement("a", {
      href: "javascript:void(0)",
      textContent: item.name,
      className: "fullpath",
    });
    $name.setAttribute("data-hwnd", item.hwnd);
    const fullpath = `${item.path.replace("\\\\", "\\")}\\${item.name}`;
    $name.setAttribute("data-path", fullpath);
    const [, path, parentFolder] = /^(.*\\)(.*)$/.exec(item.path) ?? ["", ""];
    const $path = createElement("div", { textContent: path, className: "path" });
    const $parentFolder = createElement("a", {
      textContent: parentFolder,
      href: "javascript:void(0)",
      className: "parent-path",
    });
    $parentFolder.setAttribute("data-path", item.path);
    $path.append($parentFolder);
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
    const $activate = createElement("div", {
      textContent,
      title,
      className: "activate",
    });
    $activate.setAttribute("data-dt", dtSerial);
    $parent.append($name, $path, $activate, createElement("a", { textContent: "×", className: "del-activate" }));
    return { fullpath, dtSerial };
  };
}

function sort($parent) {
  const elements = $parent.children;
  if (!elements.length) {
    return;
  }
  const { length } = getComputedStyle($parent).gridTemplateColumns.split(" ");
  Array.from({ length: elements.length / length })
    .map((_, i) => Array.from({ length }).map((_, j) => elements[i * length + j]))
    .toSorted(([nameA, pathA, dtA], [nameB, pathB, dtB]) => {
      if (dtB.dataset.dt === dtA.dataset.dt) {
        return pathA.firstElementChild.dataset.path === pathB.firstElementChild.dataset.path
          ? nameA.textContent.localeCompare(nameB.textContent)
          : pathA.firstElementChild.dataset.path.localeCompare(pathB.firstElementChild.dataset.path);
      }
      return (dtB.dataset.dt || 0) - (dtA.dataset.dt || 0);
    })
    .forEach((el) => {
      $parent.append(...el);
    });
}

function setList(responseJson = {}) {
  const activates = JSON.parse(localStorage.getItem("activates") || "{}");
  const excels = responseJson.excels?.map(makeItemRow($excels, activates));
  sort($excels);
  const folders = responseJson.folders?.map(makeItemRow($folders, activates));
  sort($folders);
  const newItems = excels.concat(folders)
    .filter(({ dtSerial }) => !(Boolean(dtSerial)))
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
  if ($target.classList.contains("del-activate")) {
    const cols = getComputedStyle($past).gridTemplateColumns.split(" ").length;
    const [$head, ...$rest] = Array.from({ length: cols - 1 }).reduce(([$prev, ...rest]) => [$prev.previousElementSibling, $prev, ...rest], [$target]);
    const fullpath = $head.dataset.path;
    const { [fullpath]: _, ...activates } = JSON.parse(localStorage.getItem("activates") || "{}");
    if ($target.closest(".past")) {
      localStorage.setItem("activates", JSON.stringify({ ...activates }));
      [$head, ...$rest].forEach(($el) => {
        $el.remove();
      });
      return;
    }
    setActivate(fullpath, "", activates);
    $target.previousElementSibling.removeAttribute("data-dt");
    $target.previousElementSibling.textContent = "";
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
      const $activate = $target.nextElementSibling.nextElementSibling;
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

$filter.addEventListener("input", filter());

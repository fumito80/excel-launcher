const uri = "http://localhost:8080";

const [$excels] = document.getElementsByClassName("excels");
const [$folders] = document.getElementsByClassName("folders");

function createElement(tagName, { ...props } = {}) {
	return Object.assign(document.createElement(tagName), { ...props });
}

function makeItemRow($parent) {
	return (item) => {
		const href = item.path.replace("\\\\", "\\");
		const $name = createElement("a", {
			textContent: item.name,
			className: "excel-name",
			href,
		});
		$name.setAttribute("data-hwnd", item.hwnd);
		const $path = createElement("div", {
			textContent: href.replace(item.name, "").replace(/\\$/, ""),
			className: "excel-path",
		});
		$parent.append($name, $path);
	};
}

function sortRegular(a, b) {
	return a.path === b.path
		? -a.name.localeCompare(b.name)
		: -a.path.localeCompare(b.path);
}

function setList(json = {}) {
	json.excels?.toSorted(sortRegular).forEach(makeItemRow($excels));
	json.folders?.toSorted(sortRegular).forEach(makeItemRow($folders));
}

fetch(`${uri}/list`)
	.then((res) => {
		if (!res.ok) {
			throw new Error("サーバーエラー");
		}
		return res.json();
	})
	.then(setList);

document.addEventListener("click", (e) => {
	if (!(e.target instanceof HTMLAnchorElement)) {
		return;
	}
	fetch(`${uri}/activate/${e.target.dataset.hwnd}`);
});

// window.addEventListener("focus", () => {
// 	window.location.reload();
// });

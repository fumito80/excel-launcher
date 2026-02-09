const uriBase = "http://localhost:8080";

const [$excels] = document.getElementsByClassName("excels");
const [$folders] = document.getElementsByClassName("folders");

function createElement(tagName, { ...props } = {}) {
	return Object.assign(document.createElement(tagName), { ...props });
}

function makeItemRow($parent, activates) {
	return (item) => {
		const $name = createElement("a", {
			href: "javascript:void(0)",
			textContent: item.name,
			className: activates ? "excel-name" : "folder-name",
		});
		$name.setAttribute("data-hwnd", item.hwnd);
		const fullPath = `${item.path.replace("\\\\", "\\")}\\${item.name}`;
		$name.setAttribute("data-path", fullPath);
		const [, path, parentFolder] = /^(.*\\)(.*)$/.exec(item.path);
		const $path = createElement("div", { textContent: path });
		const $parentFolder = createElement("a", {
			textContent: parentFolder,
			href: "javascript:void(0)",
			className: "excel-folder",
		});
		$path.append($parentFolder);
		if (!activates) {
			$parent.append($name, $path);
			return;
		}
		const dtSerial = activates[fullPath] ?? "";
		let textContent = "";
		if (dtSerial) {
			const dt = new Date(dtSerial);
			textContent =
				dt.toLocaleDateString() === new Date().toLocaleDateString()
					? dt.toLocaleTimeString()
					: dt.toLocaleDateString();
		}
		const $activate = createElement("div", {
			textContent,
			className: "activate",
		});
		$activate.setAttribute("data-dt", dtSerial);
		$parent.append($name, $path, $activate);
	};
}

function sort($excels) {
	const elements = $excels.children;
	if (!elements.length) {
		return;
	}
	Array.from({ length: elements.length / 3 })
		.map((_, i) => [elements[i * 3], elements[i * 3 + 1], elements[i * 3 + 2]])
		.toSorted(([, , a], [, , b]) => b.dataset.dt - a.dataset.dt)
		.forEach((el) => {
			$excels.append(...el);
		});
}

function sortRegular(a, b) {
	return a.path === b.path
		? -a.name.localeCompare(b.name)
		: -a.path.localeCompare(b.path);
}

function setList(json = {}) {
	const activates = JSON.parse(localStorage.getItem("activates") || "{}");
	json.excels?.forEach(makeItemRow($excels, activates));
	sort($excels);
	json.folders?.toSorted(sortRegular).forEach(makeItemRow($folders));
}

fetch(`${uriBase}/list`)
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
	let uri;
	if (e.target.classList.contains("excel-folder")) {
		uri = `${uriBase}/activate-path/${e.target.parentElement.previousElementSibling.dataset.path}`;
	} else {
		uri = `${uriBase}/activate-hwnd/${e.target.dataset.hwnd}`;
		if (e.target.classList.contains("excel-name")) {
			const activates = JSON.parse(localStorage.getItem("activates") || "{}");
			const dt = Date.now();
			localStorage.setItem(
				"activates",
				JSON.stringify({ ...activates, [e.target.dataset.path]: dt }),
			);
			const $activate = e.target.nextElementSibling.nextElementSibling;
			$activate.setAttribute("data-dt", dt);
			$activate.textContent = new Date(dt).toLocaleTimeString();
			sort($excels);
		}
	}
	fetch(uri);
});

// window.addEventListener("focus", () => {
// 	window.location.reload();
// });

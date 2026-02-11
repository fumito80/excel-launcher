const uriBase = "http://localhost:8080";

const [$excels] = document.getElementsByClassName("excels");
const [$folders] = document.getElementsByClassName("folders");
const [$past] = document.getElementsByClassName("past");

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
		const [, path, parentFolder] = /^(.*\\)(.*)$/.exec(item.path) ?? ["", ""];
		const $path = createElement("div", { textContent: path });
		const $parentFolder = createElement("a", {
			textContent: parentFolder,
			href: "javascript:void(0)",
			className: "excel-folder",
		});
		$parentFolder.setAttribute("data-path", item.path);
		$path.append($parentFolder);
		if (!activates) {
			$parent.append($name, $path);
			return;
		}
		const dtSerial = activates[fullPath] ?? "";
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

function setList(responseJson = {}) {
	const activates = JSON.parse(localStorage.getItem("activates") || "{}");
	responseJson.excels?.toSorted(sortRegular).forEach(makeItemRow($excels, activates));
	sort($excels);
	responseJson.folders?.toSorted(sortRegular).forEach(makeItemRow($folders));
	return { activates, responseJson };
}

function setPast({ activates, responseJson }) {
	Object.keys(activates)
		.filter(
			(excelPath) =>
				!responseJson.excels.find((item) => {
					const fullPath = `${item.path.replace("\\\\", "\\")}\\${item.name}`;
					return fullPath === excelPath;
				}),
		)
		.map((excelPath) => {
			const [, path, name] = /^(.*)\\(.*)$/.exec(excelPath);
			return { name, path };
		})
		.forEach(makeItemRow($past, activates));
	sort($past);
}

function clickItem($target) {
	if (!($target instanceof HTMLAnchorElement)) {
		return;
	}
	const isPastItem = $target.closest(".past");
	const isExcelItem = $target.classList.contains("excel-name");
	const { hwnd = "", path } = $target.dataset;
	const uri = `${uriBase}/activate?hwnd=${hwnd}&path=${encodeURIComponent(path)}`;
	if (isExcelItem) {
		const activates = JSON.parse(localStorage.getItem("activates") || "{}");
		const dt = Date.now();
		localStorage.setItem(
			"activates",
			JSON.stringify({ ...activates, [$target.dataset.path]: dt }),
		);
		const $activate = $target.nextElementSibling.nextElementSibling;
		$activate.setAttribute("data-dt", dt);
		$activate.textContent = new Date(dt).toLocaleTimeString();
		$activate.title = new Date(dt).toLocaleString();
		if (!isPastItem) {
			sort($excels);
		}
	}
	fetch(uri)
		.then((res) => {
			if (!res.ok) {
				throw new Error("サーバーエラー");
			}
			return res.json();
		})
		.then((json) => {
			const hwnd = json?.hwnd;
			$target.setAttribute("data-hwnd", hwnd === -1 ? "" : hwnd);
			if (isPastItem && isExcelItem) {
				const rowItems = [
					$target,
					$target.nextElementSibling,
					$target.nextElementSibling.nextElementSibling,
				];
				$excels.prepend(...rowItems);
			}
		})
		.catch(() => {});
}

fetch(`${uriBase}/list`)
	.then((res) => {
		if (!res.ok) {
			throw new Error("サーバーエラー");
		}
		return res.json();
	})
	.then(setList)
	.then(setPast);

document.addEventListener("click", (e) => clickItem(e.target));

const uri = "http://localhost:8080";

const [$excels] = document.getElementsByClassName("excels");
const [$folders] = document.getElementsByClassName("folders");

function createElement(tagName, { ...props } = {}) {
	return Object.assign(document.createElement(tagName), { ...props });
}

function setList(json = {}) {
	json.excel?.forEach((book) => {
		const href = book.path.replace("\\\\", "\\");
		const $name = createElement("a", {
			textContent: book.name,
			className: "excel-name",
			href,
		});
		const $path = createElement("div", {
			textContent: href.replace(book.name, "").replace(/\\$/, ""),
			className: "excel-path",
		});
		$excels.append($name, $path);
	});
	json.folders?.forEach((folder) => {
		const href = folder.path.replace("\\\\", "\\");
		const $name = createElement("a", {
			textContent: folder.name,
			className: "folder-name",
			href,
		});
		const $path = createElement("div", {
			textContent: href.replace(folder.name, "").replace(/\\$/, ""),
			className: "folder-path",
		});
		$folders.append($name, $path);
	});
}

fetch(`${uri}/get-list`)
	.then((res) => {
		if (!res.ok) {
			throw new Error("サーバーエラー");
		}
		return res.json();
	})
	.then(setList);

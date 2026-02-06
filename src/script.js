function sendNativeMessage(msg, callback) {
  chrome.runtime.sendNativeMessage("excel.switcher", msg, callback);
}

function refresh() {
  sendNativeMessage({ action: "list" }, (response) => {
    const list = document.getElementById("list");
    list.innerHTML = "";

    response.windows.forEach(w => {
      const btn = document.createElement("button");
      btn.textContent = w.title;
      btn.onclick = () => {
        sendNativeMessage({ action: "activate", hwnd: w.hwnd });
      };
      list.appendChild(btn);
      list.appendChild(document.createElement("br"));
    });
  });
}

setInterval(refresh, 2000);
refresh();

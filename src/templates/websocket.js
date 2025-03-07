(async (hard) => {
	const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
	const addr = `${wsProtocol}//${location.host}/live-server-ws`;
	const sleep = (x) => new Promise((r) => setTimeout(r, x));
	const preload = async (url, requireSuccess) => {
		const resp = await fetch(url, { cache: "reload" }); // reset cache
		if (requireSuccess && (!resp.ok || resp.status !== 200)) {
			throw new Error();
		}
	};
	/** Reset cache in link.href and strip scripts */
	const preloadNode = (n, ps) => {
		if (n.tagName === "SCRIPT" && n.src) {
			ps.push(preload(n.src, false));
			return;
		}
		if (n.tagName === "LINK" && n.href) {
			ps.push(preload(n.href, false));
			return;
		}
		let c = n.firstChild;
		while (c) {
			const nc = c.nextSibling;
			preloadNode(c, ps);
			c = nc;
		}
	};

	const saveScrollPosition = () => {
		sessionStorage.setItem("scrollX", window.scrollX);
		sessionStorage.setItem("scrollY", window.scrollY);
		// Also save for elements with scrollbars
		document.querySelectorAll("[data-preserve-scroll]").forEach((el, index) => {
			sessionStorage.setItem(`element-scroll-${index}-x`, el.scrollLeft);
			sessionStorage.setItem(`element-scroll-${index}-y`, el.scrollTop);
			sessionStorage.setItem(`element-scroll-${index}-id`, el.id || "");
			sessionStorage.setItem(`element-scroll-${index}-selector`, generateUniqueSelector(el));
		});
	};

	// Helper function to generate a reasonably unique selector for an element
	const generateUniqueSelector = (el) => {
		if (el.id) return `#${el.id}`;

		let path = [];
		let parent = el;

		while (parent) {
			if (parent === document.body) {
				path.unshift("body");
				break;
			}

			let selector = parent.tagName.toLowerCase();

			if (parent.className) {
				const classes = Array.from(parent.classList).join(".");
				if (classes) selector += `.${classes}`;
			}

			let sibling = parent;
			let nth = 1;

			while ((sibling = sibling.previousElementSibling)) {
				if (sibling.tagName === parent.tagName) nth++;
			}

			if (nth > 1) selector += `:nth-of-type(${nth})`;

			path.unshift(selector);

			if (parent.id) {
				path.unshift(`#${parent.id}`);
				break;
			}

			parent = parent.parentElement;
		}

		return path.join(" > ");
	};

	// Restore scroll position functionality
	const restoreScrollPosition = () => {
		const scrollX = sessionStorage.getItem("scrollX");
		const scrollY = sessionStorage.getItem("scrollY");

		if (scrollX !== null && scrollY !== null) {
			window.scrollTo(+scrollX, +scrollY);
		}

		// Also restore for elements with scrollbars
		let index = 0;
		while (true) {
			const x = sessionStorage.getItem(`element-scroll-${index}-x`);
			const y = sessionStorage.getItem(`element-scroll-${index}-y`);
			const id = sessionStorage.getItem(`element-scroll-${index}-id`);
			const selector = sessionStorage.getItem(`element-scroll-${index}-selector`);

			if (x === null || y === null) break;

			// Try to find the element
			let el = null;
			if (id) el = document.getElementById(id);
			if (!el && selector) el = document.querySelector(selector);

			if (el) {
				el.scrollLeft = +x;
				el.scrollTop = +y;
			}

			index++;
		}
	};

	let reloading = false; // if the page is currently being reloaded
	let scheduled = false; // if another reload is scheduled while the page is being reloaded

	async function reload() {
		// schedule the reload for later if it's already reloading
		if (reloading) {
			scheduled = true;
			return;
		}

		// Save scroll position before reloading
		saveScrollPosition();

		let ifr;
		reloading = true;
		while (true) {
			scheduled = false;
			const url = location.origin + location.pathname;
			const promises = [];
			preloadNode(document.head, promises);
			preloadNode(document.body, promises);
			await Promise.allSettled(promises);
			try {
				await new Promise((resolve) => {
					ifr = document.createElement("iframe");
					ifr.src = `${url}?reload`;
					ifr.style.display = "none";
					ifr.onload = resolve;
					document.body.appendChild(ifr);
				});
			} catch {}
			// reload only if the iframe loaded successfully
			// with the reload payload. If the reload payload
			// is absent, it probably means the server responded
			// with a 404 page
			const meta = ifr.contentDocument.head.querySelector('meta[name="live-server"]');
			if (
				meta &&
				meta.tagName === "META" &&
				meta.name === "live-server" &&
				meta.content === "reload"
			) {
				// do reload if there's no further scheduled reload
				// otherwise, let the next scheduled reload do the job
				if (!scheduled) {
					if (hard) {
						location.reload();
					} else {
						reloading = false;
						document.head.replaceWith(ifr.contentDocument.head);
						document.body.replaceWith(ifr.contentDocument.body);
						ifr.remove();
						console.log("[Live Server] Reloaded");

						// Restore scroll position after reloading
						setTimeout(restoreScrollPosition, 0);
					}
					return;
				}
			}
			if (ifr) {
				ifr.remove();
			}
			// wait for some time before trying again
			await sleep(500);
		}
	}

	let connectedInterrupted = false; // track if it's the first connection or a reconnection
	while (true) {
		try {
			await new Promise((resolve) => {
				const ws = new WebSocket(addr);
				ws.onopen = () => {
					console.log("[Live Server] Connection Established");
					// on reconnection, refresh the page
					if (connectedInterrupted) {
						reload();
					}
				};
				ws.onmessage = reload;
				ws.onerror = () => ws.close();
				ws.onclose = resolve;
			});
		} catch {}
		connectedInterrupted = true;
		await sleep(3000);
		console.log("[Live Server] Reconnecting...");
	}
})();

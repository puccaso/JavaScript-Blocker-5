"use strict";

if (!window.safari)
	throw new Error('preventing execution.');

if (typeof document.hidden === 'undefined')
	document.hidden = false;

if (!window.CustomEvent)
	(function () {
		function CustomEvent (event, params) {
			params = params || { bubbles: false, cancelable: false, detail: undefined };
			var evt = document.createEvent('CustomEvent');
			evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail);
			return evt;
		};

		window.CustomEvent = CustomEvent;
	})();

if (!window.MutationObserver)
	window.MutationObserver = window.WebKitMutationObserver;

var TOKEN = {
	PAGE: Utilities.Token.create('Page'),
	EVENT: Utilities.id(),
	BLOCKED_ELEMENTS: []
};

var BLOCKABLE = {
	SCRIPT: ['script'],
	FRAME: ['frame', true],
	IFRAME: ['frame', true],
	EMBED: ['embed', true],
	OBJECT: ['embed', true],
	VIDEO: ['video', true],
	IMG: ['image', true],
	AJAX_POST: ['ajax_post'],
	AJAX_PUT: ['ajax_put'],
	AJAX_GET: ['ajax_get']
};

var	broken = false;

var Page = {
	send: (function () {
		var timeout;

		return function sendPage () {
			clearTimeout(timeout);

			timeout = setTimeout(function () {
				try {
					if (!document.hidden)
						GlobalPage.message('receivePage', Page.info);
				} catch(error) {
					if (!broken) {
						broken = true;

						console.error('JavaScript Blocker broke due to a Safari bug. Reloading the page should fix things.', error.message);
					}
				}
			}, 100);
		};
	})(),

	info: {
		id: TOKEN.PAGE,
		state: new Store(TOKEN.PAGE),
		location: Utilities.Page.getCurrentLocation(),
		host: Utilities.Page.isAbout ? document.location.href.substr(document.location.protocol.length) : (document.location.host || 'blank'),
		protocol: document.location.protocol,
		isFrame: !Utilities.Page.isTop
	}
};

Page.allowed = Page.info.state.getStore('allowed'),
Page.blocked = Page.info.state.getStore('blocked'),
Page.unblocked = Page.info.state.getStore('unblocked');

var globalSetting = GlobalCommand('globalSetting');

var _ = (function () {
	var stringCache = new Store('Strings');

	return function _ (string, args) {
		if (Array.isArray(args))
			stringCache.set(string, GlobalCommand('_', {
				string: string,
				args: args
			}));

		return stringCache.get(string);
	}
})();

var Handler = {
	onDocumentVisible: [],

	DOMContentLoaded: function () {
		var i,
				b;

		var scripts = document.getElementsByTagName('script'),
				anchors = document.getElementsByTagName('a'),
				forms = document.getElementsByTagName('form'),
				iframes = document.getElementsByTagName('iframe'),
				frames = document.getElementsByTagName('frame'),
				unblockedScripts = Page.unblocked.getStore('script').get('all', [], true);

		for (i = 0, b = scripts.length; i < b; i++)
			if (!Element.triggersBeforeLoad(scripts[i]))
				Element.processUnblockable('script', scripts[i]);

		for (i = 0, b = anchors.length; i < b; i++)
			Element.handle.anchor(anchors[i]);

		for (i = 0, b = iframes.length; i < b; i++)
			Element.handle.frame(iframes[i]);

		for (i = 0, b = frames.length; i < b; i++)
			Element.handle.frame(frames[i]);

		if (globalSetting.blockReferrer) {
			var method;

			for (var i = 0, b = forms.length; i < b; i++) {
				method = forms[y].getAttribute('method');

				if (method && method.toLowerCase() === 'post')
					GlobalPage.message('cannotAnonymize', Utilities.URL.getAbsolutePath(forms[i].getAttribute('action')));
			}
		}

		Page.send();
	},

	hash: function (event) {
		Page.info.location = Utilities.Page.getCurrentLocation();
		
		if (event)
			Page.send();
	},

	visibilityChange: function (event) {
		if (!document.hidden) {
			for (var i = 0, b = Handler.onDocumentVisible.length; i < b; i++) {
				var fn = Handler.onDocumentVisible.shift();

				if (typeof fn === 'function')
					fn();
				else
					throw new TypeError(fn + ' is not a function');
			}

			Page.send();
		}
	},

	contextMenu: function (event) {
		Events.setContextMenuEventUserInfo(event, {
			pageID: TOKEN.PAGE,
			menuCommand: UserScript.menuCommand,
			placeholders: document.querySelectorAll('.jsblocker-placeholder').length
		});
	},

	keyUp: function (event) {
		if (event.ctrlKey && event.altKey && event.which === 74)
			GlobalPage.message('openPopover');
	}
};

var Element = {
	hide: function (kind, element, source) {
		if (globalSetting.showPlaceholder[kind]) {
				// Element.createPlaceholder(element, source);
		} else
			Element.collapse(element);
	},

	collapse: function (element) {		
		var collapsible = ['height', 'width', 'padding', 'margin'];

		for (var i = 0; i < collapsible.length; i++)
			element.style.setProperty(collapsible[i], 0, 'important');

		element.style.setProperty('display', 'none', 'important');
		element.style.setProperty('visibility', 'hidden', 'important');
	},

	shouldIgnore: function (element) {
		return Utilities.Token.valid(element.getAttribute('data-jsbAllowAndIgnore'), 'AllowAndIgnore', true)
	},

	triggersBeforeLoad: function (element) {
		var elementBased = ['SCRIPT', 'FRAME', 'IFRAME', 'EMBED', 'OBJECT', 'VIDEO', 'IMG']._contains(element.nodeName);

		if (!elementBased)
			return false;

		return !!(element.src || element.srcset) || ['FRAME', 'IFRAME']._contains(element.nodeName);
	},

	processUnblockable: function (kind, element) {
		if (!Utilities.Token.valid(element.getAttribute('data-jsbUnblockable'), element)) {
			var kindStore = Page.unblocked.getStore(kind);

			element.setAttribute('data-jsbUnblockable', Utilities.Token.create(element, true));

			if (Element.triggersBeforeLoad(element)) {
				if (!globalSetting.hideInjected)
					Page.allowed.getStore(kind).get('all', [], true).push({
						source: element.src || element.srcset,
						ruleAction: -1,
						unblockable: true,
						meta: {
							injected: true,
							name: element.getAttribute('data-jsbInjectedScript')
						}
					});
			} else if (Element.shouldIgnore(element)) {
				element.removeAttribute('data-jsbAllowAndIgnore');

				if (!globalSetting.hideInjected)
					kindStore.get('all', [], true).push(element.innerHTML || element.src);
			} else
				kindStore.get('all', [], true).push(element.innerHTML || element.src || element.outerHTML);

			Page.send();
				
			return true;
		}

		return false;
	},

	handle: {
		node: function (node) {
			var node = node.target || node;

			if (node.nodeName === 'A')
				Element.handle.anchor(node);
			else if (BLOCKABLE[node.nodeName]) {
				if (node.nodeName._endsWith('FRAME'))
					Element.handle.frame(node);

				var kind = BLOCKABLE[node.nodeName][0];

				if (globalSetting.enabledKinds[kind] && !Element.triggersBeforeLoad(node))
					Element.processUnblockable(kind, node);
			}
		},

		anchor: function (anchor) {
			var hasTarget = !!anchor.target;

			anchor = anchor.target || anchor;

			var isAnchor = anchor.nodeName && anchor.nodeName === 'A';
			
			if (hasTarget && !isAnchor) {
				if (anchor.querySelectorAll) {
					var anchors = anchor.querySelectorAll('a', anchor);

					for (var i = 0, b = anchors.length; i < b; i++)
						Element.handle.anchor(anchors[i]);
				}
				
				return false;
			}

			if (isAnchor && !Utilities.Token.valid(anchor.getAttribute('data-jsbAnchorPrepared'), 'AnchorPrepared')) {
				var href = anchor.getAttribute('href');

				anchor.setAttribute('data-jsbAnchorPrepared', Utilities.Token.create('AnchorPrepared', true));
				
				if (Special.isEnabled('simple_referrer')) {
					if (href && href.length && href.charAt(0) !== '#')
						if ((!anchor.getAttribute('rel') || !anchor.getAttribute('rel').length))
							anchor.setAttribute('rel', 'noreferrer');
				}

				if (globalSetting.confirmShortURL)
					anchor.addEventListener('click', function () {
						var target = this.getAttribute('target');

						if (target !== '_blank' && target !== '_top' && !GlobalCommand('confirmShortURL', {
							shortURL: this.href,
							pageLocation: Page.info.location
						})) {
							event.preventDefault();
							event.stopPropagation();
						}
					});
				
				if (globalSetting.blockReferrer)
					if (href && href.charAt(0) === '#')
						GlobalPage.message('cannotAnonymize', Utilities.URL.getAbsolutePath(href));
					else	
						anchor.addEventListener('mousedown', function (event) {
							var key = /Win/.test(window.navigator.platform) ? event.ctrlKey : event.metaKey;
						
							GlobalPage.message('anonymousNewTab', key || event.which === 2 ? 1 : 0);
						
							setTimeout(function () {
								GlobalPage.message('anonymousNewTab', 0);
							}, 1000);
						}, true);
			}
		},

		frame: function (frame) {
			var frame = frame.target || frame,
					id = frame.getAttribute('id');

			if (!id || !id.length)
				frame.setAttribute('id', (id = Utilities.id()));
			
			var idToken = frame.getAttribute('data-jsbFrameProcessed');

			if (Utilities.Token.valid(idToken, id))
				return;

			frame.setAttribute('data-jsbFrameProcessed', Utilities.Token.create(id, true));

			Utilities.Timer.timeout('FrameURLRequestFailed' + frame.id, function (frame) {
				if (TOKEN.BLOCKED_ELEMENTS._contains(frame))
					return;

				LogDebug(['frame vanished or is slow to load', frame.id, !!document.getElementById(frame.id)].join(' - '));

				Resource.canLoad({
					target: frame,
					unblockable: !!frame.src
				}, false, {
					id: frame.id
				});
			}, 2000, [frame]);

			frame.addEventListener('load', function () {
				this.contentWindow.postMessage({
					command: 'requestFrameURL',
					data: {
						id: this.id
					}
				}, '*');
			}, false);
		}
	}
};

var Resource = {
	staticActions: {},

	canLoad: function (event, excludeFromPage, meta) {
		if (event.type === 'DOMNodeInserted' && event.target.src)
			return;

		var element = event.target || event;

		if (!(element.nodeName in BLOCKABLE))
			return true;

		var kind = BLOCKABLE[element.nodeName][0];

		if (!globalSetting.enabledKinds[kind])
			return true;

		var source = Utilities.URL.getAbsolutePath(event.url || element.getAttribute('src')),
				sourceHost = (source && source.length) ? Utilities.URL.extractHost(source) : null;

		if (!Utilities.Token.valid(element.getAttribute('data-jsbAllowLoad'), 'AllowLoad')) {
			if (kind in Resource.staticActions) {
				if (!Resource.staticActions[kind] && event.preventDefault)
					event.preventDefault();

				return Resource.staticActions[kind];
			} else {
				if (!sourceHost && element.nodeName !== 'OBJECT') {
					source = 'about:blank';
					sourceHost = 'blank';
				} else if (!sourceHost)
					return true;

				if (Element.shouldIgnore(element))
					return Element.processUnblockable(kind, element);

				if (element.nodeName._endsWith('FRAME'))
					element.setAttribute('data-jsbFrameURL', source);

				if (event.unblockable)
					var canLoad = {
						isAllowed: true,
						action: -1
					}
				else
					var canLoad = GlobalCommand('canLoadResource', {
						kind: kind,
						pageLocation: Page.info.location,
						pageProtocol: Page.info.protocol,
						source: source,
						isFrame: !Utilities.Page.isTop
					});
				
				var stateItems = (canLoad.isAllowed || !event.preventDefault) ? Page.allowed : Page.blocked,
						kindStore = stateItems.getStore(kind);

				if (!canLoad.isAllowed && event.preventDefault)
					event.preventDefault();

				if (!canLoad.isAllowed)
					TOKEN.BLOCKED_ELEMENTS.push(element);

				if (canLoad.action === -85) {
					Resource.staticActions[kind] = canLoad.isAllowed;

					Page.send();

					return canLoad.isAllowed;
				}

				Utilities.setImmediateTimeout(function (meta, element, excludeFromPage, canLoad, kindStore, source, event, sourceHost, kind) {
					if (['EMBED', 'OBJECT']._contains(element.nodeName)) {
						if (!meta)
							meta = {};

						meta.type = element.getAttribute('type');
					}

					if (excludeFromPage !== true || canLoad.action >= 0) {
						kindStore.get('all', [], true).push({
							source: source,
							ruleAction: canLoad.action,
							unblockable: !!event.unblockable,
							meta: meta
						});

						kindStore.getStore('hosts').increment(sourceHost);
					}

					if (BLOCKABLE[element.nodeName][1] && !canLoad.isAllowed)
						Element.hide(kind, element, source);

					Page.send();
				}, [meta, element, excludeFromPage, canLoad, kindStore, source, event, sourceHost, kind]);
				
				return canLoad.isAllowed;
			}
		} else {
			Utilities.Token.expire(element.getAttribute('data-jsbAllowLoad'));

			if (element === event && Utilities.Token.valid(element.getAttribute('data-jsbWasPlaceholder'), 'WasPlaceholder', true)) {		
				element.removeAttribute('data-jsbWasPlaceholder');
				element.setAttribute('data-jsbAllowLoad', Utilities.Token.create('AllowLoad'));
			}

			Page.send();

			return true;
		}
	}
};

if (!globalSetting.disabled) {
	if (Utilities.safariBuildVersion > 535) {
		var observer = new MutationObserver(function (mutations) {
			for (var i = 0; i < mutations.length; i++)
				if (mutations[i].type === 'childList')
					for (var j = 0; j < mutations[i].addedNodes.length; j++)
						Element.handle.node(mutations[i].addedNodes[j]);
		});

		observer.observe(document, {
			childList: true,
			subtree: true
		});
	} else
		document.addEventListener('DOMNodeInserted', Element.handle.node, true);

	document.addEventListener('contextmenu', Handler.contextMenu, false);
	document.addEventListener('DOMContentLoaded', Handler.DOMContentLoaded, true);
	document.addEventListener('visibilitychange', Handler.visibilityChange, true);
	document.addEventListener('keyup', Handler.keyUp, true);
	document.addEventListener('beforeload', Resource.canLoad, true);

	window.addEventListener('hashchange', Handler.hash, true);

	window.onerror = function (d, p, l, c) {
		if (typeof p === 'string' && p._contains('JavaScriptBlocker')) {
			var errorMessage =  d + ', ' + p + ', ' + l;

			LogError(errorMessage);
		}
	};
}

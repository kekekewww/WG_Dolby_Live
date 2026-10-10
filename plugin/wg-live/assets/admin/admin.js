/* WG Live: wp-admin helpers (no build step; plain browser JavaScript).
 *
 * Loaded only on the plugin's own screens (event editor, event list, settings, deployment info,
 * create-pages). Every enhancement is optional: the PHP side validates everything again.
 * No HTML strings are built here: text goes through textContent, rows come from <template>.
 */
(function () {
	'use strict';

	var SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
	var SLUG_MAX = 100;

	function ready(fn) {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', fn);
		} else {
			fn();
		}
	}

	function each(list, fn) {
		Array.prototype.forEach.call(list, fn);
	}

	/* ---- Event editor: the visible, required 代稱 (slug) field ---------------------------- */

	function slugProblem(value) {
		if (value === '') {
			return '代稱是必填欄位。';
		}
		if (value.length > SLUG_MAX) {
			return '代稱最多 100 個字元。';
		}
		if (!SLUG_RE.test(value)) {
			return '代稱只能使用小寫英文字母、數字與連字號，且不可以連字號開頭或結尾。';
		}
		return '';
	}

	function slugify(text) {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, SLUG_MAX)
			.replace(/-+$/g, '');
	}

	function initSlug() {
		var input = document.getElementById('wg-live-slug');
		if (!input) {
			return;
		}
		var status = document.getElementById('wg-live-slug-status');
		var title = document.getElementById('title');
		var touched = input.value !== '';

		function render(force) {
			var problem = slugProblem(input.value);
			var show = force || input.value !== '';
			input.setAttribute('aria-invalid', show && problem ? 'true' : 'false');
			if (status) {
				status.textContent = show ? problem : '';
				status.className = 'wg-live-admin__slug-status' + (show && problem ? ' wg-live-admin__slug-status--bad' : '');
			}
		}

		input.addEventListener('input', function () {
			touched = true;
			render(false);
		});

		// Pre-fill from the title only when it is plain ASCII (Chinese titles never become a slug).
		if (title) {
			title.addEventListener('input', function () {
				if (touched) {
					return;
				}
				var text = title.value.trim();
				if (/^[\x20-\x7e]+$/.test(text)) {
					var guess = slugify(text);
					if (guess !== '') {
						input.value = guess;
					}
				}
				render(false);
			});
		}

		// Publishing needs a slug; saving a draft does not. The server enforces this as well.
		var publish = document.getElementById('publish');
		if (publish) {
			publish.addEventListener('click', function (event) {
				if (slugProblem(input.value) !== '') {
					event.preventDefault();
					render(true);
					input.focus();
				}
			});
		}
		render(false);
	}

	/* ---- Repeatable rows (FAQ, compatibility table) --------------------------------------- */

	function initRepeaters() {
		each(document.querySelectorAll('[data-wg-live-repeat]'), function (group) {
			var rows = group.querySelector('[data-wg-live-rows]');
			var template = group.querySelector('template[data-wg-live-template]');
			var add = group.querySelector('[data-wg-live-add]');
			if (!rows) {
				return;
			}
			var next = parseInt(group.getAttribute('data-next-index'), 10);
			if (isNaN(next)) {
				next = rows.children.length;
			}

			if (add && template && template.content) {
				add.hidden = false;
				add.addEventListener('click', function () {
					var fragment = template.content.cloneNode(true);
					var index = String(next++);
					each(fragment.querySelectorAll('*'), function (el) {
						each(Array.prototype.slice.call(el.attributes), function (attr) {
							if (attr.value.indexOf('__INDEX__') !== -1) {
								el.setAttribute(attr.name, attr.value.split('__INDEX__').join(index));
							}
						});
					});
					var row = fragment.firstElementChild;
					rows.appendChild(fragment);
					var field = row ? row.querySelector('input, textarea, select') : null;
					if (field) {
						field.focus();
					}
				});
			}

			group.addEventListener('click', function (event) {
				var button = event.target && event.target.closest ? event.target.closest('[data-wg-live-remove]') : null;
				if (!button || !group.contains(button)) {
					return;
				}
				var row = button.closest('[data-wg-live-row]');
				if (row && row.parentNode) {
					row.parentNode.removeChild(row);
					if (add && !add.hidden) {
						add.focus();
					}
				}
			});
		});
	}

	/* ---- Compatibility rows: explain the "verified needs evidence" rule ------------------- */

	function field(row, name) {
		var el = row.querySelector('[name$="[' + name + ']"]');
		return el ? el.value.trim() : '';
	}

	function updateCompatHint(row) {
		var select = row.querySelector('[data-wg-live-compat-status]');
		var hint = row.querySelector('[data-wg-live-compat-hint]');
		if (!select || !hint) {
			return;
		}
		var missing = [];
		if (select.value !== 'pending') {
			if (field(row, 'testedAt') === '') { missing.push('測試日期'); }
			if (field(row, 'device') === '') { missing.push('裝置'); }
			if (field(row, 'os') === '') { missing.push('作業系統'); }
			if (field(row, 'browser') === '') { missing.push('瀏覽器'); }
			if (field(row, 'outputPath') === '') { missing.push('輸出路徑'); }
		}
		hint.textContent = missing.length ? '缺少：' + missing.join('、') + '。儲存時這一列會改存為「尚待測試」。' : '';
	}

	function initCompat() {
		var rows = document.querySelectorAll('.wg-live-admin__row--compat');
		if (!rows.length) {
			return;
		}
		var form = rows[0].closest('form') || document;
		function handler(event) {
			var row = event.target && event.target.closest ? event.target.closest('.wg-live-admin__row--compat') : null;
			if (row) {
				updateCompatHint(row);
			}
		}
		form.addEventListener('input', handler);
		form.addEventListener('change', handler);
		each(rows, updateCompatHint);
	}

	/* ---- Demo audio picker (wp.media, audio only) ----------------------------------------- */

	function initAudio() {
		var boxes = document.querySelectorAll('[data-wg-live-audio]');
		if (!boxes.length || !window.wp || !window.wp.media) {
			return;
		}
		each(boxes, function (box) {
			var id = box.querySelector('[data-wg-live-audio-id]');
			var name = box.querySelector('[data-wg-live-audio-name]');
			var pick = box.querySelector('[data-wg-live-audio-pick]');
			var clear = box.querySelector('[data-wg-live-audio-clear]');
			var frame = null;
			if (!id || !pick) {
				return;
			}
			pick.hidden = false;
			if (clear) {
				clear.hidden = false;
			}

			pick.addEventListener('click', function () {
				if (!frame) {
					frame = window.wp.media({
						title: box.getAttribute('data-title') || '選擇示範音訊',
						button: { text: box.getAttribute('data-button') || '使用此音訊' },
						library: { type: 'audio' },
						multiple: false
					});
					frame.on('select', function () {
						var item = frame.state().get('selection').first();
						var data = item ? item.toJSON() : null;
						if (!data || !data.id) {
							return;
						}
						id.value = String(data.id);
						if (name) {
							name.textContent = data.filename || data.title || '#' + data.id;
						}
					});
				}
				frame.open();
			});

			if (clear) {
				clear.addEventListener('click', function () {
					id.value = '0';
					if (name) {
						name.textContent = box.getAttribute('data-bundled') || '';
					}
				});
			}
		});
	}

	/* ---- Colour inputs -------------------------------------------------------------------- */

	function initColors() {
		var $ = window.jQuery;
		if (!$ || !$.fn || !$.fn.wpColorPicker) {
			return;
		}
		$('[data-wg-live-color]').wpColorPicker();
	}

	/* ---- Delete-on-uninstall: the second box is the confirmation -------------------------- */

	function initDelete() {
		var want = document.querySelector('[data-wg-live-delete]');
		var confirmBox = document.querySelector('[data-wg-live-delete-confirm]');
		if (!want || !confirmBox) {
			return;
		}
		function sync() {
			confirmBox.disabled = !want.checked;
			if (!want.checked) {
				confirmBox.checked = false;
			}
		}
		want.addEventListener('change', sync);
		sync();
	}

	ready(function () {
		initSlug();
		initRepeaters();
		initCompat();
		initAudio();
		initColors();
		initDelete();
	});
}());

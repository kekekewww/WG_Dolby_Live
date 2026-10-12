// Behaviour of the realistic site mock (dev/site-mock.css + dev/site-mock.html). Dev only, never packaged.
// Loaded synchronously in <head>, so the classes are set before first paint.
//
//  - Real-site assets (background photo, logos) and Google Fonts load only when `html.wgm-assets` is set:
//      ?chrome=live      always       ?chrome=offline   never (gradient background, text logo, fallback fonts)
//      otherwise         yes for people; NO for automation (navigator.webdriver), so test runs do not hit the
//                        studio's site; <script data-assets="live"> (dev/mockups) forces them on.
//  - ?host=light renders the content section on a white background with Astra's default dark text (#3a3a3a), the
//    case "the plugin sits on a light host section"; the default is the dark live site. See docs/design/site-mock.md.
//  - ?banner=off hides the fixed bottom banner; closing it remembers that for the tab (sessionStorage).
//  - Mobile menu toggle, and a `wgm-scrolled` class for the header shadow.
(function () {
  var root = document.documentElement;
  var script = document.currentScript;
  var params = new URLSearchParams(window.location.search);
  var chrome = params.get('chrome');
  var forced = script && script.getAttribute('data-assets') === 'live';
  var live = chrome === 'live' || (chrome !== 'offline' && (forced || !navigator.webdriver));

  if (live) {
    root.classList.add('wgm-assets');
    var fonts = document.createElement('link');
    fonts.rel = 'stylesheet';
    fonts.href = 'https://fonts.googleapis.com/css2?family=Karla:wght@400;500&family=Noto+Sans+TC:wght@200;300;400;500;700&family=Poppins:wght@600&display=swap';
    document.head.appendChild(fonts);
  }

  if (params.get('host') === 'light') root.classList.add('wgm-host-light');

  var KEY = 'wgm-banner-off';
  var off = params.get('banner') === 'off';
  try {
    off = off || window.sessionStorage.getItem(KEY) === '1';
  } catch {
    /* storage can be blocked: the banner just shows again */
  }
  if (off) root.classList.add('wgm-banner-off');

  document.addEventListener('DOMContentLoaded', function () {
    var banner = document.getElementById('wgm-banner');
    if (banner && off) banner.hidden = true;
    var close = banner && banner.querySelector('.wgm-banner__close');
    if (banner && close) {
      close.addEventListener('click', function () {
        banner.hidden = true;
        root.classList.add('wgm-banner-off');
        try {
          window.sessionStorage.setItem(KEY, '1');
        } catch {
          /* ignore */
        }
      });
    }

    var header = document.getElementById('masthead');
    var toggle = header && header.querySelector('.wgm-menu-toggle');
    if (header && toggle) {
      toggle.addEventListener('click', function () {
        var open = !header.classList.contains('is-open');
        header.classList.toggle('is-open', open);
        toggle.setAttribute('aria-expanded', String(open));
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && header.classList.contains('is-open')) {
          header.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
          toggle.focus();
        }
      });
    }

    var onScroll = function () {
      root.classList.toggle('wgm-scrolled', window.scrollY > 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  });
})();

/**
 * Regression guards for the review fixes in the PHP plugin (php-security F1-F3, spec-compliance F3, F4, F10,
 * F12). PHP cannot run in the unit suite (no local PHP, D8), so these read the PHP source and pin the shape
 * of each fix. The behaviour itself was exercised against php:7.4 and php:8.3 with a WordPress stub harness
 * (see docs/implementation/reports/fix-php.md) and runs for real in the wp-env integration specs.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (rel: string): string => readFileSync(resolve(ROOT, 'plugin/wg-live', rel), 'utf8');

/** Body of `function name(` up to the next method docblock. */
function method(source: string, name: string): string {
  const start = source.search(new RegExp(`function\\s+${name}\\s*\\(`));
  if (start < 0) throw new Error(`function ${name} not found`);
  const rest = source.slice(start);
  const end = rest.search(/\n\t\/\*\*/);
  return end < 0 ? rest : rest.slice(0, end);
}

describe('php-security F1: a second do_shortcode() pass finds no [tag]', () => {
  const publicData = read('includes/class-public-data.php');
  const encode = method(publicData, 'encode_config');

  it('escapes [ and ] inside JSON string literals only (not the array brackets)', () => {
    expect(encode).toContain('preg_replace_callback');
    expect(encode).toContain(String.raw`'/"[^"]*"/'`);
    expect(encode).toContain(String.raw`array( '[', ']' )`);
    // The replacement runs inside the callback on one string literal ($m[0]), never on the whole document.
    expect(encode).toMatch(/str_replace\(\s*array\(\s*'\[',\s*'\]'\s*\),\s*array\([^)]*\),\s*\$m\[0\]\s*\)/);
    expect(encode).not.toMatch(/str_replace\(\s*array\(\s*'\[',\s*'\]'\s*\),[^;]*\$json\s*\)/);
  });

  it('keeps JSON_HEX_QUOT, which the string-literal pattern relies on', () => {
    expect(encode).toContain('JSON_HEX_QUOT');
  });

  it('the featured card template routes every text and attribute through Shortcodes::defuse_brackets', () => {
    const shortcodes = read('includes/class-shortcodes.php');
    // Hex references: do_shortcode()'s unescape_invalid_shortcodes() reverts the decimal &#91;/&#93;.
    expect(method(shortcodes, 'defuse_brackets')).toMatch(/array\(\s*'&#x5B;',\s*'&#x5D;'\s*\)/);

    const template = read('templates/featured.php');
    const echoes = Array.from(template.matchAll(/echo\s+(esc_html|esc_url|esc_attr)\(\s*([^;]*?)\s*\);/g));
    const bare = echoes.filter((m) => !/\$wg_heading|\$wg_title_id|\$args\['status'\]|\$args\['machine_time'\]|\(string\)/.test(m[2] as string));
    expect(bare, bare.map((m) => m[0]).join('\n')).toEqual([]);
    for (const needle of ["$args['title']", "$args['status_label']", "$args['text']", "$args['replay_pending']", "$args['demo_badge']", "$args['fallback']", "$wg_time['full']", "$wg_cta['label']", "$wg_poster['alt']"]) {
      expect(template, needle).toMatch(new RegExp(`defuse_brackets\\( esc_(html|attr)\\( ${needle.replace(/[$[\]]/g, '\\$&')} \\) \\)`));
    }
  });
});

describe('php-security F2: the invalid-colour notice escapes the submitted value', () => {
  it('wraps the shortened raw value in esc_html()', () => {
    const settings = read('includes/class-settings.php');
    const line = settings.split('\n').find((l) => l.includes('不是有效的十六進位色碼')) ?? '';
    expect(line).toContain('esc_html( self::shorten( $raw, 20 ) )');
  });
});

describe('php-security F3 / spec-compliance F10: create-pages conflicts include media-library files', () => {
  const settings = read('includes/class-settings.php');
  const findPage = method(settings, 'find_page');

  it("queries post_type IN ('page', 'attachment') and prefers pages", () => {
    expect(findPage).toContain("post_type IN ('page', 'attachment')");
    expect(findPage).toContain("ORDER BY (post_type = 'page') DESC");
    expect(findPage).toContain('post_parent = %d');
    expect(findPage).toContain("post_status NOT IN ('trash', 'auto-draft')");
  });

  it('the preview and the handler share the same conflict check', () => {
    expect(method(settings, 'render_pages_page')).toContain('self::page_conflicts()');
    expect(method(settings, 'handle_create_pages')).toContain('self::page_conflicts()');
  });
});

describe('spec-compliance F12 (spec 10.4): the WooCommerce page wins over the admin link override', () => {
  const links = read('includes/class-site-links.php');
  const resolver = method(links, 'wc_or_override');

  it('account and store links use the WooCommerce-first resolver', () => {
    expect(links).toMatch(/'account'\s*=>\s*self::wc_or_override\(/);
    expect(links).toMatch(/'store'\s*=>\s*self::wc_or_override\(/);
    expect(links).toMatch(/'contact'\s*=>\s*self::override_or_null\(/);
  });

  it('tries wc_get_page_id() (published pages only) before the override', () => {
    expect(resolver.indexOf('wc_get_page_id')).toBeGreaterThan(-1);
    expect(resolver.indexOf('wc_get_page_id')).toBeLessThan(resolver.indexOf('override_or_null'));
    expect(resolver).toContain('self::page_permalink(');
  });

  it('the settings help text says the WooCommerce page takes precedence', () => {
    expect(read('includes/class-settings.php')).toContain('一律使用該頁面');
  });
});

describe('spec-compliance F3 / F4: publishing needs a title and a valid start time', () => {
  const events = read('includes/class-events.php');
  const filter = method(events, 'filter_insert_post_data');
  const guard = method(events, 'require_title_and_start');
  const start = method(events, 'will_have_start_time');

  it('runs the title/start guard on both exits of the slug filter', () => {
    expect(filter.match(/return self::require_title_and_start\(/g)?.length).toBe(2);
  });

  it('forces a draft and flashes a notice for an empty title or a missing start time', () => {
    expect(guard).toContain("array( 'publish', 'future', 'private' )");
    expect(guard).toContain('wp_strip_all_tags');
    expect(guard).toContain('活動標題是必填欄位');
    expect(guard).toContain('開始時間是必填欄位');
    expect(guard).toContain("$data['post_status'] = 'draft'");
    expect(guard).toContain('self::$forced_draft');
    expect(guard).toContain("self::flash( 'error'");
  });

  it('mirrors save_post(): a blank field clears the time, a malformed one keeps the stored time', () => {
    expect(start).toContain('self::has_valid_nonce(');
    expect(start).toContain("'starts_local'");
    expect(start).toContain('self::local_to_utc(');
    expect(start).toMatch(/'' === \$local\s*\)\s*\{\s*return false;/);
    expect(start).toContain("return '' !== $stored; // Malformed input");
  });

  it('a programmatic insert (no ID, meta written afterwards) is not blocked unless meta_input says so', () => {
    expect(start).toContain("$postarr['meta_input']");
    expect(start).toMatch(/\$post_id <= 0\s*\)\s*\{\s*return true;/);
  });

  it('still flags legacy rows without a start time in the list and in the featured selector', () => {
    expect(events).toContain('未設定：不會公開');
    expect(events).toContain('設定之前不會顯示在前台');
    expect(read('includes/class-settings.php')).toContain('（未設定開始時間，不會顯示）');
  });

  it('keeps public_event() strict: no start time, no public event (PublicEvent.startsAt is non-null)', () => {
    const publicEvent = method(read('includes/class-public-data.php'), 'public_event');
    expect(publicEvent).toMatch(/return null;/);
    expect(publicEvent).toContain("$data['starts_at_utc']");
  });
});

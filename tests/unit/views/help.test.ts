import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { helpCopy } from '../../../src/i18n/copy-help';
import { DEMO_MEDIA_NOTICE } from '../../../src/i18n/copy-status';
import type { BootConfig, CompatibilityRow } from '../../../src/types';
import { mountHelpView } from '../../../src/views/help';
import type { ViewInstance } from '../../../src/views/types';

function makeBoot(overrides: Partial<BootConfig> = {}): BootConfig {
  return {
    schema: 1,
    pluginVersion: '0.1.0',
    view: 'help',
    deploymentMode: 'demo',
    timezone: 'Asia/Taipei',
    rest: { root: 'https://sounds.example.com/wp-json/wg-live/v1/', nonce: null, nonceUrl: '' },
    assets: { hls: null },
    links: {
      home: 'https://sounds.example.com/',
      events: 'https://sounds.example.com/live/',
      player: 'https://sounds.example.com/live/listen/',
      help: 'https://sounds.example.com/live/help/',
      account: null,
      store: null,
      contact: 'https://sounds.example.com/contact/',
    },
    fixedEventSlug: null,
    featuredEventSlug: null,
    heading: 'h2',
    events: [],
    help: { faq: [], compatibility: [], supportNote: '' },
    devTools: false,
    ...overrides,
  };
}

function row(overrides: Partial<CompatibilityRow> = {}): CompatibilityRow {
  return {
    device: 'Apple TV 4K',
    os: 'tvOS',
    browser: 'Safari',
    outputPath: 'HDMI 到支援的電視',
    sourceFormat: 'HLS',
    status: 'pending',
    testedAt: null,
    notes: '',
    ...overrides,
  };
}

let mount: HTMLElement;
let view: ViewInstance | null = null;

function mountView(boot: BootConfig): HTMLElement {
  const root = document.createElement('div');
  root.className = 'wg-live';
  root.append(mount);
  document.body.append(root);
  view = mountHelpView(mount, boot);
  return mount;
}

beforeEach(() => {
  mount = document.createElement('div');
});

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function sectionHeadings(): string[] {
  return Array.from(mount.querySelectorAll('.wg-live__help-section > .wg-live__heading')).map((e) => e.textContent ?? '');
}

describe('help view: fixed sections (plan 6.11)', () => {
  it('renders the title Listening Guide with the 聆聽說明 subtitle as an h2 by default', () => {
    mountView(makeBoot());
    const title = mount.querySelector('.wg-live__view-title');
    expect(title?.tagName).toBe('H2');
    expect(title?.textContent).toBe('Listening Guide');
    expect(mount.querySelector('.wg-live__view-subtitle')?.textContent).toBe('聆聽說明');
  });

  it('promotes the title to h1 for heading="h1" and moves the sections to h2', () => {
    mountView(makeBoot({ heading: 'h1' }));
    expect(mount.querySelector('.wg-live__view-title')?.tagName).toBe('H1');
    expect(mount.querySelectorAll('h1')).toHaveLength(1);
    expect(mount.querySelector('.wg-live__help-section > .wg-live__heading')?.tagName).toBe('H2');
    expect(mount.querySelector('.wg-live__help-mode-name')?.tagName).toBe('H3');
  });

  it('has the eight fixed sections in order, with no FAQ section when the admin FAQ is empty', () => {
    mountView(makeBoot());
    expect(sectionHeadings()).toEqual([
      helpCopy.modes.heading,
      helpCopy.safari.heading,
      helpCopy.compat.heading,
      '沒有聲音時',
      '重新連線',
      '切換模式',
      '鍵盤操作',
      '聯絡我們',
    ]);
    expect(mount.querySelector('.wg-live__help-section--faq')).toBeNull();
  });

  it('explains the two modes with the spec 5.2 wording and does not overclaim', () => {
    mountView(makeBoot());
    const modes = mount.querySelector('.wg-live__help-section--modes') as HTMLElement;
    expect(modes.textContent).toContain('耳機聆聽 · Binaural');
    expect(modes.textContent).toContain('使用耳機聆聽錄音室製作的雙耳版本。');
    expect(modes.textContent).toContain('家庭劇院 · Dolby Atmos');
    expect(modes.textContent).toContain('適用於經確認的播放裝置、連接方式與 Atmos 家庭劇院。');
    expect(modes.textContent).toContain('選用 Atmos 音軌不等於系統已確認最終設備輸出。');
    expect(mount.textContent).not.toMatch(/已認證|7\.1\.4 已連線|全部設備|所有設備都/);
  });

  it('states the Safari-first acceptance note', () => {
    mountView(makeBoot());
    expect(mount.querySelector('.wg-live__help-section--safari')?.textContent).toContain('Safari');
  });

  it('UI-09: does not promise a 「尚未確認」 state the player never renders', () => {
    mountView(makeBoot());
    expect(mount.textContent).not.toContain('尚未確認');
  });

  it('UI-08: the K shortcut row does not describe a Space shortcut or an impossible focus position', () => {
    mountView(makeBoot());
    const rows = Array.from(mount.querySelectorAll('.wg-live__keys-row'));
    const kRow = rows.find((r) => Array.from(r.querySelectorAll('dt kbd')).some((k) => k.textContent === 'K'));
    expect(kRow).toBeDefined();
    expect(Array.from(kRow?.querySelectorAll('dt kbd') ?? []).map((k) => k.textContent)).toEqual(['K']);
    expect(kRow?.querySelector('dd')?.textContent).not.toContain('不在按鈕');
    // Space is documented once, as the normal way to press the focused button.
    const spaceRows = rows.filter((r) => Array.from(r.querySelectorAll('dt kbd')).some((k) => k.textContent === 'Space'));
    expect(spaceRows).toHaveLength(1);
    expect(spaceRows[0]?.querySelector('dd')?.textContent).toContain('按鈕');
  });

  it('documents the real keyboard shortcuts (Space and K inside the player, Esc for the dialog)', () => {
    mountView(makeBoot());
    const keys = Array.from(mount.querySelectorAll('.wg-live__kbd')).map((e) => e.textContent);
    expect(keys).toEqual(expect.arrayContaining(['Space', 'K', 'Esc', 'Tab']));
    const rows = mount.querySelectorAll('.wg-live__keys-row');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of Array.from(rows)) {
      expect(r.querySelector('dt kbd')).not.toBeNull();
      expect(r.querySelector('dd')?.textContent).not.toBe('');
    }
    // No shortcut the player does not implement.
    expect(keys).not.toContain('M');
    expect(keys).not.toContain('F');
  });

  it('lists the no-sound checks as an ordered list', () => {
    mountView(makeBoot());
    const steps = mount.querySelectorAll('ol.wg-live__help-steps > li');
    expect(steps.length).toBeGreaterThanOrEqual(4);
  });

  it('describes reconnecting with the 3-retry limit and mode switching without silent track changes', () => {
    mountView(makeBoot());
    expect(mount.querySelector('.wg-live__help-section--reconnect')?.textContent).toContain('最多 3 次');
    const switching = mount.querySelector('.wg-live__help-section--switching')?.textContent ?? '';
    expect(switching).toContain('改用耳機 Binaural');
    expect(switching).toContain('短暫中斷');
  });
});

describe('help view: compatibility table', () => {
  it('renders pending rows as 尚待測試 text, not as a supported claim', () => {
    mountView(makeBoot({ help: { faq: [], supportNote: '', compatibility: [row(), row({ device: 'AVR 示意', os: 'iPadOS' })] } }));
    const statuses = Array.from(mount.querySelectorAll('.wg-live__compat-status'));
    expect(statuses).toHaveLength(2);
    for (const el of statuses) {
      expect(el.textContent).toBe('尚待測試');
      expect((el as HTMLElement).dataset.status).toBe('pending');
    }
    expect(helpCopy.compat.status.pending).toBe('尚待測試');
    expect(mount.querySelector('.wg-live__help-section--compat')?.textContent).not.toMatch(/已支援|支援 ✓|通過/);
  });

  it('uses a real table with a caption, column headers with scope and row headers', () => {
    mountView(makeBoot({ help: { faq: [], supportNote: '', compatibility: [row()] } }));
    const table = mount.querySelector('table.wg-live__compat-table') as HTMLTableElement;
    expect(table).not.toBeNull();
    expect(table.querySelector('caption')?.textContent).toBe(helpCopy.compat.caption);
    const heads = Array.from(table.querySelectorAll('thead th'));
    expect(heads.map((th) => th.textContent)).toEqual([
      '裝置',
      '作業系統',
      '瀏覽器',
      '輸出路徑',
      '來源格式',
      '測試結果',
      '測試日期',
      '備註',
    ]);
    for (const th of heads) expect(th.getAttribute('scope')).toBe('col');
    const rowHead = table.querySelector('tbody th');
    expect(rowHead?.getAttribute('scope')).toBe('row');
    expect(rowHead?.textContent).toContain('Apple TV 4K');
    // Explicit roles keep the table semantics when CSS turns the rows into stacked blocks.
    expect(table.getAttribute('role')).toBe('table');
    expect(table.querySelector('tbody tr')?.getAttribute('role')).toBe('row');
  });

  it('records device, OS, browser, output path, source format and test date in each row', () => {
    mountView(
      makeBoot({
        help: {
          faq: [],
          supportNote: '',
          compatibility: [row({ status: 'verified', testedAt: '2026-10-12', notes: '實機測試' })],
        },
      }),
    );
    const text = mount.querySelector('tbody tr')?.textContent ?? '';
    for (const part of ['Apple TV 4K', 'tvOS', 'Safari', 'HDMI 到支援的電視', 'HLS', '已驗證', '2026-10-12', '實機測試']) {
      expect(text).toContain(part);
    }
  });

  it('shows the result as text for not_working rows and a placeholder for missing values', () => {
    mountView(
      makeBoot({
        help: {
          faq: [],
          supportNote: '',
          compatibility: [row({ status: 'not_working', testedAt: '2026-10-12' }), row({ device: '', os: '', browser: '', outputPath: '', sourceFormat: '' })],
        },
      }),
    );
    const rows = mount.querySelectorAll('tbody tr');
    expect(rows[0]?.querySelector('.wg-live__compat-status')?.textContent).toBe('實測無法使用');
    expect(rows[1]?.textContent).toContain('待確認');
    expect(rows[1]?.querySelector('.wg-live__compat-status')?.textContent).toBe('尚待測試');
    expect(rows[1]?.textContent).toContain('尚無紀錄');
  });

  it('hides the stacked-layout cell labels from assistive technology (column headers name the cells)', () => {
    mountView(makeBoot({ help: { faq: [], supportNote: '', compatibility: [row()] } }));
    const labels = mount.querySelectorAll('.wg-live__compat-cell-label');
    expect(labels.length).toBeGreaterThan(0);
    for (const label of Array.from(labels)) expect(label.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows an explanatory empty note instead of an empty table', () => {
    mountView(makeBoot());
    expect(mount.querySelector('table')).toBeNull();
    expect(mount.querySelector('.wg-live__compat-empty')?.textContent).toBe(helpCopy.compat.empty);
    expect(mount.querySelector('.wg-live__help-section--compat')?.textContent).toContain('尚待測試');
  });

  it('keeps the demo-media disclaimer next to the table', () => {
    mountView(makeBoot());
    expect(mount.querySelector('.wg-live__help-section--compat')?.textContent).toContain(DEMO_MEDIA_NOTICE);
  });

  it('renders hostile cell values as text', () => {
    const evil = '<img src=x onerror=alert(1)>';
    mountView(makeBoot({ help: { faq: [], supportNote: '', compatibility: [row({ device: evil, notes: evil })] } }));
    expect(mount.querySelector('img')).toBeNull();
    expect(mount.querySelector('tbody th .wg-live__compat-cell-value')?.textContent).toBe(evil);
  });
});

describe('help view: contact and FAQ', () => {
  it('shows the support note first, then the contact link', () => {
    mountView(makeBoot({ help: { faq: [], compatibility: [], supportNote: '服務時間：週一至週五。\n請附上裝置型號。' } }));
    const contact = mount.querySelector('.wg-live__help-section--contact') as HTMLElement;
    const children = Array.from(contact.children).slice(1); // after the heading
    expect(children[0]?.textContent).toBe('服務時間：週一至週五。');
    expect(children[1]?.textContent).toBe('請附上裝置型號。');
    const link = contact.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://sounds.example.com/contact/');
    expect(link?.textContent).toBe('聯絡我們');
    expect(children.indexOf(link?.closest('.wg-live__actions') as HTMLElement)).toBeGreaterThan(1);
  });

  it('accepts a mailto contact link', () => {
    mountView(makeBoot({ links: { ...makeBoot().links, contact: 'mailto:hello@example.com' } }));
    expect(mount.querySelector('.wg-live__help-section--contact a')?.getAttribute('href')).toBe('mailto:hello@example.com');
  });

  it('shows a plain fallback sentence when there is neither a note nor a contact link', () => {
    mountView(makeBoot({ links: { ...makeBoot().links, contact: null } }));
    const contact = mount.querySelector('.wg-live__help-section--contact') as HTMLElement;
    expect(contact.querySelector('a')).toBeNull();
    expect(contact.textContent).toContain(helpCopy.contact.fallback);
  });

  it('puts the admin FAQ after the fixed sections, as native details', () => {
    mountView(
      makeBoot({
        help: {
          faq: [
            { question: '可以用藍牙耳機嗎？', answer: '可以。\n但延遲依裝置而定。' },
            { question: '', answer: 'ignored' },
          ],
          compatibility: [],
          supportNote: '',
        },
      }),
    );
    const headings = sectionHeadings();
    expect(headings[headings.length - 1]).toBe('常見問題');
    const items = mount.querySelectorAll('details.wg-live__faq-item');
    expect(items).toHaveLength(1);
    expect(items[0]?.querySelector('summary')?.textContent).toBe('可以用藍牙耳機嗎？');
    expect(items[0]?.querySelectorAll('.wg-live__faq-answer p')).toHaveLength(2);
  });

  it('links back to the events page when it is bound', () => {
    mountView(makeBoot());
    const back = mount.querySelector('.wg-live__help-back');
    expect(back?.getAttribute('href')).toBe('https://sounds.example.com/live/');
    expect(back?.textContent).toBe('返回活動列表');
    view?.destroy();
    document.body.replaceChildren();
    mount = document.createElement('div');
    mountView(makeBoot({ links: { ...makeBoot().links, events: null } }));
    expect(mount.querySelector('.wg-live__help-back')).toBeNull();
  });
});

describe('help view: availability and safety', () => {
  it('stays fully available in disabled mode', () => {
    mountView(makeBoot({ deploymentMode: 'disabled', events: [] }));
    expect(sectionHeadings()).toHaveLength(8);
    expect(mount.textContent).not.toContain('線上音樂會尚未開放');
  });

  it('keeps hostile admin text as text', () => {
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    mountView(makeBoot({ help: { faq: [{ question: evil, answer: evil }], compatibility: [], supportNote: evil } }));
    expect(mount.querySelector('script')).toBeNull();
    expect(mount.querySelector('img')).toBeNull();
    expect(mount.querySelector('[onerror]')).toBeNull();
    expect(mount.querySelector('.wg-live__faq-question')?.textContent).toBe(evil);
  });

  it('destroy removes the DOM and is idempotent', () => {
    mountView(makeBoot());
    view?.destroy();
    view?.destroy();
    expect(mount.querySelector('.wg-live__help')).toBeNull();
  });
});

#!/usr/bin/env node
// Verifies that the plugin CSS cannot leak into the host site (M1-PLAN section 3.3).
// Built on postcss (parser) and postcss-selector-parser (selectors).
//
// Rules, applied to every rule at any depth of @media / @supports / @container / @layer /
// @starting-style:
//   1. The FIRST compound selector of each comma-separated selector must contain a scope class as a
//      WHOLE class token: .wg-live, .wg-live--*, .wg-live-featured, .wg-live-featured--*,
//      .wg-live__* or .wg-live-featured__*. (:is()/:where() around scoped selectors also counts.)
//   2. A "+" or "~" combinator directly after the ROOT scope compound (.wg-live, .wg-live--*,
//      .wg-live-featured ...) is rejected: it would style siblings outside the container.
//   3. Names of @keyframes, @property, @counter-style, @layer and @container must start with
//      "wg-live-" (@property: "--wg-live-").
//   4. @font-face, @import, @namespace, @page, :root, html, body and a bare "*" are banned.
//      Any other at-rule is rejected too, except @charset.
//   5. Nested rules (CSS nesting) are rejected: the sources are plain CSS and the build output is flat.
//
//   node scripts/check-css-scope.mjs           checks every CSS file under src/styles and plugin/wg-live/assets/admin
//   node scripts/check-css-scope.mjs --dist    also checks the built CSS in plugin/wg-live/assets/dist
//
// Exit codes: 0 = ok, 1 = violations, 2 = usage / IO error.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

const NAME_PREFIX = 'wg-live-';
const SCOPE_HINT = '.wg-live, .wg-live--*, .wg-live-featured or .wg-live__*';

/** Blocks whose classes count as "ours" (BEM block names). The admin screen CSS adds wg-live-admin. */
export const DEFAULT_BLOCKS = ['wg-live', 'wg-live-featured'];

/**
 * Whole-token scope classes: block, element (__x) and modifier (--x) of the given blocks, and the
 * container classes themselves (block and block modifiers; siblings of these are outside our DOM).
 * @param {readonly string[]} blocks
 */
function classMatchers(blocks) {
  for (const b of blocks) if (!/^[a-z0-9-]+$/.test(b)) throw new Error(`invalid block name "${b}"`);
  const alt = blocks.join('|');
  return {
    scope: new RegExp(`^(?:${alt})(?:__[A-Za-z0-9_-]+|--[A-Za-z0-9_-]+)?$`),
    root: new RegExp(`^(?:${alt})(?:--[A-Za-z0-9_-]+)?$`),
  };
}

const BLOCK_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'starting-style']);
const NAMED_AT_RULES = new Set(['keyframes', 'property', 'counter-style']);
const BANNED_AT_RULE_HINT = {
  'font-face': '@font-face is not allowed: fonts must not ship (inherit the site fonts instead)',
  import: '@import is not allowed: bundle everything into the built file',
  namespace: '@namespace is not allowed',
  page: '@page is not allowed (global print styles)',
};

/**
 * @typedef {{ file: string, line: number, message: string }} Violation
 */

/** @param {string} name at-rule name without the vendor prefix */
const unprefixed = (name) => name.toLowerCase().replace(/^-(?:webkit|moz|ms|o)-/, '');

/**
 * Does this compound selector match the root container itself? True when it directly holds a root class
 * (.wg-live, .wg-live--x ...) and no element class (__), or when any :is()/:where() argument matches the
 * root (judged per argument, on the argument's own subject compound, so a "__" class in one argument can
 * never cancel a root class in another).
 * @param {import('postcss-selector-parser').Node[]} compound
 * @param {{ root: RegExp }} matchers
 * @returns {boolean}
 */
function compoundIsRoot(compound, matchers) {
  const direct = compound.filter((n) => n.type === 'class').map((n) => n.value);
  if (direct.some((c) => matchers.root.test(c)) && !direct.some((c) => c.includes('__'))) return true;
  for (const node of compound) {
    if (node.type !== 'pseudo' || !/^:(?:is|where)$/i.test(node.value)) continue;
    for (const arg of node.nodes) {
      // The element an argument matches is its LAST compound (".wg-live .x" matches .x, not the root).
      /** @type {import('postcss-selector-parser').Node[]} */
      let subject = [];
      for (const n of arg.nodes) {
        if (n.type === 'comment') continue;
        if (n.type === 'combinator') subject = [];
        else subject.push(n);
      }
      if (compoundIsRoot(subject, matchers)) return true;
    }
  }
  return false;
}

/**
 * Is the selector (one complex selector, no commas) scoped? Rules 1, 2 and the html/body/:root/* bans.
 * @param {import('postcss-selector-parser').Selector} selector
 * @returns {string | null} a problem description, or null when scoped
 */
function selectorProblem(selector, matchers = classMatchers(DEFAULT_BLOCKS)) {
  /** @type {import('postcss-selector-parser').Node[]} */
  const first = [];
  /** @type {import('postcss-selector-parser').Combinator | null} */
  let firstCombinator = null;
  for (const node of selector.nodes) {
    if (node.type === 'comment') continue;
    if (node.type === 'combinator') {
      firstCombinator = node;
      break;
    }
    first.push(node);
  }
  if (first.length === 0) {
    return 'the selector starts with a combinator (nesting is not allowed)';
  }

  // Global element/pseudo bans, anywhere in the selector (including :is()/:not() arguments).
  /** @type {string | null} */
  let banned = null;
  selector.walk((node) => {
    if (banned) return;
    if (node.type === 'tag' && /^(html|body)$/i.test(node.value)) banned = `"${node.value}" is not allowed`;
    else if (node.type === 'pseudo' && node.value.toLowerCase() === ':root') banned = '":root" is not allowed';
    else if (node.type === 'nesting') banned = '"&" (CSS nesting) is not allowed';
  });
  if (banned) return banned;

  const classes = first.filter((n) => n.type === 'class').map((n) => n.value);
  let scoped = classes.some((c) => matchers.scope.test(c));

  // :is(.wg-live ...) / :where(.wg-live ...) as the scope carrier: every argument must itself be scoped.
  if (!scoped) {
    for (const node of first) {
      if (node.type !== 'pseudo' || !/^:(?:is|where)$/i.test(node.value) || node.nodes.length === 0) continue;
      const inner = node.nodes.map((s) => selectorProblem(/** @type {import('postcss-selector-parser').Selector} */ (s), matchers));
      if (inner.every((p) => p === null)) {
        scoped = true;
        break;
      }
    }
  }

  if (!scoped) {
    if (first.length === 1 && first[0]?.type === 'universal') {
      return `a bare "*" is not allowed (the first compound selector must contain ${SCOPE_HINT})`;
    }
    return `the first compound selector must contain ${SCOPE_HINT} as a whole class`;
  }

  const isRoot = compoundIsRoot(first, matchers);
  if (isRoot && firstCombinator && (firstCombinator.value === '+' || firstCombinator.value === '~')) {
    return `a "${firstCombinator.value}" sibling combinator directly after the root scope selector would style elements outside the container`;
  }
  return null;
}

/**
 * Is a selector string scoped? (single complex selector or a list; every entry must be scoped)
 * @param {string} selector
 */
export function isScopedSelector(selector) {
  let ok = true;
  try {
    selectorParser((root) => {
      ok = root.nodes.length > 0 && root.nodes.every((s) => selectorProblem(/** @type {import('postcss-selector-parser').Selector} */ (s)) === null);
    }).processSync(selector);
  } catch {
    return false;
  }
  return ok;
}

/**
 * Check one stylesheet.
 * @param {string} css source text
 * @param {string} [file] name used in messages
 * @param {{ blocks?: readonly string[] }} [options] BEM blocks that count as scope (default wg-live, wg-live-featured)
 * @returns {Violation[]}
 */
export function checkCss(css, file = '<css>', options = {}) {
  const matchers = classMatchers(options.blocks ?? DEFAULT_BLOCKS);
  /** @type {Violation[]} */
  const violations = [];
  /** @param {number | undefined} line @param {string} message */
  const add = (line, message) => violations.push({ file, line: line ?? 1, message });

  /** @type {import('postcss').Root} */
  let root;
  try {
    root = postcss.parse(css, { from: file });
  } catch (err) {
    const e = /** @type {{ line?: number, reason?: string, message?: string }} */ (err);
    add(e.line, `CSS parse error: ${e.reason ?? e.message ?? String(err)}`);
    return violations;
  }

  /** @param {import('postcss').Rule} rule */
  const checkRule = (rule) => {
    for (const child of rule.nodes ?? []) {
      if (child.type === 'rule' || child.type === 'atrule') {
        add(child.source?.start?.line, 'CSS nesting is not allowed: write flat rules with a full scoped selector');
      }
    }
    let parsed;
    try {
      parsed = selectorParser().astSync(rule.selector);
    } catch (err) {
      add(rule.source?.start?.line, `selector "${rule.selector.trim()}" could not be parsed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const baseLine = rule.source?.start?.line ?? 1;
    for (const selector of parsed.nodes) {
      const problem = selectorProblem(selector, matchers);
      if (problem) {
        const line = baseLine + (selector.source?.start?.line ?? 1) - 1;
        add(line, `selector "${selector.toString().trim().replace(/\s+/g, ' ')}": ${problem}`);
      }
    }
  };

  /** @param {import('postcss').AtRule} rule */
  const checkAtRule = (rule) => {
    const name = unprefixed(rule.name);
    const line = rule.source?.start?.line;
    const params = rule.params.trim();

    if (name === 'charset') return;
    if (Object.hasOwn(BANNED_AT_RULE_HINT, name)) {
      add(line, BANNED_AT_RULE_HINT[/** @type {keyof typeof BANNED_AT_RULE_HINT} */ (name)]);
      return;
    }
    if (!BLOCK_AT_RULES.has(name) && !NAMED_AT_RULES.has(name)) {
      add(line, `@${rule.name} is not allowed`);
      return;
    }

    if (name === 'keyframes' || name === 'counter-style') {
      const ident = params.replace(/^["']|["']$/g, '');
      if (!ident.startsWith(NAME_PREFIX)) add(line, `@${rule.name} name "${ident}" must start with "${NAME_PREFIX}"`);
      return; // body: keyframe selectors / descriptors
    }
    if (name === 'property') {
      if (!/^(?:--)?wg-live-/.test(params)) add(line, `@property name "${params}" must start with "--${NAME_PREFIX}"`);
      return;
    }
    if (name === 'layer') {
      if (params) {
        for (const layer of params.split(',').map((s) => s.trim())) {
          if (!layer.startsWith(NAME_PREFIX)) add(line, `@layer name "${layer}" must start with "${NAME_PREFIX}"`);
        }
      }
    } else if (name === 'container') {
      const m = /^([-\w]+)(?=\s|$)/.exec(params);
      const first = m?.[1];
      if (first && !/^(?:not|and|or|style|scroll-state)$/i.test(first) && !first.startsWith(NAME_PREFIX)) {
        add(line, `@container name "${first}" must start with "${NAME_PREFIX}"`);
      }
    }
    if (rule.nodes) walk(rule.nodes);
  };

  /** @param {import('postcss').ChildNode[]} nodes */
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'rule') checkRule(node);
      else if (node.type === 'atrule') checkAtRule(node);
    }
  };

  walk(root.nodes);
  return violations;
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
export function findCssFiles(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...findCssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out.sort();
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--dist');
  if (unknown.length > 0) {
    console.error(`check-css-scope: unknown argument(s): ${unknown.join(' ')}`);
    return 2;
  }

  const dirs = [join(root, 'src', 'styles'), join(root, 'plugin', 'wg-live', 'assets', 'admin')];
  if (args.includes('--dist')) dirs.push(join(root, 'plugin', 'wg-live', 'assets', 'dist'));

  const files = dirs.flatMap(findCssFiles);
  /** @type {Violation[]} */
  const all = [];
  for (const file of files) {
    const rel = relative(root, file).split('\\').join('/');
    // Admin CSS may also use the .wg-live-admin block (plan 4.1; check-artifact applies the same rule).
    const blocks = rel.includes('/assets/admin/') ? [...DEFAULT_BLOCKS, 'wg-live-admin'] : DEFAULT_BLOCKS;
    all.push(...checkCss(readFileSync(file, 'utf8'), rel, { blocks }));
  }

  if (args.includes('--dist') && files.every((f) => !f.includes('dist'))) {
    console.error('check-css-scope: --dist given but no built CSS found (run npm run build first)');
    return 1;
  }

  for (const v of all) console.error(`${v.file}:${v.line}: ${v.message}`);
  if (all.length > 0) {
    console.error(`check-css-scope: ${all.length} violation(s) in ${files.length} file(s)`);
    return 1;
  }
  console.log(`check-css-scope: ok (${files.length} CSS file(s) checked)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
